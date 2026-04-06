const app = document.getElementById('app');
let wallet = null; // { address, privateKey, mnemonic }

function loadWallet() {
  const saved = localStorage.getItem('ttl_wallet');
  if (saved) wallet = JSON.parse(saved);
}

function saveWallet() {
  if (wallet) localStorage.setItem('ttl_wallet', JSON.stringify(wallet));
}

function clearWallet() {
  wallet = null;
  localStorage.removeItem('ttl_wallet');
  render();
}

async function api(path, opts) {
  const res = await fetch('/api' + path, opts);
  return res.json();
}

function timeAgo(ts) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function truncAddr(a) {
  return a ? a.slice(0, 8) + '...' + a.slice(-6) : '';
}

function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

async function copyAddr() {
  if (!wallet) return;
  await navigator.clipboard.writeText(wallet.address);
  const el = document.getElementById('receiveAddr');
  el.value = 'Copied!';
  setTimeout(() => el.value = wallet.address, 1000);
}

// --- Render ---
async function render() {
  if (!wallet) return renderWelcome();
  renderMain();
}

function renderWelcome() {
  app.innerHTML = `
    <div class="header">
      <h1><span>TTL</span>coin Wallet</h1>
    </div>
    <div class="welcome">
      <h2>Welcome</h2>
      <p>Create a new wallet or import an existing one to get started.</p>
      <button class="btn btn-primary mb" onclick="createWallet()">Create New Wallet</button>
      <button class="btn btn-outline" onclick="openModal('importModal')">Import Wallet</button>
    </div>
  `;
}

async function renderMain() {
  const [balData, chainData] = await Promise.all([
    api('/balance/' + wallet.address),
    api('/chain'),
  ]);

  const bal = parseFloat(balData.formatted || '0').toLocaleString('en-US', { maximumFractionDigits: 4 });

  app.innerHTML = `
    <div class="header">
      <h1><span>TTL</span>coin Wallet</h1>
      <div class="chain-info"><span class="dot"></span> Block #${chainData.blockNumber?.toLocaleString() || 0} | Chain ID ${chainData.chainId || 7777}</div>
    </div>

    <div class="balance-card">
      <div class="label">Total Balance</div>
      <div class="amount">${bal} TTL</div>
      <div class="address" onclick="navigator.clipboard.writeText('${wallet.address}')" title="Click to copy">${wallet.address}</div>
    </div>

    <div class="actions">
      <div class="action-btn" onclick="openSend()">
        <div class="icon">&#8593;</div>
        <div class="label">Send</div>
      </div>
      <div class="action-btn" onclick="openReceive()">
        <div class="icon">&#8595;</div>
        <div class="label">Receive</div>
      </div>
      <div class="action-btn" onclick="openBackup()">
        <div class="icon">&#128274;</div>
        <div class="label">Backup</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">Recent Transactions</div>
      <div id="txList"><div class="empty">Loading...</div></div>
    </div>

    <button class="btn btn-outline" style="margin-top:8px;color:var(--red);border-color:var(--red)" onclick="if(confirm('Disconnect wallet?'))clearWallet()">Disconnect Wallet</button>
  `;

  loadHistory();
}

async function loadHistory() {
  const data = await api('/history/' + wallet.address);
  const list = document.getElementById('txList');
  if (!data.transactions || data.transactions.length === 0) {
    list.innerHTML = '<div class="empty">No transactions yet</div>';
    return;
  }
  list.innerHTML = data.transactions.map((tx) => {
    const isSent = tx.from.toLowerCase() === wallet.address.toLowerCase();
    return `<div class="tx-item">
      <span class="tx-dir">${isSent ? '&#8593;' : '&#8595;'}</span>
      <div class="tx-info">
        <div class="addr">${isSent ? 'To: ' + truncAddr(tx.to) : 'From: ' + truncAddr(tx.from)}</div>
        <div class="time">${timeAgo(tx.timestamp)}</div>
      </div>
      <div class="tx-amount ${isSent ? 'sent' : 'received'}">${isSent ? '-' : '+'}${tx.value} TTL</div>
    </div>`;
  }).join('');
}

// --- Actions ---
async function createWallet() {
  const data = await api('/wallet/create', { method: 'POST' });
  wallet = { address: data.address, privateKey: data.privateKey, mnemonic: data.mnemonic };
  saveWallet();

  // Show backup immediately
  render();
  setTimeout(() => {
    document.getElementById('backupKey').value = data.privateKey;
    document.getElementById('backupMnemonic').value = data.mnemonic;
    openModal('backupModal');
  }, 300);
}

async function importWallet() {
  const input = document.getElementById('importKey').value.trim();
  if (!input) return;

  let data;
  if (input.startsWith('0x') && input.length === 66) {
    data = await api('/wallet/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privateKey: input }),
    });
    if (data.error) return alert(data.error);
    wallet = { address: data.address, privateKey: input, mnemonic: '' };
  } else {
    data = await api('/wallet/import-mnemonic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mnemonic: input }),
    });
    if (data.error) return alert(data.error);
    wallet = { address: data.address, privateKey: data.privateKey, mnemonic: input };
  }

  saveWallet();
  closeModal('importModal');
  render();
}

function openSend() {
  document.getElementById('sendMsg').innerHTML = '';
  document.getElementById('sendTo').value = '';
  document.getElementById('sendAmount').value = '';
  openModal('sendModal');
}

async function sendTx() {
  const to = document.getElementById('sendTo').value.trim();
  const amount = document.getElementById('sendAmount').value.trim();
  const msgEl = document.getElementById('sendMsg');

  if (!to || !amount) return msgEl.innerHTML = '<div class="msg error">Fill in all fields</div>';
  if (!to.startsWith('0x') || to.length !== 42) return msgEl.innerHTML = '<div class="msg error">Invalid address</div>';

  msgEl.innerHTML = '<div class="msg">Sending...</div>';

  const data = await api('/send-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ privateKey: wallet.privateKey, to, amount }),
  });

  if (data.error) {
    msgEl.innerHTML = `<div class="msg error">${data.error}</div>`;
  } else {
    msgEl.innerHTML = `<div class="msg success">Sent! TX: ${truncAddr(data.hash)}</div>`;
    setTimeout(() => { closeModal('sendModal'); render(); }, 2000);
  }
}

async function openReceive() {
  const qrData = await api('/qr/' + wallet.address);
  document.getElementById('qrContainer').innerHTML = `<img src="${qrData.qr}" width="200"><p style="margin-top:12px;font-size:14px;font-weight:600">Your TTL Address</p>`;
  document.getElementById('receiveAddr').value = wallet.address;
  openModal('receiveModal');
}

function openBackup() {
  document.getElementById('backupKey').value = wallet.privateKey;
  document.getElementById('backupMnemonic').value = wallet.mnemonic || 'N/A (imported via private key)';
  openModal('backupModal');
}

// --- Auto refresh ---
setInterval(() => { if (wallet) render(); }, 15000);

// --- Init ---
loadWallet();
render();
