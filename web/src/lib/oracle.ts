import abi from "./abi.json";

export const CONTRACT_ADDRESS = "0xF92A55D4e22456C987b3e7AF2E3730b3f5022Ccb";
export const CONTRACT_ABI = abi;
export const EXPLORER_URL = `https://testnet.monadscan.com/address/${CONTRACT_ADDRESS}`;
export const RPC_URL = "https://testnet-rpc.monad.xyz";
export const CHAIN_ID = 10143;

// Test tokens deployed on Monad testnet for e2e testing
export const TEST_TOKENS = {
  BASE: { address: "0xAf078b1cAb4797bA018C8354913eaE22f0f1F719", symbol: "BASE", decimals: 18 },
  QUOTE: { address: "0x3c34C844EeaeCbc760a74723FC67d8DF49a05093", symbol: "QUOTE", decimals: 18 },
};
