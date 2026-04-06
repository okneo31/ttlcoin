const express = require('express');
const { ethers } = require('ethers');
const QRCode = require('qrcode');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;
const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';

const provider = new ethers.JsonRpcProvider(RPC_URL);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Create new wallet
app.post('/api/wallet/create', (req, res) => {
  try {
    const wallet = ethers.Wallet.createRandom();
    res.json({
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: wallet.mnemonic.phrase,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Import wallet from private key
app.post('/api/wallet/import', (req, res) => {
  try {
    const { privateKey } = req.body;
    const wallet = new ethers.Wallet(privateKey);
    res.json({ address: wallet.address });
  } catch (e) {
    res.status(400).json({ error: 'Invalid private key' });
  }
});

// Import wallet from mnemonic
app.post('/api/wallet/import-mnemonic', (req, res) => {
  try {
    const { mnemonic } = req.body;
    const wallet = ethers.Wallet.fromPhrase(mnemonic);
    res.json({ address: wallet.address, privateKey: wallet.privateKey });
  } catch (e) {
    res.status(400).json({ error: 'Invalid mnemonic' });
  }
});

// Get balance
app.get('/api/balance/:address', async (req, res) => {
  try {
    const balance = await provider.getBalance(req.params.address);
    res.json({ balance: balance.toString(), formatted: ethers.formatEther(balance) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get gas price
app.get('/api/gas-price', async (req, res) => {
  try {
    const fee = await provider.getFeeData();
    res.json({ gasPrice: fee.gasPrice?.toString() || '0' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get nonce
app.get('/api/nonce/:address', async (req, res) => {
  try {
    const nonce = await provider.getTransactionCount(req.params.address);
    res.json({ nonce });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send transaction (signed client-side, broadcast here)
app.post('/api/send', async (req, res) => {
  try {
    const { signedTx } = req.body;
    const tx = await provider.broadcastTransaction(signedTx);
    res.json({ hash: tx.hash });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Sign and send (private key stays in memory only during request)
app.post('/api/send-tx', async (req, res) => {
  try {
    const { privateKey, to, amount } = req.body;
    const wallet = new ethers.Wallet(privateKey, provider);
    const tx = await wallet.sendTransaction({
      to,
      value: ethers.parseEther(amount),
    });
    res.json({ hash: tx.hash });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get transaction history (recent blocks)
app.get('/api/history/:address', async (req, res) => {
  try {
    const addr = req.params.address.toLowerCase();
    const latest = await provider.getBlockNumber();
    const txs = [];
    const scan = Math.min(100, latest);

    for (let i = latest; i > latest - scan && i >= 0; i--) {
      const block = await provider.getBlock(i, true);
      if (!block || !block.transactions) continue;
      for (const tx of block.transactions) {
        const t = typeof tx === 'string' ? null : tx;
        if (!t) continue;
        if (t.from?.toLowerCase() === addr || t.to?.toLowerCase() === addr) {
          txs.push({
            hash: t.hash,
            from: t.from,
            to: t.to,
            value: ethers.formatEther(t.value),
            blockNumber: block.number,
            timestamp: block.timestamp,
          });
        }
      }
      if (txs.length >= 20) break;
    }
    res.json({ transactions: txs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// QR code for address
app.get('/api/qr/:address', async (req, res) => {
  try {
    const qr = await QRCode.toDataURL(req.params.address);
    res.json({ qr });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Chain info
app.get('/api/chain', async (req, res) => {
  try {
    const [blockNumber, network] = await Promise.all([
      provider.getBlockNumber(),
      provider.getNetwork(),
    ]);
    res.json({ blockNumber, chainId: Number(network.chainId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TTL Coin Wallet running at http://localhost:${PORT}`);
});
