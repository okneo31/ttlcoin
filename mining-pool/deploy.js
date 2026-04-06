const { ethers } = require('ethers');
const solc = require('solc');
const fs = require('fs');
const path = require('path');

const RPC_URL = 'http://localhost:8545';
const PRIVATE_KEY = '0xc00ebbac7733f7501148f3e1b44d1fde1d37f83b922208f60e0649c243a2d1e4'; // Signer A
const MIN_DEPOSIT = '0'; // No deposit required for now

async function main() {
  const source = fs.readFileSync(path.join(__dirname, 'MiningPool.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'MiningPool.sol': { content: source } },
    settings: {
      evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    const errs = output.errors.filter((e) => e.severity === 'error');
    if (errs.length > 0) { console.error(errs.map((e) => e.message).join('\n')); process.exit(1); }
  }

  const contract = output.contracts['MiningPool.sol']['MiningPool'];
  const abi = contract.abi;
  const bytecode = '0x' + contract.evm.bytecode.object;

  fs.writeFileSync(path.join(__dirname, 'abi.json'), JSON.stringify(abi, null, 2));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log('Deploying MiningPool from:', wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log('Balance:', ethers.formatEther(balance), 'TTL');

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const deployed = await factory.deploy(ethers.parseEther(MIN_DEPOSIT));
  await deployed.waitForDeployment();

  const address = await deployed.getAddress();
  console.log('MiningPool deployed at:', address);

  const config = { contractAddress: address, rpcUrl: RPC_URL, ownerKey: PRIVATE_KEY };
  fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
  console.log('Config saved');
}

main().catch(console.error);
