const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { ethers } = require('ethers');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const RPC_URL = 'https://rpc.ttl1.top';
const LOCAL_RPC = 'http://127.0.0.1:18545';
const provider = new ethers.JsonRpcProvider(RPC_URL);

let mainWindow;
let gethProcess = null;

// --- Geth Node Management ---
function getGethBinary() {
  const isWin = process.platform === 'win32';
  const name = isWin ? 'geth-win.exe' : 'geth-linux';
  // In packaged app, binaries are in resources/bin
  const packed = path.join(process.resourcesPath, 'bin', name);
  if (fs.existsSync(packed)) return packed;
  // In dev mode
  return path.join(__dirname, 'bin', name);
}

function getDataDir() {
  const dir = path.join(app.getPath('userData'), 'ttlcoin-node');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getGenesisPath() {
  const packed = path.join(process.resourcesPath, 'bin', 'genesis.json');
  if (fs.existsSync(packed)) return packed;
  return path.join(__dirname, 'bin', 'genesis.json');
}

function isNodeInitialized() {
  const dataDir = getDataDir();
  // geth 1.13 uses 'ttlcoin' subdir (clientIdentifier)
  return fs.existsSync(path.join(dataDir, 'ttlcoin', 'chaindata')) ||
         fs.existsSync(path.join(dataDir, 'geth', 'chaindata'));
}

function initGenesis() {
  return new Promise((resolve, reject) => {
    const geth = getGethBinary();
    const dataDir = getDataDir();
    const genesis = getGenesisPath();

    console.log('Initializing genesis...');
    const proc = spawn(geth, ['--datadir', dataDir, 'init', genesis]);
    proc.stdout.on('data', (d) => console.log('init:', d.toString().trim()));
    proc.stderr.on('data', (d) => console.log('init:', d.toString().trim()));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('Genesis init failed: ' + code));
    });
  });
}

// Static nodes - all 4 signers
const STATIC_NODES = [
  'enode://ce0caad60484759ebef68286fc887e03178dd8468a530124234a39564710015a59098db8d0247e88a2d8bcd0c9400cc463049ebf456739577b774ed6e363c6d0@207.90.195.148:30303',
  'enode://3bda010301bd6b0b6cbc5cb1d29e309600b590af054757c58104b0d534e94caf1c8eb530fbd70830b0924f69e15890ba256a5b346aa20e7228777df5a4aa51cd@207.90.195.147:30303',
  'enode://d8cd151be73cf8a5606b8566e61b97a0f51244723065f463100c9ec43b371deb02a6635eb2aaaef4dcfb0685349d03f55237700472214a67c8cf31aa82118918@207.90.195.149:30303',
  'enode://11d7a054ad14ffeec0b28efe2d073b68acff70a956990c73e03053935c842c6619ca573d7b096eb690531881729fa137f8b4ed15d4b190e0b3be8cedd5dbdd85@207.90.195.153:30303',
];

function writeStaticNodes() {
  const dataDir = getDataDir();
  const file = path.join(dataDir, 'static-nodes.json');
  fs.writeFileSync(file, JSON.stringify(STATIC_NODES));
}

// Generate or load node ID
function getNodeId() {
  const idFile = path.join(getDataDir(), 'node-id.txt');
  if (fs.existsSync(idFile)) return fs.readFileSync(idFile, 'utf8').trim();
  const id = require('crypto').randomBytes(8).toString('hex');
  fs.writeFileSync(idFile, id);
  return id;
}

// Send heartbeat to admin panel
async function sendHeartbeat(walletAddress) {
  try {
    const localProvider = new ethers.JsonRpcProvider(LOCAL_RPC);
    const blockNumber = await localProvider.getBlockNumber().catch(() => 0);
    const peersHex = await localProvider.send('net_peerCount', []).catch(() => '0x0');
    const peers = parseInt(peersHex, 16);

    await fetch('https://admin.ttl1.top/api/node/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: getNodeId(),
        address: walletAddress || '',
        blockNumber,
        peers,
        platform: process.platform,
      }),
    });
  } catch (e) { /* ignore */ }
}

