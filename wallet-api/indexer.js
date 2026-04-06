const { ethers } = require('ethers');
const {
  db, insertBlock, insertTx,
  getLastIndexedBlock, setLastIndexedBlock,
} = require('./db');

const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const provider = new ethers.JsonRpcProvider(RPC_URL);

let cachedSigner = null;
async function getSigner() {
  if (!cachedSigner) {
    try {
      const signers = await provider.send('clique_getSigners', []);
      if (signers.length > 0) cachedSigner = signers[0];
    } catch (e) { /* ignore */ }
  }
  return cachedSigner || '0x0000000000000000000000000000000000000000';
}

async function getRawBlock(num) {
  const hex = '0x' + num.toString(16);
  const raw = await provider.send('eth_getBlockByNumber', [hex, true]);
  if (!raw) return null;

  let miner = raw.miner;
  if (miner === '0x0000000000000000000000000000000000000000') {
    miner = await getSigner();
  }

  return {
    number: parseInt(raw.number, 16),
    hash: raw.hash,
    timestamp: parseInt(raw.timestamp, 16),
    miner,
    gasUsed: parseInt(raw.gasUsed, 16).toString(),
    gasLimit: parseInt(raw.gasLimit, 16).toString(),
    difficulty: parseInt(raw.difficulty, 16).toString(),
    transactions: raw.transactions || [],
  };
}

async function indexBlock(blockNum) {
  const block = await getRawBlock(blockNum);
  if (!block) return;

  const txInsert = db.transaction(() => {
    insertBlock.run({
      number: block.number,
      hash: block.hash,
      timestamp: block.timestamp,
      miner: block.miner,
      gas_used: block.gasUsed,
      gas_limit: block.gasLimit,
      tx_count: block.transactions.length,
      difficulty: block.difficulty,
    });

    for (let i = 0; i < block.transactions.length; i++) {
      const tx = block.transactions[i];
      // Get receipt for gas used and status
      insertTx.run({
        hash: tx.hash,
        block_number: block.number,
        tx_index: i,
        from: tx.from.toLowerCase(),
        to: tx.to ? tx.to.toLowerCase() : null,
        value: BigInt(tx.value).toString(),
        gas_price: BigInt(tx.gasPrice).toString(),
        gas_used: '0', // Will update with receipt
        gas_limit: BigInt(tx.gas).toString(),
        nonce: parseInt(tx.nonce, 16),
        status: null, // Will update with receipt
        timestamp: block.timestamp,
        input_data: tx.input && tx.input.length > 10 ? tx.input.slice(0, 74) : tx.input,
      });
    }

    setLastIndexedBlock.run({ value: block.number.toString() });
  });

  txInsert();

  // Fetch receipts in parallel for tx details
  if (block.transactions.length > 0) {
    const receipts = await Promise.all(
      block.transactions.map((tx) =>
        provider.getTransactionReceipt(tx.hash).catch(() => null)
      )
    );
    const updateTx = db.prepare(`UPDATE transactions SET gas_used = @gas_used, status = @status WHERE hash = @hash`);
    const updateAll = db.transaction(() => {
      for (const receipt of receipts) {
        if (!receipt) continue;
        updateTx.run({
          hash: receipt.hash,
          gas_used: receipt.gasUsed.toString(),
          status: receipt.status,
        });
      }
    });
    updateAll();
  }

  return block;
}

async function getLastIndexed() {
  const row = getLastIndexedBlock.get();
  return row ? parseInt(row.value) : -1;
}

async function syncBlocks() {
  const lastIndexed = await getLastIndexed();
  const latestBlock = await provider.getBlockNumber();

  if (lastIndexed >= latestBlock) return 0;

  const start = lastIndexed + 1;
  const batchSize = 50;
  let indexed = 0;

  for (let i = start; i <= latestBlock; i += batchSize) {
    const end = Math.min(i + batchSize - 1, latestBlock);
    const promises = [];
    for (let j = i; j <= end; j++) {
      promises.push(indexBlock(j));
    }
    await Promise.all(promises);
    indexed += end - i + 1;

    if (indexed % 500 === 0 || end === latestBlock) {
      console.log(`Indexed blocks ${start} - ${end} / ${latestBlock}`);
    }
  }

  return indexed;
}

async function startIndexer() {
  console.log('Starting initial sync...');
  const count = await syncBlocks();
  console.log(`Initial sync complete: ${count} blocks indexed`);

  // Poll for new blocks
  setInterval(async () => {
    try {
      const count = await syncBlocks();
      if (count > 0) console.log(`Indexed ${count} new block(s)`);
    } catch (e) {
      console.error('Indexer poll error:', e.message);
    }
  }, 3000);
}

module.exports = { startIndexer, syncBlocks, getLastIndexed };
