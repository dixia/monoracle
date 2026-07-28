import "dotenv/config";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const ONE_ETH = ethers.parseEther("1");

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error("Set PRIVATE_KEY env var"); process.exit(1); }
const RPC_URL = process.env.RPC_URL || "https://testnet-rpc.monad.xyz";
const CHAIN_ID = Number(process.env.CHAIN_ID || 10143);

function getAbi(name) {
  const p = path.join(rootDir, "artifacts", "contracts", name + ".sol", name + ".json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  console.log("=== Deploy Monoracle to Monad Testnet ===\n");

  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const addr = await wallet.getAddress();

  console.log(`Deployer: ${addr}`);
  const balance = await provider.getBalance(addr);
  console.log(`Balance:  ${ethers.formatEther(balance)} MON`);

  if (balance < ethers.parseEther("0.01")) {
    console.error("ERROR: Insufficient MON balance for deployment.");
    process.exit(1);
  }

  // Compile first
  console.log("\nEnsuring contracts are compiled...");
  const { execSync } = await import("child_process");
  execSync("npx hardhat compile", { cwd: rootDir, stdio: "pipe" });

  // Deploy oracle
  console.log("Deploying Monoracle...");
  const oracleAbi = getAbi("Monoracle");
  const oracleFactory = new ethers.ContractFactory(oracleAbi.abi, oracleAbi.bytecode, wallet);

  // Estimate gas for Monad (charged by limit, so be precise)
  const deployTx = await oracleFactory.getDeployTransaction();
  const estimatedGas = await wallet.estimateGas(deployTx);
  const gasLimit = estimatedGas * 120n / 100n; // 20% buffer for Monad
  console.log(`Estimated gas: ${estimatedGas}, using limit: ${gasLimit}`);

  const oracle = await oracleFactory.deploy({ gasLimit });
  await oracle.waitForDeployment();

  console.log(`\nMonoracle deployed at: ${oracle.target}`);
  console.log(`Tx hash: ${oracle.deploymentTransaction().hash}`);

  // Save deployment
  const deployInfo = {
    network: "monad-testnet",
    chainId: CHAIN_ID,
    address: oracle.target,
    txHash: oracle.deploymentTransaction().hash,
    deployer: addr,
    timestamp: new Date().toISOString(),
  };
  const deployPath = path.join(rootDir, "deployment.json");
  fs.writeFileSync(deployPath, JSON.stringify(deployInfo, null, 2));
  console.log(`Saved to: ${deployPath}`);

  // Validate
  const slots = await oracle.VERIFICATION_SLOTS();
  const nextId = await oracle.nextQuoteId();
  console.log(`\nValidation:`);
  console.log(`  VERIFICATION_SLOTS = ${slots}`);
  console.log(`  nextQuoteId = ${nextId}`);

  console.log(`\n=== Done ===`);
  console.log(`Explorer: https://testnet.monadscan.com/address/${oracle.target}`);
}

main().catch(e => {
  console.error("Deployment failed:", e.shortMessage || e.message);
  if (e.info) console.error("  Info:", JSON.stringify(e.info, null, 2));
  process.exit(1);
});
