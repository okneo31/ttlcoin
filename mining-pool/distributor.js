const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) { console.error('Run deploy.js first'); process.exit(1); }

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const abi = JSON.parse(fs.readFileSync(path.join(__dirname, 'abi.json'), 'utf8'));

const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const wallet = new ethers.Wallet(config.ownerKey, provider);
const contract = new ethers.Contract(config.contractAddress, abi, wallet);

// How much of each block reward to distribute (e.g. 50%)
const DISTRIBUTION_RATE = parseInt(process.env.DIST_RATE) || 100; // percent
const INTERVAL = parseInt(process.env.DIST_INTERVAL) || 60; // seconds

let lastDistBlock = 0;

async function distribute() {
  try {
    const blockNumber = await provider.getBlockNumber();
    if (blockNumber <= lastDistBlock) return;

    const minerCount = await contract.activeMinerCount();
    if (minerCount === 0n) {
      lastDistBlock = blockNumber;
      return;
    }

    // Calculate rewards for blocks since last distribution
    // Each block = 7777 TTL reward, we distribute DISTRIBUTION_RATE% to pool
    const newBlocks = blockNumber - lastDistBlock;
    const rewardPerBlock = 7777n;
    const totalReward = rewardPerBlock * BigInt(newBlocks);
    const toDistribute = (totalReward * BigInt(DISTRIBUTION_RATE)) / 100n;
    const amountWei = toDistribute * 10n ** 18n;

    // Check owner balance
    const balance = await provider.getBalance(wallet.address);
    if (balance < amountWei) {
      console.log(`Insufficient balance: ${ethers.formatEther(balance)} TTL, need ${ethers.formatEther(amountWei)} TTL`);
      lastDistBlock = blockNumber;
      return;
    }

    console.log(`Distributing ${ethers.formatEther(amountWei)} TTL for ${newBlocks} blocks to ${minerCount} miners...`);

    const tx = await contract.distribute({ value: amountWei, gasLimit: 500000 });
    await tx.wait();

    console.log(`Distributed! TX: ${tx.hash}`);
    lastDistBlock = blockNumber;
  } catch (e) {
    console.error('Distribution error:', e.message);
  }
}

async function run() {
  console.log(`TTL Mining Pool Distributor`);
  console.log(`  Contract: ${config.contractAddress}`);
  console.log(`  Distribution rate: ${DISTRIBUTION_RATE}%`);
  console.log(`  Interval: ${INTERVAL}s`);

  const minerCount = await contract.activeMinerCount();
  const totalShares = await contract.totalShares();
  console.log(`  Active miners: ${minerCount}, Total shares: ${totalShares}`);

  lastDistBlock = await provider.getBlockNumber();
  console.log(`  Starting from block: ${lastDistBlock}`);

  setInterval(distribute, INTERVAL * 1000);
}

run().catch(console.error);
