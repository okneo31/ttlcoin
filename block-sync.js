const http = require('http');

const MAIN_RPC = process.env.MAIN_RPC || 'http://207.90.195.148:8545';
const BACKUP_RPC = process.env.BACKUP_RPC || 'http://localhost:8545';

function rpc(url, method, params = []) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: '/', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j.error) reject(new Error(j.error.message));
          else resolve(j.result);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

async function syncBlocks() {
  const [mainHex, backupHex] = await Promise.all([
    rpc(MAIN_RPC, 'eth_blockNumber'),
    rpc(BACKUP_RPC, 'eth_blockNumber'),
  ]);
  const mainBlock = parseInt(mainHex, 16);
  const backupBlock = parseInt(backupHex, 16);

  if (backupBlock >= mainBlock) return 0;

  const gap = mainBlock - backupBlock;
  const batchSize = Math.min(gap, 10);

  for (let i = backupBlock + 1; i <= backupBlock + batchSize; i++) {
    const hex = '0x' + i.toString(16);
    const rawBlock = await rpc(MAIN_RPC, 'debug_getRawBlock', [hex]);
    if (!rawBlock) continue;
    await rpc(BACKUP_RPC, 'debug_insertRawBlock', [rawBlock]);
  }
  return batchSize;
}

async function run() {
  console.log(`Block sync: ${MAIN_RPC} -> ${BACKUP_RPC}`);

  // Initial catch-up
  let total = 0;
  while (true) {
    const synced = await syncBlocks().catch(() => 0);
    if (synced === 0) break;
    total += synced;
    if (total % 100 === 0) console.log(`Catching up... ${total} blocks`);
  }
  if (total > 0) console.log(`Initial sync: ${total} blocks`);

  // Continuous sync
  console.log('Watching for new blocks...');
  setInterval(async () => {
    try {
      const synced = await syncBlocks();
      if (synced > 0) console.log(`Synced ${synced} block(s)`);
    } catch (e) {
      if (!e.message.includes('timeout')) console.error('Sync error:', e.message);
    }
  }, 3000);
}

run().catch(console.error);
