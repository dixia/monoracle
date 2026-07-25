import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error("Set PRIVATE_KEY env var"); process.exit(1); }
const RPC_URL = "https://testnet-rpc.monad.xyz";
const CHAIN_ID = 10143;
const ORACLE_ADDRESS = "0xF92A55D4e22456C987b3e7AF2E3730b3f5022Ccb";

const TOKENS = {
  BASE: { address: "0xAf078b1cAb4797bA018C8354913eaE22f0f1F719", symbol: "BASE" },
  QUOTE: { address: "0x3c34C844EeaeCbc760a74723FC67d8DF49a05093", symbol: "QUOTE" },
};

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const addr = await wallet.getAddress();
  console.log(`Wallet: ${addr}`);

  const AMOUNT = ethers.parseEther("1000000");

  for (const [key, token] of Object.entries(TOKENS)) {
    const contract = new ethers.Contract(token.address, ERC20_ABI, wallet);

    const balance = await contract.balanceOf(addr);
    console.log(`\n${token.symbol} balance: ${ethers.formatEther(balance)}`);

    const allowance = await contract.allowance(addr, ORACLE_ADDRESS);
    console.log(`Current allowance to oracle: ${ethers.formatEther(allowance)}`);

    if (allowance >= AMOUNT) {
      console.log(`Allowance sufficient, skipping.`);
      continue;
    }

    console.log(`Approving ${AMOUNT} ${token.symbol} for oracle...`);
    const tx = await contract.approve(ORACLE_ADDRESS, AMOUNT, {
      gasLimit: 100000,
    });
    console.log(`Tx: ${tx.hash}`);
    const rcpt = await tx.wait();
    console.log(`Confirmed in block ${rcpt.blockNumber}`);
  }

  console.log(`\nDone. You can now submit a quote on the frontend.`);
}

main().catch(e => {
  console.error("Failed:", e.shortMessage || e.message || e);
  process.exit(1);
});
