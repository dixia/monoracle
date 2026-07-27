import { http, type Hex } from "viem";

/**
 * Mine blank blocks on the Hardhat node to advance block.number.
 * Needed because Hardhat auto-mines one block per transaction,
 * and settleValidQuote requires block.number > startSlot + VERIFICATION_SLOTS (2).
 * After submitQuote (1 block consumed), we need 2 more blocks to settle.
 */
export async function mineBlocks(count: number): Promise<void> {
  const RPC = "http://localhost:8545";
  for (let i = 0; i < count; i++) {
    await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "evm_mine",
        params: [],
      }),
    });
  }
}
