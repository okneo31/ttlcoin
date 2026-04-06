const express = require('express');
const { ethers } = require('ethers');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const WS_URL = process.env.WS_URL || 'ws://localhost:8546';
const WALLET_API = process.env.WALLET_API || 'http://localhost:4000';

const provider = new ethers.JsonRpcProvider(RPC_URL);

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Clique signer recovery ---
// In Clique PoA, miner/coinbase is 0x0. The actual signer must be recovered
// from the 65-byte signature at the end of extraData using ecrecover.
// We use the clique_getSigners RPC and cache it, since there's typically one signer.
let cachedSigners = null;
async function getSigners() {
  if (!cachedSigners) {
    try {
      cachedSigners = await provider.send('clique_getSigners', []);
    } catch (e) {
      cachedSigners = [];
    }
  }
  return cachedSigners;
}

// Recover signer from extraData signature using ethers ecrecover
// Clique seal hash = keccak256(RLP(header_without_signature))
// This is complex, so we use a simpler approach: fetch via raw RPC which includes
// the proper signer recovery, or use batch clique RPC.
async function getBlockWithSigner(blockNumOrHash) {
  // Use raw JSON-RPC to get the block
  const param = typeof blockNumOrHash === 'number'
    ? '0x' + blockNumOrHash.toString(16)
    : blockNumOrHash;
  const method = typeof blockNumOrHash === 'number' || param.startsWith('0x') && param.length <= 18
    ? 'eth_getBlockByNumber'
    : 'eth_getBlockByHash';

  const raw = await provider.send(method, [param, true]);
  if (!raw) return null;

  // For Clique, recover signer from extraData
  let signer = raw.miner;
  if (signer === '0x0000000000000000000000000000000000000000' && raw.extraData && raw.extraData.length >= 132) {
    // extraData = 0x + 64chars(32bytes vanity) + ... + 130chars(65bytes sig)
    // For single-signer chain, use cached signer list
    const signers = await getSigners();
    if (signers.length > 0) {
      signer = signers[0];
    }
  }

  return {
    number: parseInt(raw.number, 16),
    hash: raw.hash,
    parentHash: raw.parentHash,
    timestamp: parseInt(raw.timestamp, 16),
    miner: signer,
    gasUsed: parseInt(raw.gasUsed, 16).toString(),
    gasLimit: parseInt(raw.gasLimit, 16).toString(),
    baseFeePerGas: raw.baseFeePerGas ? parseInt(raw.baseFeePerGas, 16).toString() : '0',
    extraData: raw.extraData,
    difficulty: parseInt(raw.difficulty, 16).toString(),
    transactions: raw.transactions || [],
    txCount: (raw.transactions || []).length,
  };
}

// --- REST API ---

