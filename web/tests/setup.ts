import { type ChildProcess, spawn } from "child_process";
import fs from "fs";
import path from "path";

const ROOT_DIR = path.resolve(import.meta.dirname!, "..", "..");

let hardhatProcess: ChildProcess | null = null;

async function waitForHardhat(maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch("http://localhost:8545", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Hardhat node did not start within 30 seconds");
}

export default async function globalSetup() {
  console.log("[Setup] Compiling contracts...");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("npx", ["hardhat", "compile"], {
      cwd: ROOT_DIR,
      stdio: "inherit",
      shell: true,
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`hardhat compile failed with code ${code}`));
    });
  });

  console.log("[Setup] Starting Hardhat node...");
  hardhatProcess = spawn("npx", ["hardhat", "node", "--hostname", "127.0.0.1", "--port", "8545"], {
    cwd: ROOT_DIR,
    stdio: "pipe",
    shell: true,
  });

  // Log Hardhat output for debugging
  hardhatProcess.stdout?.on("data", (d: Buffer) => process.stdout.write(`[Hardhat] ${d}`));
  hardhatProcess.stderr?.on("data", (d: Buffer) => process.stderr.write(`[Hardhat] ${d}`));

  await waitForHardhat();
  console.log("[Setup] Hardhat node is ready.");

  console.log("[Setup] Deploying contracts...");
  const { deployContracts } = await import("./helpers/deploy.js");
  const deployed = await deployContracts();

  // Write .env.local so Next.js auto-loads it in development mode
  const webDir = path.resolve(import.meta.dirname!, "..");
  const envPath = path.join(webDir, ".env.local");

  const envContent = [
    `NEXT_PUBLIC_RPC_URL=http://localhost:8545`,
    `NEXT_PUBLIC_CHAIN_ID=31337`,
    `NEXT_PUBLIC_ORACLE_ADDRESS=${deployed.oracle}`,
    `NEXT_PUBLIC_BASE_TOKEN=${deployed.baseToken}`,
    `NEXT_PUBLIC_QUOTE_TOKEN=${deployed.quoteToken}`,
    "",
  ].join("\n");

  // Write .env.local
  fs.writeFileSync(envPath, envContent);

  // Also write a JSON file for test imports (not env-dependent)
  fs.writeFileSync(
    path.join(webDir, "tests", "helpers", "addresses.json"),
    JSON.stringify(deployed, null, 2)
  );

  console.log(`[Setup] Deployed addresses:`);
  console.log(`  ORACLE: ${deployed.oracle}`);
  console.log(`  BASE:   ${deployed.baseToken}`);
  console.log(`  QUOTE:  ${deployed.quoteToken}`);

  // Store the process reference for teardown
  (globalThis as any).__hardhatProcess = hardhatProcess;
}
