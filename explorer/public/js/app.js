const $ = (id) => document.getElementById(id);
const app = $('app');

// --- Routing (History API) ---
function getRoute() {
  const path = location.pathname;
  const parts = path.split('/').filter(Boolean);
  return { path: parts[0] || 'home', id: parts[1] || null, extra: parts[2] || null };
}

function navigate(url) {
  history.pushState(null, '', url);
  route();
}

window.addEventListener('popstate', route);
window.addEventListener('load', route);

// Intercept link clicks for SPA navigation
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (a && a.href && a.href.startsWith(location.origin) && !a.href.includes('/api/')) {
    e.preventDefault();
    navigate(a.getAttribute('href'));
  }
});

function route() {
  const r = getRoute();
  document.querySelectorAll('.nav a').forEach((a) => a.classList.remove('active'));
  if (r.path === 'home') {
    document.querySelector('[data-nav="home"]')?.classList.add('active');
    renderDashboard();
  } else if (r.path === 'blocks') {
    document.querySelector('[data-nav="blocks"]')?.classList.add('active');
    renderBlocks(parseInt(r.id) || 0);
  } else if (r.path === 'block') {
    renderBlockDetail(r.id);
  } else if (r.path === 'tx') {
    renderTxDetail(r.id);
  } else if (r.path === 'address') {
    renderAddressDetail(r.id);
  } else {
    renderDashboard();
  }
}