let heartbeatInterval;
function startHeartbeat() {
  if (heartbeatInterval) return;
  const beat = () => {
    // Ask renderer for current wallet address via IPC (stored in a variable)
    sendHeartbeat(currentWalletAddress);
  };
  beat();
  heartbeatInterval = setInterval(beat, 60000); // Every 60s
}

let currentWalletAddress = '';

// Write user's private key to keystore so geth can unlock it
async function setupSignerKey(privateKey, password) {
  const dataDir = getDataDir();
  const keystoreDir = path.join(dataDir, 'keystore');
  if (!fs.existsSync(keystoreDir)) fs.mkdirSync(keystoreDir, { recursive: true });

  const wallet = new ethers.Wallet(privateKey);
  const json = await wallet.encrypt(password);
  const filename = `UTC--${new Date().toISOString().replace(/[:.]/g, '-')}--${wallet.address.slice(2).toLowerCase()}`;
  fs.writeFileSync(path.join(keystoreDir, filename), json);

  // Write password file
  fs.writeFileSync(path.join(dataDir, 'password.txt'), password);

  return wallet.address;
}

async function startNode(signerAddress = null, signerPassword = null) {
  if (gethProcess) return;

  const geth = getGethBinary();
  const dataDir = getDataDir();

  if (!isNodeInitialized()) {
    await initGenesis();
  }
  writeStaticNodes();

  // Make binary executable on Linux
  if (process.platform !== 'win32') {
    try { fs.chmodSync(geth, '755'); } catch (e) {}
  }

  const args = [
    '--datadir', dataDir,
    '--networkid', '7777',
    '--port', '30303',
    '--http',
    '--http.addr', '127.0.0.1',
    '--http.port', '18545',
    '--http.api', 'eth,net,web3,admin,clique,miner,txpool',
    '--http.corsdomain', '*',
    '--syncmode', 'full',
    '--gcmode', 'full',
    '--verbosity', '3',
    '--maxpeers', '10',
    '--bootnodes', STATIC_NODES.join(','),
  ];

  // If we're an approved signer, add mining flags
  if (signerAddress && signerPassword) {
    args.push(
      '--mine',
      '--miner.etherbase', signerAddress,
      '--unlock', signerAddress,
      '--password', path.join(dataDir, 'password.txt'),
      '--allow-insecure-unlock',
    );
    console.log('Starting as SIGNER:', signerAddress);
  } else {
    console.log('Starting as regular node...');
  }

  gethProcess = spawn(geth, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  gethProcess.stdout.on('data', (d) => console.log('geth:', d.toString().trim()));
  gethProcess.stderr.on('data', (d) => console.log('geth:', d.toString().trim()));
  gethProcess.on('close', (code) => {
    console.log('geth exited:', code);
    gethProcess = null;
  });
}

function stopNode() {
  if (gethProcess) {
    console.log('Stopping geth node...');
    gethProcess.kill('SIGINT');
    gethProcess = null;
  }
}

// --- Window ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 780,
    resizable: false,
    autoHideMenuBar: true,
    title: 'TTL Coin Wallet',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('ui/index.html');
}

app.whenReady().then(async () => {
  createWindow();
  try {
    await startNode();
    console.log('Node started');
    startHeartbeat();
  } catch (e) {
    console.error('Node start failed:', e.message);
  }
});

// IPC to update wallet address for heartbeat
ipcMain.handle('wallet:setAddress', async (_, address) => {
  currentWalletAddress = address;
  return true;
});

