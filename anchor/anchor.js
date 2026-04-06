const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const TTL_RPC = process.env.TTL_RPC || 'http://localhost:8545';
const POLYGON_RPC = process.env.POLYGON_RPC || 'https://polygon-rpc.com';
const PRIVATE_KEY = process.env.ANCHOR_PRIVATE_KEY;
const INTERVAL = parseInt(process.env.ANCHOR_INTERVAL) || 100; // Every N blocks

if (!PRIVATE_KEY) {
  console.error('Set ANCHOR_PRIVATE_KEY env var');
  process.exit(1);
}

const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('Run deploy.js first');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const abi = JSON.parse(fs.readFileSync(path.join(__dirname, config.abi), 'utf8'));

const ttlProvider = new ethers.JsonRpcProvider(TTL_RPC);
const polygonProvider = new ethers.JsonRpcProvider(POLYGON_RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, polygonProvider);
const contract = new ethers.Contract(config.contractAddress, abi, wallet);

let lastAnchored = 0;

async function doAnchor() {
  try {
    const blockNumber = await ttlProvider.getBlockNumber();

    // Anchor every INTERVAL blocks
    const targetBlock = Math.floor(blockNumber / INTERVAL) * INTERVAL;
    if (targetBlock <= lastAnchored || targetBlock === 0) return;

    const block = await ttlProvider.getBlock(targetBlock);
    if (!block) return;

    console.log(`Anchoring TTL block #${targetBlock}...`);
    console.log(`  Hash: ${block.hash}`);
    console.log(`  StateRoot: ${block.stateRoot}`);

    const tx = await contract.anchor(
      targetBlock,
      block.hash,
      block.stateRoot,
      { gasLimit: 100000 }
    );
    console.log(`  Polygon TX: ${tx.hash}`);
    await tx.wait();
    console.log(`  Confirmed!`);

    lastAnchored = targetBlock;
  } catch (e) {
    console.error('Anchor error:', e.message);
  }
}

async function init() {
  try {
    const latest = await contract.latest();
    lastAnchored = Number(latest.ttlBlockNumber);
    console.log(`Last anchored: TTL block #${lastAnchored}`);
  } catch (e) {
    lastAnchored = 0;
  }
}

async function run() {
  console.log(`TTL Chain Anchor Service`);
  console.log(`  TTL RPC: ${TTL_RPC}`);
  console.log(`  Polygon: ${POLYGON_RPC}`);
  console.log(`  Contract: ${config.contractAddress}`);
  console.log(`  Interval: every ${INTERVAL} blocks`);

  await init();

  // Check immediately
  await doAnchor();

  // Then poll every 30 seconds
  setInterval(doAnchor, 30000);
}

run().catch(console.error);
