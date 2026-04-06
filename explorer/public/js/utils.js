function weiToTTL(wei) {
  if (!wei || wei === '0') return '0';
  const s = BigInt(wei).toString();
  if (s.length <= 18) return (Number(wei) / 1e18).toFixed(4);
  const whole = s.slice(0, s.length - 18) || '0';
  const frac = s.slice(s.length - 18, s.length - 14);
  return Number(whole + '.' + frac).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function formatNumber(n) {
  return Number(n).toLocaleString('en-US');
}

function truncAddr(addr) {
  if (!addr) return '-';
  return addr.slice(0, 10) + '...' + addr.slice(-8);
}

function truncHash(hash) {
  if (!hash) return '-';
  return hash.slice(0, 14) + '...' + hash.slice(-8);
}

function timeAgo(ts) {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 5) return 'just now';
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function hexToNumber(hex) {
  return parseInt(hex, 16);
}

function isInTurn(difficulty) {
  return difficulty === '2' || difficulty === 2;
}