// --- API ---
async function api(path) {
  const res = await fetch('/api' + path);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// --- Search ---
async function doSearch() {
  const q = $('searchInput').value.trim();
  if (!q) return;
  const result = await api('/search?q=' + encodeURIComponent(q));
  if (result.type === 'block') navigate('/block/' + result.id);
  else if (result.type === 'tx') navigate('/tx/' + result.id);
  else if (result.type === 'address') navigate('/address/' + result.id);
  else alert('No results found');
}

$('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

// --- Dashboard ---
async function renderDashboard() {
  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const [stats, blocksData] = await Promise.all([api('/stats'), api('/blocks?limit=15')]);
    const supplyPct = (BigInt(stats.totalMinted) * 10000n / BigInt(stats.maxSupply));
    const pct = (Number(supplyPct) / 100).toFixed(2);

    app.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="label">Block Height</div>
          <div class="value">${formatNumber(stats.blockNumber)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Chain ID</div>
          <div class="value">${stats.chainId}</div>
        </div>
        <div class="stat-card">
          <div class="label">Total Minted</div>
          <div class="value small">${formatNumber(stats.totalMinted)} TTL</div>
          <div class="supply-bar"><div class="fill" style="width:${Math.min(pct, 100)}%"></div></div>
          <div style="font-size:12px;color:var(--text2);margin-top:4px">${pct}% of max supply</div>
        </div>
        <div class="stat-card">
          <div class="label">Max Supply</div>
          <div class="value small">${formatNumber(stats.maxSupply)} TTL</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          Latest Blocks <span class="live-dot" title="Live"></span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Block</th>
              <th>Time</th>
              <th>Signer</th>
              <th>Txns</th>
              <th>Gas Used</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody id="blockTable">
            ${blocksData.blocks.map(blockRow).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    app.innerHTML = `<div class="loading">Error loading dashboard: ${e.message}</div>`;
  }
}

function blockRow(b) {
  return `<tr>
    <td><a href="/block/${b.number}" class="mono hash">${b.number}</a></td>
    <td class="time-cell" data-ts="${b.timestamp}">${timeAgo(b.timestamp)}</td>
    <td><a href="/address/${b.miner}" class="mono truncate">${truncAddr(b.miner)}</a></td>
    <td>${b.txCount}</td>
    <td>${formatNumber(b.gasUsed)}</td>
    <td>${isInTurn(b.difficulty) ? '<span class="badge inturn">In-Turn</span>' : '<span class="badge">Out-Turn</span>'}</td>
  </tr>`;
}

// --- Blocks List ---
async function renderBlocks(page) {
  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const data = await api(`/blocks?page=${page}&limit=25`);
    app.innerHTML = `
      <div class="card">
        <div class="card-header">All Blocks</div>
        <table>
          <thead>
            <tr><th>Block</th><th>Time</th><th>Signer</th><th>Txns</th><th>Gas Used</th><th>Type</th></tr>
          </thead>
          <tbody>${data.blocks.map(blockRow).join('')}</tbody>
        </table>
        <div class="pagination">
          <button ${page === 0 ? 'disabled' : ''} onclick="navigate('/blocks/${page - 1}')">Prev</button>
          <button onclick="navigate('/blocks/${page + 1}')">Next</button>
        </div>
      </div>
    `;
  } catch (e) {
    app.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
}

// --- Block Detail ---
async function renderBlockDetail(id) {
  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const b = await api('/block/' + id);
    const reward = '7,777';
    app.innerHTML = `
      <div class="card">
        <div class="card-header">Block #${formatNumber(b.number)}</div>
        <div class="detail-grid">
          <div class="label">Block Hash</div>
          <div class="val mono">${b.hash}</div>
          <div class="label">Parent Hash</div>
          <div class="val mono"><a href="/block/${b.parentHash}" class="hash">${b.parentHash}</a></div>
          <div class="label">Timestamp</div>
          <div class="val">${new Date(b.timestamp * 1000).toLocaleString()} (${timeAgo(b.timestamp)})</div>
          <div class="label">Signer</div>
          <div class="val mono"><a href="/address/${b.miner}" class="hash">${b.miner}</a></div>
          <div class="label">Difficulty</div>
          <div class="val">${b.difficulty} ${isInTurn(b.difficulty) ? '<span class="badge inturn">In-Turn</span>' : '<span class="badge">Out-Turn</span>'}</div>
          <div class="label">Gas Used</div>
          <div class="val">${formatNumber(b.gasUsed)} / ${formatNumber(b.gasLimit)}</div>
          <div class="label">Block Reward</div>
          <div class="val">${reward} TTL</div>
          <div class="label">Transactions</div>
          <div class="val">${b.txCount} transaction(s)</div>
          <div class="label">Extra Data</div>
          <div class="val mono" style="font-size:12px;word-break:break-all">${b.extraData}</div>
        </div>
      </div>
      ${b.txCount > 0 ? `
      <div class="card">
        <div class="card-header">Transactions</div>
        <table>
          <thead><tr><th>Tx Hash</th><th>From</th><th>To</th><th>Value</th></tr></thead>
          <tbody>
            ${b.transactions.map((tx) => {
              const t = typeof tx === 'string' ? { hash: tx } : tx;
              return `<tr>
                <td><a href="/tx/${t.hash}" class="mono hash truncate">${truncHash(t.hash)}</a></td>
                <td>${t.from ? `<a href="/address/${t.from}" class="mono truncate">${truncAddr(t.from)}</a>` : '-'}</td>
                <td>${t.to ? `<a href="/address/${t.to}" class="mono truncate">${truncAddr(t.to)}</a>` : 'Contract Creation'}</td>
                <td>${t.value ? weiToTTL(t.value.toString()) + ' TTL' : '-'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : ''}
      <div style="text-align:center;padding:16px">
        ${b.number > 0 ? `<a href="/block/${b.number - 1}">Block ${b.number - 1}</a> | ` : ''}
        <a href="/block/${b.number + 1}">Block ${b.number + 1}</a>
      </div>
    `;
  } catch (e) {
    app.innerHTML = `<div class="loading">Block not found</div>`;
  }
}

// --- Tx Detail ---
async function renderTxDetail(hash) {
  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const tx = await api('/tx/' + hash);
    app.innerHTML = `
      <div class="card">
        <div class="card-header">Transaction Details</div>
        <div class="detail-grid">
          <div class="label">Tx Hash</div>
          <div class="val mono">${tx.hash}</div>
          <div class="label">Status</div>
          <div class="val">${tx.status === 1 ? '<span class="badge success">Success</span>' : tx.status === 0 ? '<span class="badge fail">Failed</span>' : 'Pending'}</div>
          <div class="label">Block</div>
          <div class="val"><a href="/block/${tx.blockNumber}" class="hash">${tx.blockNumber}</a></div>
          <div class="label">From</div>
          <div class="val mono"><a href="/address/${tx.from}" class="hash">${tx.from}</a></div>
          <div class="label">To</div>
          <div class="val mono">${tx.to ? `<a href="/address/${tx.to}" class="hash">${tx.to}</a>` : 'Contract Creation'}</div>
          <div class="label">Value</div>
          <div class="val">${weiToTTL(tx.value)} TTL</div>
          <div class="label">Gas Price</div>
          <div class="val">${weiToTTL(tx.gasPrice)} TTL</div>
          <div class="label">Gas Used</div>
          <div class="val">${formatNumber(tx.gasUsed)} / ${formatNumber(tx.gasLimit)}</div>
          <div class="label">Nonce</div>
          <div class="val">${tx.nonce}</div>
          <div class="label">Input Data</div>
          <div class="val mono" style="font-size:12px;word-break:break-all;max-height:120px;overflow-y:auto">${tx.data}</div>
        </div>
      </div>
    `;
  } catch (e) {
    app.innerHTML = `<div class="loading">Transaction not found</div>`;
  }
}

// --- Address Detail ---
let addrTxPage = 0;
async function renderAddressDetail(addr, page) {
  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  addrTxPage = page || 0;
  try {
    const [info, txData] = await Promise.all([
      api('/address/' + addr),
      fetch(`/api/indexer/address/${addr}/txs?page=${addrTxPage}&limit=20`).then(r => r.json()).catch(() => ({ transactions: [], total: 0 })),
    ]);
    app.innerHTML = `
      <div class="card">
        <div class="card-header">Address ${info.isContract ? '<span class="badge inturn">Contract</span>' : ''}</div>
        <div class="detail-grid">
          <div class="label">Address</div>
          <div class="val mono">${info.address}</div>
          <div class="label">Balance</div>
          <div class="val" style="font-size:20px;font-weight:700">${weiToTTL(info.balance)} TTL</div>
          <div class="label">Transactions</div>
          <div class="val">${formatNumber(txData.total)} txns</div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">Transaction History</div>
        ${txData.transactions.length > 0 ? `
        <table>
          <thead>
            <tr><th>Tx Hash</th><th>Block</th><th>Time</th><th>From</th><th>To</th><th>Value</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${txData.transactions.map((tx) => `<tr>
              <td><a href="/tx/${tx.hash}" class="mono hash truncate">${truncHash(tx.hash)}</a></td>
              <td><a href="/block/${tx.block_number}" class="hash">${tx.block_number}</a></td>
              <td class="time-cell" data-ts="${tx.timestamp}">${timeAgo(tx.timestamp)}</td>
              <td><a href="/address/${tx.from}" class="mono truncate ${tx.from === addr.toLowerCase() ? '' : 'hash'}">${truncAddr(tx.from)}</a></td>
              <td>${tx.to ? `<a href="/address/${tx.to}" class="mono truncate ${tx.to === addr.toLowerCase() ? '' : 'hash'}">${truncAddr(tx.to)}</a>` : 'Contract Creation'}</td>
              <td>${weiToTTL(tx.value)} TTL</td>
              <td>${tx.status === 1 ? '<span class="badge success">OK</span>' : tx.status === 0 ? '<span class="badge fail">Fail</span>' : '-'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="pagination">
          <button ${addrTxPage === 0 ? 'disabled' : ''} onclick="renderAddressDetail('${addr}', ${addrTxPage - 1})">Prev</button>
          <span style="padding:8px;color:var(--text2)">Page ${addrTxPage + 1}</span>
          <button ${txData.transactions.length < 20 ? 'disabled' : ''} onclick="renderAddressDetail('${addr}', ${addrTxPage + 1})">Next</button>
        </div>` : '<div style="padding:20px;text-align:center;color:var(--text2)">No transactions found</div>'}
      </div>
    `;
  } catch (e) {
    app.innerHTML = `<div class="loading">Address not found</div>`;
  }
}

// --- WebSocket Live Updates ---
let ws;
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'newBlock') {
      const r = getRoute();
      // Update dashboard live
      if (r.path === 'home') {
        const table = $('blockTable');
        if (table) {
          table.insertAdjacentHTML('afterbegin', blockRow(msg.block));
          // Keep max 15 rows
          while (table.children.length > 15) table.removeChild(table.lastChild);
        }
        // Flash update stats
        renderStatsUpdate(msg.block.number);
      }
    }
  };
  ws.onclose = () => setTimeout(connectWS, 3000);
  ws.onerror = () => ws.close();
}

async function renderStatsUpdate(blockNumber) {
  const cards = document.querySelectorAll('.stat-card .value');
  if (cards.length > 0) cards[0].textContent = formatNumber(blockNumber);
  if (cards.length > 2) {
    const totalMinted = BigInt(blockNumber) * 7777n;
    cards[2].textContent = formatNumber(totalMinted.toString()) + ' TTL';
    const supplyPct = (totalMinted * 10000n / 777700000000n);
    const pct = (Number(supplyPct) / 100).toFixed(2);
    const fill = document.querySelector('.supply-bar .fill');
    if (fill) fill.style.width = Math.min(pct, 100) + '%';
    const pctText = fill?.parentElement?.nextElementSibling;
    if (pctText) pctText.textContent = pct + '% of max supply';
  }
}

connectWS();

// --- Refresh time-ago every second ---
setInterval(() => {
  document.querySelectorAll('.time-cell[data-ts]').forEach((el) => {
    const ts = parseInt(el.dataset.ts);
    if (ts > 0) el.textContent = timeAgo(ts);
  });
}, 1000);
