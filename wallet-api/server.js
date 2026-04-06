const express = require('express');
const { ethers } = require('ethers');
const {
  getTxsByAddress, getTxCountByAddress,
  getBlockByNumber, getBlockByHash, getRecentBlocks,
  getTxByHash, getBlockTxs, getStats,
} = require('./db');
const { startIndexer } = require('./indexer');

const app = express();
app.use(express.json());

const PORT = process.env.WALLET_PORT || 4000;
const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const provider = new ethers.JsonRpcProvider(RPC_URL);

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// --- Wallet API ---

// Get address info + balance
app.get('/api/v1/address/:addr', async (req, res) => {
  try {
    const addr = req.params.addr.toLowerCase();
    const [balance, nonce, code] = await Promise.all([
      provider.getBalance(addr),
      provider.getTransactionCount(addr),
      provider.getCode(addr),
    ]);
    const txCount = getTxCountByAddress.get({ addr });
    res.json({
      address: addr,
      balance: balance.toString(),
      nonce,
      isContract: code !== '0x',
      txCount: txCount?.count || 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get address transaction history
app.get('/api/v1/address/:addr/txs', (req, res) => {
  try {
    const addr = req.params.addr.toLowerCase();
    const page = parseInt(req.query.page) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = page * limit;

    const txs = getTxsByAddress.all({ addr, limit, offset });
    const total = getTxCountByAddress.get({ addr });

    res.json({
      address: addr,
      transactions: txs,
      total: total?.count || 0,
      page,
      limit,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get balance (simple)
app.get('/api/v1/balance/:addr', async (req, res) => {
  try {
    const balance = await provider.getBalance(req.params.addr);
    res.json({ address: req.params.addr, balance: balance.toString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get nonce
app.get('/api/v1/nonce/:addr', async (req, res) => {
  try {
    const nonce = await provider.getTransactionCount(req.params.addr);
    res.json({ address: req.params.addr, nonce });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send raw transaction
app.post('/api/v1/tx/send', async (req, res) => {
  try {
    const { signedTx } = req.body;
    if (!signedTx) return res.status(400).json({ error: 'signedTx required' });
    const result = await provider.broadcastTransaction(signedTx);
    res.json({ hash: result.hash });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get transaction by hash
app.get('/api/v1/tx/:hash', async (req, res) => {
  try {
    // Try indexed DB first
    const dbTx = getTxByHash.get({ hash: req.params.hash });
    if (dbTx) return res.json(dbTx);

    // Fallback to RPC
    const [tx, receipt] = await Promise.all([
      provider.getTransaction(req.params.hash),
      provider.getTransactionReceipt(req.params.hash),
    ]);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json({
      hash: tx.hash,
      block_number: tx.blockNumber,
      from: tx.from,
      to: tx.to,
      value: tx.value.toString(),
      gas_price: tx.gasPrice?.toString() || '0',
      gas_used: receipt?.gasUsed.toString() || '0',
      gas_limit: tx.gasLimit.toString(),
      nonce: tx.nonce,
      status: receipt?.status,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get gas price
app.get('/api/v1/gas-price', async (req, res) => {
  try {
    const feeData = await provider.getFeeData();
    res.json({ gasPrice: feeData.gasPrice?.toString() || '0' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Estimate gas
app.post('/api/v1/estimate-gas', async (req, res) => {
  try {
    const { from, to, value, data } = req.body;
    const gas = await provider.estimateGas({ from, to, value, data });
    res.json({ gas: gas.toString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Chain info
app.get('/api/v1/chain', async (req, res) => {
  try {
    const [blockNumber, network, feeData] = await Promise.all([
      provider.getBlockNumber(),
      provider.getNetwork(),
      provider.getFeeData(),
    ]);
    const stats = getStats.get();
    res.json({
      chainId: Number(network.chainId),
      blockNumber,
      gasPrice: feeData.gasPrice?.toString() || '0',
      totalIndexedBlocks: stats?.latest_block || 0,
      totalTransactions: stats?.total_txs || 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Block by number
app.get('/api/v1/block/:id', (req, res) => {
  try {
    const id = req.params.id;
    let block;
    if (/^\d+$/.test(id)) {
      block = getBlockByNumber.get({ number: parseInt(id) });
    } else {
      block = getBlockByHash.get({ hash: id });
    }
    if (!block) return res.status(404).json({ error: 'Block not found' });

    const txs = getBlockTxs.all({ block_number: block.number });
    res.json({ ...block, transactions: txs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Recent blocks
app.get('/api/v1/blocks', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const blocks = getRecentBlocks.all({ limit, offset: page * limit });
    res.json({ blocks, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get('/api/v1/health', async (req, res) => {
  try {
    const blockNumber = await provider.getBlockNumber();
    res.json({ status: 'ok', blockNumber });
  } catch (e) {
    res.json({ status: 'error', error: e.message });
  }
});

// Start server + indexer
app.listen(PORT, () => {
  console.log(`TTL Coin Wallet API running at http://localhost:${PORT}`);
  startIndexer();
});
