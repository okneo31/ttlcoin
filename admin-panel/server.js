const express = require('express');
const { ethers } = require('ethers');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 9090;
const ADMIN_KEY = process.env.ADMIN_KEY || 'ttl-admin-' + crypto.randomBytes(8).toString('hex');

// All signer nodes
const NODES = [
  { name: 'Server1', rpc: 'http://207.90.195.148:8545' },
  { name: 'Server2', rpc: 'http://207.90.195.147:8545' },
  { name: 'Server3', rpc: 'http://207.90.195.149:8545' },
  { name: 'Server4', rpc: 'http://207.90.195.153:8545' },
];

// DB
const db = new Database(path.join(__dirname, 'admin.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT UNIQUE NOT NULL,
    name TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    approved_at TEXT,
    votes INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS wallet_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT UNIQUE NOT NULL,
    address TEXT,
    block_number INTEGER DEFAULT 0,
    peers INTEGER DEFAULT 0,
    ip TEXT,
    platform TEXT,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now'))
  );
`);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Auth middleware
function auth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// --- Public API (for wallet app) ---

// Apply to become a miner
app.post('/api/apply', (req, res) => {
  const { address, name } = req.body;
  if (!address || !address.startsWith('0x') || address.length !== 42) {
    return res.status(400).json({ error: 'Invalid address' });
  }
  try {
    db.prepare('INSERT INTO applications (address, name) VALUES (?, ?)').run(address.toLowerCase(), name || '');
    res.json({ status: 'pending', message: 'Application submitted' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Already applied' });
    res.status(500).json({ error: e.message });
  }
});

// Wallet node heartbeat/registration
app.post('/api/node/heartbeat', (req, res) => {
  const { nodeId, address, blockNumber, peers, platform } = req.body;
  if (!nodeId) return res.status(400).json({ error: 'nodeId required' });
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  db.prepare(`
    INSERT INTO wallet_nodes (node_id, address, block_number, peers, ip, platform)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(node_id) DO UPDATE SET
      address = excluded.address,
      block_number = excluded.block_number,
      peers = excluded.peers,
      ip = excluded.ip,
      platform = excluded.platform,
      last_seen = datetime('now')
  `).run(nodeId, address || '', blockNumber || 0, peers || 0, ip, platform || '');

  res.json({ ok: true });
});

// Check application status
app.get('/api/apply/:address', (req, res) => {
  const row = db.prepare('SELECT * FROM applications WHERE address = ?').get(req.params.address.toLowerCase());
  if (!row) return res.json({ status: 'not_found' });
  res.json(row);
});

// --- Admin API ---

// Get all applications
app.get('/api/admin/applications', auth, (req, res) => {
  const apps = db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all();
  res.json(apps);
});

// Get current signers from chain
app.get('/api/admin/signers', auth, async (req, res) => {
  try {
    const provider = new ethers.JsonRpcProvider(NODES[0].rpc);
    const signers = await provider.send('clique_getSigners', []);
    res.json({ signers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get node status
app.get('/api/admin/nodes', auth, async (req, res) => {
  const results = await Promise.all(NODES.map(async (node) => {
    try {
      const provider = new ethers.JsonRpcProvider(node.rpc);
      const blockNumber = await provider.getBlockNumber();
      const peers = await provider.send('admin_peers', []).catch(() => []);
      return { ...node, status: 'online', blockNumber, peers: peers.length };
    } catch (e) {
      return { ...node, status: 'offline', blockNumber: 0, peers: 0 };
    }
  }));
  res.json(results);
});

// Approve application - add as signer via clique.propose on all nodes
app.post('/api/admin/approve/:address', auth, async (req, res) => {
  const address = req.params.address;
  const row = db.prepare('SELECT * FROM applications WHERE address = ?').get(address.toLowerCase());
  if (!row) return res.status(404).json({ error: 'Application not found' });

  let votes = 0;
  const errors = [];

  for (const node of NODES) {
    try {
      const provider = new ethers.JsonRpcProvider(node.rpc);
      await provider.send('clique_propose', [address, true]);
      votes++;
    } catch (e) {
      errors.push({ node: node.name, error: e.message });
    }
  }

  db.prepare("UPDATE applications SET status = ?, approved_at = datetime('now'), votes = ? WHERE address = ?")
    .run(votes >= 3 ? 'approved' : 'voting', votes, address.toLowerCase());

  res.json({ votes, total: NODES.length, errors, status: votes >= 3 ? 'approved' : 'voting' });
});

// Reject application (delete from DB)
app.post('/api/admin/reject/:address', auth, (req, res) => {
  db.prepare('DELETE FROM applications WHERE address = ?').run(req.params.address.toLowerCase());
  res.json({ status: 'deleted' });
});

// Remove signer
app.post('/api/admin/remove/:address', auth, async (req, res) => {
  const address = req.params.address;
  let votes = 0;
  for (const node of NODES) {
    try {
      const provider = new ethers.JsonRpcProvider(node.rpc);
      await provider.send('clique_propose', [address, false]);
      votes++;
    } catch (e) {}
  }
  db.prepare('UPDATE applications SET status = "removed" WHERE address = ?').run(address.toLowerCase());
  res.json({ votes, status: 'removing' });
});

// Wallet nodes list (admin)
app.get('/api/admin/wallet-nodes', auth, (req, res) => {
  const nodes = db.prepare(`
    SELECT *,
      CAST((julianday('now') - julianday(last_seen)) * 86400 AS INTEGER) as seconds_ago
    FROM wallet_nodes
    ORDER BY last_seen DESC
  `).all();
  res.json(nodes);
});

// Chain stats
app.get('/api/admin/stats', auth, async (req, res) => {
  try {
    const provider = new ethers.JsonRpcProvider(NODES[0].rpc);
    const [blockNumber, signers] = await Promise.all([
      provider.getBlockNumber(),
      provider.send('clique_getSigners', []),
    ]);
    const pending = db.prepare("SELECT COUNT(*) as c FROM applications WHERE status = 'pending'").get();
    const walletNodes = db.prepare("SELECT COUNT(*) as c FROM wallet_nodes WHERE (julianday('now') - julianday(last_seen)) * 86400 < 300").get();
    res.json({ blockNumber, signerCount: signers.length, pendingApplications: pending.c, walletNodes: walletNodes.c });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TTL Admin Panel: http://localhost:${PORT}`);
  console.log(`Admin Key: ${ADMIN_KEY}`);
});
