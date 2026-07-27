import abi from "./abi.json";

export const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_ORACLE_ADDRESS ||
  "0xF92A55D4e22456C987b3e7AF2E3730b3f5022Ccb";
export const CONTRACT_ABI = abi;
export const EXPLORER_URL = `https://testnet.monadscan.com/address/${CONTRACT_ADDRESS}`;
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "https://testnet-rpc.monad.xyz";
export const CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_CHAIN_ID || 10143
);

export const TEST_TOKENS = {
  BASE: {
    address:
      process.env.NEXT_PUBLIC_BASE_TOKEN ||
      "0xAf078b1cAb4797bA018C8354913eaE22f0f1F719",
    symbol: "BASE",
    decimals: 18,
  },
  QUOTE: {
    address:
      process.env.NEXT_PUBLIC_QUOTE_TOKEN ||
      "0x3c34C844EeaeCbc760a74723FC67d8DF49a05093",
    symbol: "QUOTE",
    decimals: 18,
  },
};