// Chain stats
app.get('/api/stats', async (req, res) => {
  try {
    const [blockNumber, gasPrice, network] = await Promise.all([
      provider.getBlockNumber(),
      provider.getFeeData(),
      provider.getNetwork(),
    ]);
    const block = await getBlockWithSigner(blockNumber);
    const totalMinted = BigInt(blockNumber) * 7777n;
    const maxSupply = 777700000000n;
    res.json({
      blockNumber,
      gasPrice: gasPrice.gasPrice?.toString() || '0',
      chainId: Number(network.chainId),
      lastBlockTime: block?.timestamp || 0,
      totalMinted: totalMinted.toString(),
      maxSupply: maxSupply.toString(),
      miner: block?.miner || '',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Recent blocks (paginated) - fetch in parallel for speed
app.get('/api/blocks', async (req, res) => {
  try {
    const latest = await provider.getBlockNumber();
    const page = parseInt(req.query.page) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const start = latest - page * limit;
    const end = Math.max(start - limit + 1, 0);

    // Fetch blocks in parallel
    const promises = [];
    for (let i = start; i >= end; i--) {
      promises.push(getBlockWithSigner(i).catch(() => null));
    }
    const results = await Promise.all(promises);
    const blocks = results.filter(Boolean).map((b) => ({
      number: b.number,
      hash: b.hash,
      timestamp: b.timestamp,
      miner: b.miner,
      gasUsed: b.gasUsed,
      gasLimit: b.gasLimit,
      txCount: b.txCount,
      difficulty: b.difficulty,
    }));

    res.json({ blocks, latest, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Block by number or hash
app.get('/api/block/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const blockId = /^\d+$/.test(id) ? parseInt(id) : id;
    const block = await getBlockWithSigner(blockId);
    if (!block) return res.status(404).json({ error: 'Block not found' });
    res.json(block);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Transaction by hash
app.get('/api/tx/:hash', async (req, res) => {
  try {
    const [tx, receipt] = await Promise.all([
      provider.getTransaction(req.params.hash),
      provider.getTransactionReceipt(req.params.hash),
    ]);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json({
      hash: tx.hash,
      blockNumber: tx.blockNumber,
      from: tx.from,
      to: tx.to,
      value: tx.value.toString(),
      gasPrice: tx.gasPrice?.toString() || '0',
      gasLimit: tx.gasLimit.toString(),
      nonce: tx.nonce,
      data: tx.data,
      status: receipt?.status,
      gasUsed: receipt?.gasUsed.toString() || '0',
      logs: receipt?.logs || [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Address info
app.get('/api/address/:addr', async (req, res) => {
  try {
    const addr = req.params.addr;
    const [balance, txCount, code] = await Promise.all([
      provider.getBalance(addr),
      provider.getTransactionCount(addr),
      provider.getCode(addr),
    ]);
    res.json({
      address: addr,
      balance: balance.toString(),
      txCount,
      isContract: code !== '0x',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Search
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ type: null });
  if (/^\d+$/.test(q)) return res.json({ type: 'block', id: q });
  if (/^0x[a-fA-F0-9]{64}$/.test(q)) {
    const tx = await provider.getTransaction(q).catch(() => null);
    if (tx) return res.json({ type: 'tx', id: q });
    const block = await provider.getBlock(q).catch(() => null);
    if (block) return res.json({ type: 'block', id: q });
    return res.json({ type: null });
  }
  if (/^0x[a-fA-F0-9]{40}$/.test(q)) return res.json({ type: 'address', id: q });
  return res.json({ type: null });
});

// Clique signers
app.get('/api/signers', async (req, res) => {
  try {
    const signers = await provider.send('clique_getSigners', []);
    res.json({ signers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Proxy to wallet-api indexer for address tx history
app.get('/api/indexer/address/:addr/txs', async (req, res) => {
  try {
    const url = `${WALLET_API}/api/v1/address/${req.params.addr}/txs?page=${req.query.page || 0}&limit=${req.query.limit || 20}`;
    const resp = await fetch(url);
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.json({ transactions: [], total: 0 });
  }
});

// --- WebSocket for live updates ---
// SPA fallback - serve index.html for all non-API routes
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const wss = new WebSocketServer({ server, path: '/ws' });

async function broadcastBlock(blockNumber) {
  try {
    const block = await getBlockWithSigner(blockNumber);
    if (!block) return;
    const data = JSON.stringify({
      type: 'newBlock',
      block: {
        number: block.number,
        hash: block.hash,
        timestamp: block.timestamp,
        miner: block.miner,
        gasUsed: block.gasUsed,
        txCount: block.txCount,
        difficulty: block.difficulty,
      },
    });
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(data);
    });
  } catch (e) {
    console.error('Broadcast error:', e.message);
  }
}

async function startBlockWatcher() {
  return new Promise((resolve, reject) => {
    try {
      const WebSocket = require('ws');
      const testWs = new WebSocket(WS_URL);
      testWs.on('error', () => { testWs.close(); reject(new Error('WS unavailable')); });
      testWs.on('open', () => {
        testWs.close();
        const wsProvider = new ethers.WebSocketProvider(WS_URL);
        wsProvider.on('block', (blockNumber) => broadcastBlock(blockNumber));
        wsProvider.on('error', (err) => console.error('WS provider error:', err.message));
        console.log('Block watcher connected via WebSocket');
        resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Fallback: poll if WS is not available
async function startBlockPoller() {
  let lastBlock = 0;
  setInterval(async () => {
    try {
      const blockNumber = await provider.getBlockNumber();
      if (blockNumber > lastBlock) {
        lastBlock = blockNumber;
        broadcastBlock(blockNumber);
      }
    } catch (e) {
      console.error('Poll error:', e.message);
    }
  }, 3000);
  console.log('Block poller started (HTTP fallback)');
}

server.listen(PORT, () => {
  console.log(`TTL Coin Explorer running at http://localhost:${PORT}`);
  startBlockWatcher().catch(() => {
    console.log('WebSocket unavailable, falling back to polling');
    startBlockPoller();
  });
});
