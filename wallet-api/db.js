const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'ttlcoin.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS blocks (
    number INTEGER PRIMARY KEY,
    hash TEXT UNIQUE NOT NULL,
    timestamp INTEGER NOT NULL,
    miner TEXT NOT NULL,
    gas_used TEXT NOT NULL,
    gas_limit TEXT NOT NULL,
    tx_count INTEGER NOT NULL,
    difficulty TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    hash TEXT PRIMARY KEY,
    block_number INTEGER NOT NULL,
    tx_index INTEGER NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT,
    value TEXT NOT NULL,
    gas_price TEXT NOT NULL,
    gas_used TEXT NOT NULL,
    gas_limit TEXT NOT NULL,
    nonce INTEGER NOT NULL,
    status INTEGER,
    timestamp INTEGER NOT NULL,
    input_data TEXT,
    FOREIGN KEY (block_number) REFERENCES blocks(number)
  );

  CREATE INDEX IF NOT EXISTS idx_tx_from ON transactions("from");
  CREATE INDEX IF NOT EXISTS idx_tx_to ON transactions("to");
  CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions(block_number);
  CREATE INDEX IF NOT EXISTS idx_blocks_miner ON blocks(miner);
  CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks(timestamp);

  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Prepared statements
const insertBlock = db.prepare(`
  INSERT OR IGNORE INTO blocks (number, hash, timestamp, miner, gas_used, gas_limit, tx_count, difficulty)
  VALUES (@number, @hash, @timestamp, @miner, @gas_used, @gas_limit, @tx_count, @difficulty)
`);

const insertTx = db.prepare(`
  INSERT OR IGNORE INTO transactions (hash, block_number, tx_index, "from", "to", value, gas_price, gas_used, gas_limit, nonce, status, timestamp, input_data)
  VALUES (@hash, @block_number, @tx_index, @from, @to, @value, @gas_price, @gas_used, @gas_limit, @nonce, @status, @timestamp, @input_data)
`);

const getLastIndexedBlock = db.prepare(`SELECT value FROM sync_state WHERE key = 'last_block'`);
const setLastIndexedBlock = db.prepare(`INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_block', @value)`);

const getTxsByAddress = db.prepare(`
  SELECT * FROM transactions
  WHERE "from" = @addr OR "to" = @addr
  ORDER BY block_number DESC, tx_index DESC
  LIMIT @limit OFFSET @offset
`);

const getTxCountByAddress = db.prepare(`
  SELECT COUNT(*) as count FROM transactions
  WHERE "from" = @addr OR "to" = @addr
`);

const getBlockByNumber = db.prepare(`SELECT * FROM blocks WHERE number = @number`);
const getBlockByHash = db.prepare(`SELECT * FROM blocks WHERE hash = @hash`);
const getRecentBlocks = db.prepare(`SELECT * FROM blocks ORDER BY number DESC LIMIT @limit OFFSET @offset`);
const getTxByHash = db.prepare(`SELECT * FROM transactions WHERE hash = @hash`);
const getBlockTxs = db.prepare(`SELECT * FROM transactions WHERE block_number = @block_number ORDER BY tx_index`);

const getStats = db.prepare(`
  SELECT
    (SELECT MAX(number) FROM blocks) as latest_block,
    (SELECT COUNT(*) FROM transactions) as total_txs,
    (SELECT COUNT(DISTINCT "from") + COUNT(DISTINCT "to") FROM transactions) as unique_addresses
`);

module.exports = {
  db,
  insertBlock,
  insertTx,
  getLastIndexedBlock,
  setLastIndexedBlock,
  getTxsByAddress,
  getTxCountByAddress,
  getBlockByNumber,
  getBlockByHash,
  getRecentBlocks,
  getTxByHash,
  getBlockTxs,
  getStats,
};
