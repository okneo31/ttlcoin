const { ethers } = require('ethers');
const solc = require('solc');
const fs = require('fs');
const path = require('path');

const POLYGON_RPC = process.env.POLYGON_RPC || 'https://polygon-rpc.com';
const PRIVATE_KEY = process.env.ANCHOR_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('Set ANCHOR_PRIVATE_KEY env var');
  process.exit(1);
}

async function main() {
  // Compile
  const source = fs.readFileSync(path.join(__dirname, 'TTLAnchor.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'TTLAnchor.sol': { content: source } },
    settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    const errs = output.errors.filter((e) => e.severity === 'error');
    if (errs.length > 0) {
      console.error('Compilation errors:', errs.map((e) => e.message).join('\n'));
      process.exit(1);
    }
  }

  const contract = output.contracts['TTLAnchor.sol']['TTLAnchor'];
  const abi = contract.abi;
  const bytecode = '0x' + contract.evm.bytecode.object;

  // Save ABI
  fs.writeFileSync(path.join(__dirname, 'abi.json'), JSON.stringify(abi, null, 2));
  console.log('ABI saved to abi.json');

  // Deploy
  const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log('Deploying from:', wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log('Balance:', ethers.formatEther(balance), 'MATIC');

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const deployed = await factory.deploy();
  await deployed.waitForDeployment();

  const address = await deployed.getAddress();
  console.log('TTLAnchor deployed at:', address);

  // Save config
  const config = {
    contractAddress: address,
    polygonRpc: POLYGON_RPC,
    chainId: 137,
    abi: 'abi.json',
  };
  fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
  console.log('Config saved to config.json');
}

main().catch(console.error);
