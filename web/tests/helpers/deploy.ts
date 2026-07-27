import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { hardhat } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

import fs from "fs";
import path from "path";

const ROOT_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

function loadArtifact(name: string) {
  const artifactPath = path.join(
    ROOT_DIR,
    "artifacts",
    "contracts",
    `${name}.sol`,
    `${name}.json`
  );
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

export interface DeployedContracts {
  oracle: Address;
  baseToken: Address;
  quoteToken: Address;
}

/**
 * Deploys Monoracle + 2 MockERC20 tokens to the running Hardhat node.
 * Uses Hardhat Account #0 (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)
 * which has 10000 ETH by default.
 */
export async function deployContracts(): Promise<DeployedContracts> {
  const transport = http("http://localhost:8545");

  const publicClient = createPublicClient({
    chain: hardhat,
    transport,
  });

  // Hardhat Account #0 private key
  const ACCOUNT_0_PK =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

  const walletClient = createWalletClient({
    chain: hardhat,
    transport,
    account: privateKeyToAccount(ACCOUNT_0_PK),
  });

  const oracleHash = await walletClient.deployContract({
    abi: loadArtifact("Monoracle").abi,
    bytecode: loadArtifact("Monoracle").bytecode as Hex,
  });
  const oracleReceipt = await publicClient.waitForTransactionReceipt({ hash: oracleHash });
  const oracleAddr = oracleReceipt.contractAddress!;

  const baseHash = await walletClient.deployContract({
    abi: loadArtifact("MockERC20").abi,
    bytecode: loadArtifact("MockERC20").bytecode as Hex,
    args: ["Base Token", "BASE", 18],
  });
  const baseReceipt = await publicClient.waitForTransactionReceipt({ hash: baseHash });
  const baseTokenAddr = baseReceipt.contractAddress!;

  const quoteHash = await walletClient.deployContract({
    abi: loadArtifact("MockERC20").abi,
    bytecode: loadArtifact("MockERC20").bytecode as Hex,
    args: ["Quote Token", "QUOTE", 18],
  });
  const quoteReceipt = await publicClient.waitForTransactionReceipt({ hash: quoteHash });
  const quoteTokenAddr = quoteReceipt.contractAddress!;

  // Mint tokens to Account #0
  const ACCOUNT_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

  const mintABI = [
    {
      type: "function",
      name: "mint",
      stateMutability: "nonpayable",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ type: "bool" }],
    },
  ] as const;

  // Mint 10000 BASE and 10000000 QUOTE to Account #0
  await walletClient.writeContract({
    address: baseTokenAddr,
    abi: mintABI,
    functionName: "mint",
    args: [ACCOUNT_0, 10000n * 10n ** 18n],
  });

  await walletClient.writeContract({
    address: quoteTokenAddr,
    abi: mintABI,
    functionName: "mint",
    args: [ACCOUNT_0, 10000000n * 10n ** 18n],
  });

  console.log(`Deployed Monoracle: ${oracleAddr}`);
  console.log(`Deployed BASE:      ${baseTokenAddr}`);
  console.log(`Deployed QUOTE:     ${quoteTokenAddr}`);

  return { oracle: oracleAddr, baseToken: baseTokenAddr, quoteToken: quoteTokenAddr };
}
