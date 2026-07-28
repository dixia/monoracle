import artifact from "./abi.json";

function requireEnv(name: string, val: string | undefined): string {
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const CONTRACT_ADDRESS = requireEnv("NEXT_PUBLIC_ORACLE_ADDRESS", process.env.NEXT_PUBLIC_ORACLE_ADDRESS);
export const CONTRACT_ABI = artifact.abi;
export const EXPLORER_BASE = "https://testnet.monadscan.com";
export const EXPLORER_URL = `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`;
export const RPC_URL = requireEnv("NEXT_PUBLIC_RPC_URL", process.env.NEXT_PUBLIC_RPC_URL);
export const CHAIN_ID = Number(requireEnv("NEXT_PUBLIC_CHAIN_ID", process.env.NEXT_PUBLIC_CHAIN_ID));

export const TEST_TOKENS = {
  BASE: {
    address: requireEnv("NEXT_PUBLIC_BASE_TOKEN", process.env.NEXT_PUBLIC_BASE_TOKEN),
    symbol: "BASE",
    decimals: 18,
  },
  QUOTE: {
    address: requireEnv("NEXT_PUBLIC_QUOTE_TOKEN", process.env.NEXT_PUBLIC_QUOTE_TOKEN),
    symbol: "QUOTE",
    decimals: 18,
  },
};
