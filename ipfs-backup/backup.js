const { ethers } = require('ethers');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

const TTL_RPC = process.env.TTL_RPC || 'http://localhost:8545';
const FILEBASE_KEY = process.env.FILEBASE_KEY || '';
const FILEBASE_SECRET = process.env.FILEBASE_SECRET || '';
const FILEBASE_BUCKET = process.env.FILEBASE_BUCKET || 'ttlcoin-backup';
const BACKUP_INTERVAL = parseInt(process.env.BACKUP_INTERVAL) || 5000;
const STATE_FILE = path.join(__dirname, 'backup-state.json');

const provider = new ethers.JsonRpcProvider(TTL_RPC);

let s3 = null;
if (FILEBASE_KEY && FILEBASE_SECRET) {
  s3 = new S3Client({
    endpoint: 'https://s3.filebase.com',
    region: 'us-east-1',
    credentials: {
      accessKeyId: FILEBASE_KEY,
      secretAccessKey: FILEBASE_SECRET,
    },
  });
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  return { lastBackup: 0, pins: [] };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function getBlockRange(from, to) {
  const blocks = [];
  const batchSize = 10;
  for (let i = from; i <= to; i += batchSize) {
    const promises = [];
    for (let j = i; j <= Math.min(i + batchSize - 1, to); j++) {
      const hex = '0x' + j.toString(16);
      promises.push(provider.send('eth_getBlockByNumber', [hex, true]));
    }
    const results = await Promise.all(promises);
    blocks.push(...results.filter(Boolean));
  }
  return blocks;
}

async function uploadToFilebase(data, key) {
  const body = JSON.stringify(data);
  await s3.send(new PutObjectCommand({
    Bucket: FILEBASE_BUCKET,
    Key: key,
    Body: body,
    ContentType: 'application/json',
    Metadata: { chain: 'ttlcoin', chainid: '7777' },
  }));
  // Filebase IPFS bucket returns CID in response headers
  // Access via: https://ipfs.filebase.io/ipfs/<CID>
  return `s3://${FILEBASE_BUCKET}/${key}`;
}

async function saveLocal(data, key) {
  const file = path.join(__dirname, 'local-backups', key);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
  return `local:${file}`;
}

async function store(data, key) {
  if (s3) return await uploadToFilebase(data, key);
  return await saveLocal(data, key);
}

async function doBackup() {
  const state = loadState();
  const currentBlock = await provider.getBlockNumber();
  const targetBlock = Math.floor(currentBlock / BACKUP_INTERVAL) * BACKUP_INTERVAL;

  if (targetBlock <= state.lastBackup || targetBlock === 0) return;

  const from = state.lastBackup + 1;
  const to = targetBlock;

  console.log(`Backing up blocks ${from} - ${to}...`);

  for (let start = from; start <= to; start += BACKUP_INTERVAL) {
    const end = Math.min(start + BACKUP_INTERVAL - 1, to);
    const blocks = await getBlockRange(start, end);

    const backup = {
      chain: 'TTL Coin',
      chainId: 7777,
      fromBlock: start,
      toBlock: end,
      blockCount: blocks.length,
      timestamp: new Date().toISOString(),
      blocks,
    };

    const key = `blocks/${start}-${end}.json`;
    const loc = await store(backup, key);
    console.log(`  ${key} -> ${loc}`);

    state.pins.push({ from: start, to: end, location: loc, timestamp: backup.timestamp });
  }

  state.lastBackup = targetBlock;
  saveState(state);
  console.log(`Backup complete up to block ${targetBlock}`);
}

async function run() {
  const mode = s3 ? 'Filebase (IPFS)' : 'Local files';
  console.log(`TTL Chain Backup Service`);
  console.log(`  TTL RPC: ${TTL_RPC}`);
  console.log(`  Storage: ${mode}`);
  console.log(`  Bucket: ${FILEBASE_BUCKET}`);
  console.log(`  Interval: every ${BACKUP_INTERVAL} blocks`);

  await doBackup();
  setInterval(doBackup, 60000);
}

run().catch(console.error);