// Restart node as signer (after approval)
ipcMain.handle('wallet:startMining', async (_, { privateKey }) => {
  try {
    const password = 'ttlcoin-' + require('crypto').randomBytes(8).toString('hex');
    const address = await setupSignerKey(privateKey, password);
    stopNode();
    await new Promise((r) => setTimeout(r, 2000));
    await startNode(address, password);
    return { ok: true, address };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('wallet:isMining', async () => {
  try {
    const localProvider = new ethers.JsonRpcProvider(LOCAL_RPC);
    const mining = await localProvider.send('eth_mining', []);
    return { mining };
  } catch (e) {
    return { mining: false };
  }
});

app.on('before-quit', () => stopNode());
app.on('window-all-closed', () => {
  stopNode();
  app.quit();
});

// --- IPC Handlers ---
ipcMain.handle('wallet:create', async () => {
  const wallet = ethers.Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic.phrase,
  };
});

ipcMain.handle('wallet:import', async (_, key) => {
  try {
    if (key.trim().split(/\s+/).length >= 12) {
      const wallet = ethers.Wallet.fromPhrase(key.trim());
      return { address: wallet.address, privateKey: wallet.privateKey, mnemonic: key.trim() };
    }
    const wallet = new ethers.Wallet(key.trim());
    return { address: wallet.address, privateKey: wallet.privateKey, mnemonic: '' };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('wallet:balance', async (_, address) => {
  try {
    const balance = await provider.getBalance(address);
    return { balance: balance.toString(), formatted: ethers.formatEther(balance) };
  } catch (e) {
    return { balance: '0', formatted: '0' };
  }
});

ipcMain.handle('wallet:send', async (_, { privateKey, to, amount, sendMax }) => {
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    let value;
    if (sendMax) {
      // Calculate max: balance - gas cost
      const balance = await provider.getBalance(wallet.address);
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
      const gasLimit = 21000n; // Simple transfer
      const gasCost = gasPrice * gasLimit;
      if (balance <= gasCost) return { error: 'Balance too low for gas' };
      value = balance - gasCost;
    } else {
      value = ethers.parseEther(amount);
    }
    const tx = await wallet.sendTransaction({ to, value, gasLimit: 21000 });
    return { hash: tx.hash };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('wallet:history', async (_, address) => {
  try {
    const res = await fetch(`https://api.ttl1.top/api/v1/address/${address}/txs?limit=50`);
    const data = await res.json();
    return (data.transactions || []).map((tx) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: ethers.formatEther(tx.value),
      blockNumber: tx.block_number,
      timestamp: tx.timestamp,
    }));
  } catch (e) {
    return [];
  }
});

ipcMain.handle('wallet:qr', async (_, address) => {
  return await QRCode.toDataURL(address, { width: 200 });
});

ipcMain.handle('wallet:chain', async () => {
  try {
    const [blockNumber, network] = await Promise.all([
      provider.getBlockNumber(),
      provider.getNetwork(),
    ]);
    return { blockNumber, chainId: Number(network.chainId) };
  } catch (e) {
    return { blockNumber: 0, chainId: 7777 };
  }
});

ipcMain.handle('wallet:applyMiner', async (_, { address, name }) => {
  try {
    const res = await fetch('https://admin.ttl1.top/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, name }),
    });
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('wallet:minerStatus', async (_, address) => {
  try {
    const res = await fetch(`https://admin.ttl1.top/api/apply/${address}`);
    return await res.json();
  } catch (e) {
    return { status: 'unknown' };
  }
});

ipcMain.handle('wallet:nodeStatus', async () => {
  try {
    const localProvider = new ethers.JsonRpcProvider(LOCAL_RPC);
    const blockNumber = await localProvider.getBlockNumber();
    const peers = await localProvider.send('net_peerCount', []);
    return { running: true, blockNumber, peers: parseInt(peers, 16) };
  } catch (e) {
    return { running: !!gethProcess, blockNumber: 0, peers: 0 };
  }
});

ipcMain.handle('wallet:gasPrice', async () => {
  try {
    const fee = await provider.getFeeData();
    return fee.gasPrice?.toString() || '0';
  } catch (e) {
    return '0';
  }
});
