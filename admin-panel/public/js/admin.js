let adminKey = localStorage.getItem('ttl_admin_key') || '';

function api(path, opts = {}) {
  opts.headers = { ...opts.headers, 'x-admin-key': adminKey, 'Content-Type': 'application/json' };
  return fetch('/api/admin' + path, opts).then(r => r.json());
}

function login() {
  adminKey = document.getElementById('adminKey').value;
  localStorage.setItem('ttl_admin_key', adminKey);
  api('/stats').then(d => {
    if (d.error) { alert('Invalid key'); return; }
    showDashboard();
  });
}

function logout() {
  adminKey = '';
  localStorage.removeItem('ttl_admin_key');
  document.getElementById('login').style.display = 'flex';
  document.getElementById('dashboard').style.display = 'none';
}

function showDashboard() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  refresh();
}

async function refresh() {
  await Promise.all([loadStats(), loadAllNodes(), loadApplications()]);
}

async function loadStats() {
  const d = await api('/stats');
  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="label">Block Height</div><div class="value">${d.blockNumber?.toLocaleString() || 0}</div></div>
    <div class="stat"><div class="label">Active Signers</div><div class="value">${d.signerCount || 0}</div></div>
    <div class="stat"><div class="label">Wallet Nodes (5m)</div><div class="value" style="color:var(--green)">${d.walletNodes || 0}</div></div>
    <div class="stat"><div class="label">Pending Applications</div><div class="value" style="color:${d.pendingApplications > 0 ? 'var(--yellow)' : 'var(--text)'}">${d.pendingApplications || 0}</div></div>
  `;
}

async function loadAllNodes() {
  const [serverNodes, walletNodes, signersData] = await Promise.all([
    api('/nodes'),
    api('/wallet-nodes'),
    api('/signers'),
  ]);
  const signers = (signersData.signers || []).map(s => s.toLowerCase());

  // Normalize both lists
  const all = [];
  for (const n of serverNodes) {
    all.push({
      type: 'server',
      name: n.name,
      address: '',
      ip: n.rpc.match(/\/\/([^:]+):/)?.[1] || '',
      online: n.status === 'online',
      blockNumber: n.blockNumber,
      peers: n.peers,
      isSigner: false,
      seconds_ago: 0,
    });
  }
  for (const n of walletNodes) {
    all.push({
      type: 'wallet',
      name: n.platform || 'wallet',
      address: n.address,
      ip: n.ip,
      online: n.seconds_ago < 300,
      blockNumber: n.block_number,
      peers: n.peers,
      isSigner: signers.includes((n.address || '').toLowerCase()),
      seconds_ago: n.seconds_ago,
    });
  }

  if (!all.length) {
    document.getElementById('allNodes').innerHTML = '<div class="card"><div class="card-row" style="color:var(--text2)">No nodes</div></div>';
    return;
  }

  document.getElementById('allNodes').innerHTML = '<div class="card">' + all.map(n => {
    const lastSeen = n.type === 'server' ? '' :
      (n.seconds_ago < 60 ? `${n.seconds_ago}s ago` : n.seconds_ago < 3600 ? `${Math.floor(n.seconds_ago/60)}m ago` : `${Math.floor(n.seconds_ago/3600)}h ago`);
    const signerBadge = n.type === 'server' || n.isSigner ? '<span class="badge badge-approved" style="margin-left:6px">SIGNER</span>' : '';
    return `<div class="card-row">
      <div class="node-status">
        <span class="dot-${n.online ? 'online' : 'offline'}"></span>
        <div>
          <div><strong>${n.name}</strong>${signerBadge}</div>
          ${n.address ? `<div class="mono" style="font-size:11px">${n.address}</div>` : ''}
          <div style="font-size:11px;color:var(--text2)">${n.ip}${lastSeen ? ' · ' + lastSeen : ''}</div>
        </div>
      </div>
      <div style="font-size:12px;text-align:right">
        ${n.online ? `<div>Block ${n.blockNumber.toLocaleString()}</div><div style="color:var(--text2)">${n.peers} peers</div>` : '<span style="color:var(--red)">Offline</span>'}
        ${n.isSigner && n.type === 'wallet' ? `<button class="btn-remove" style="margin-top:4px" onclick="removeSigner('${n.address}')">Remove Signer</button>` : ''}
      </div>
    </div>`;
  }).join('') + '</div>';
}

async function loadApplications() {
  const apps = await api('/applications');
  if (!apps.length) {
    document.getElementById('applications').innerHTML = '<div class="card"><div class="card-row" style="color:var(--text2)">No applications</div></div>';
    return;
  }
  document.getElementById('applications').innerHTML = '<div class="card">' + apps.map(a => `
    <div class="card-row">
      <div>
        <div class="mono">${a.address}</div>
        <div style="font-size:12px;color:var(--text2)">${a.name || 'Anonymous'} | ${a.created_at}</div>
      </div>
      <div class="actions">
        <span class="badge badge-${a.status}">${a.status}</span>
        ${a.status === 'pending' ? `
          <button class="btn-approve" onclick="approve('${a.address}')">Approve</button>
          <button class="btn-reject" onclick="reject('${a.address}')">Reject</button>
        ` : ''}
      </div>
    </div>
  `).join('') + '</div>';
}


async function approve(addr) {
  if (!confirm(`Approve ${addr} as miner?\nThis will vote on all 4 nodes.`)) return;
  const res = await api('/approve/' + addr, { method: 'POST' });
  alert(`Votes: ${res.votes}/${res.total}\nStatus: ${res.status}${res.errors?.length ? '\nErrors: ' + res.errors.map(e => e.node + ': ' + e.error).join(', ') : ''}`);
  refresh();
}

async function reject(addr) {
  if (!confirm(`Reject ${addr}?`)) return;
  await api('/reject/' + addr, { method: 'POST' });
  refresh();
}

async function removeSigner(addr) {
  if (!confirm(`Remove signer ${addr}?\nThis will vote to remove on all nodes.`)) return;
  const res = await api('/remove/' + addr, { method: 'POST' });
  alert(`Remove votes: ${res.votes}`);
  refresh();
}

// Auto refresh
setInterval(refresh, 15000);

// Init
if (adminKey) {
  api('/stats').then(d => {
    if (!d.error) showDashboard();
  });
}
