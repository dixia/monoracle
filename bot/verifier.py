# -*- coding: utf-8 -*-
"""Monoracle Veto Bot - Watches QuoteSubmitted events and auto-vetoes mispriced quotes.

Designed for Monad's 2-slot (~600ms) verification window.
Uses WebSocket RPC + artificial price feed (configurable per-pair).
"""

import os
import sys
import json
import time
import logging
from pathlib import Path
from typing import Dict, Tuple

from web3 import Web3
from dotenv import load_dotenv

# —— Config ——
ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
load_dotenv(Path(__file__).parent / ".env", override=True)

PRIVATE_KEY = os.getenv("PRIVATE_KEY")
if not PRIVATE_KEY:
    print("ERROR: Set PRIVATE_KEY in .env"); sys.exit(1)

RPC_WS_URL      = os.getenv("RPC_WS_URL",      "wss://testnet-rpc.monad.xyz")
RPC_HTTP_URL    = os.getenv("RPC_HTTP_URL",    "https://testnet-rpc.monad.xyz")
ORACLE_ADDRESS  = os.getenv("ORACLE_ADDRESS",  "0xF92A55D4e22456C987b3e7AF2E3730b3f5022Ccb")
THRESHOLD_BPS   = int(os.getenv("THRESHOLD_BPS",   "100"))   # 100 bps = 1%
GAS_LIMIT_VETO  = int(os.getenv("GAS_LIMIT_VETO",  "120000"))
CATCH_UP_BLOCKS = int(os.getenv("CATCH_UP_BLOCKS", "10"))
LOG_LEVEL       = os.getenv("LOG_LEVEL",        "INFO")

MONITORED_PAIRS = os.getenv("MONITORED_PAIRS", "")
if not MONITORED_PAIRS:
    print("ERROR: Set MONITORED_PAIRS in .env"); sys.exit(1)

# -- Logging ───────────────────────────────────────────────────────────────
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("vetobot")

# -- Web3 Setup ────────────────────────────────────────────────────────────
MAX_UINT256 = 2**256 - 1
w3 = Web3(Web3.LegacyWebSocketProvider(RPC_WS_URL))
if not w3.is_connected():
    log.error("Cannot connect to %s", RPC_WS_URL); sys.exit(1)

w3_http = Web3(Web3.HTTPProvider(RPC_HTTP_URL))
if not w3_http.is_connected():
    log.error("Cannot connect to %s", RPC_HTTP_URL); sys.exit(1)

account = w3.eth.account.from_key(PRIVATE_KEY)
VERIFIER = account.address
log.info("Verifier: %s", VERIFIER)

# -- ABI ───────────────────────────────────────────────────────────────────
ORG_ABI = json.loads((ROOT / "artifacts" / "contracts" / "Monoracle.sol" / "Monoracle.json").read_text())["abi"]
oracle = w3.eth.contract(address=ORACLE_ADDRESS, abi=ORG_ABI)

ERC20_ABI = [
    {"type": "function", "name": "approve", "stateMutability": "nonpayable",
     "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
     "outputs": [{"type": "bool"}]},
    {"type": "function", "name": "allowance", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}],
     "outputs": [{"type": "uint256"}]},
]

# -- Pair Configuration ────────────────────────────────────────────────────
# FAIR_PRICES: dict mapping (baseToken_lower, quoteToken_lower) -> fair_price (1e18)
FAIR_PRICES: Dict[Tuple[str, str], int] = {}
monitored_tokens: Dict[str, str] = {}  # lowercase -> checksummed

for pair_str in MONITORED_PAIRS.split(";"):
    parts = [p.strip() for p in pair_str.split(",")]
    if len(parts) != 3:
        continue
    base, quote, fair = parts
    base_cs = Web3.to_checksum_address(base)
    quote_cs = Web3.to_checksum_address(quote)
    fair_price = int(fair)
    FAIR_PRICES[(base.lower(), quote.lower())] = fair_price
    monitored_tokens[base.lower()] = base_cs
    monitored_tokens[quote.lower()] = quote_cs
    log.info("Pair: %s/%s  fair=%d (%.2f)",
             base_cs[:10] + "...", quote_cs[:10] + "...",
             fair_price, fair_price / 1e18)

if not FAIR_PRICES:
    log.error("No valid pairs configured"); sys.exit(1)

# -- Token Approval ────────────────────────────────────────────────────────
def ensure_approval(addr_lower: str):
    addr = monitored_tokens[addr_lower]
    token = w3.eth.contract(address=addr, abi=ERC20_ABI)
    try:
        current = token.functions.allowance(VERIFIER, ORACLE_ADDRESS).call()
    except Exception:
        current = 0
    if current >= MAX_UINT256 // 2:
        return
    log.info("Approving %s...", addr[:10] + "...")
    tx = token.functions.approve(ORACLE_ADDRESS, MAX_UINT256).build_transaction({
        "from": VERIFIER, "gas": 80000,
        "gasPrice": w3.eth.gas_price, "nonce": w3.eth.get_transaction_count(VERIFIER),
    })
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    w3.eth.wait_for_transaction_receipt(tx_hash)
    log.info("  Approved: %s", tx_hash.hex()[:16] + "...")

def pre_approve():
    """Approve oracle for all monitored tokens."""
    done = set()
    for (base, quote) in FAIR_PRICES:
        for t in (base, quote):
            if t not in done:
                ensure_approval(t)
                done.add(t)

# -- Veto Transaction ──────────────────────────────────────────────────────
def send_veto(tx_fn, label: str) -> str | None:
    """Build, sign, and send a veto tx. Returns tx hash or None."""
    try:
        tx = tx_fn.build_transaction({
            "from": VERIFIER, "gas": GAS_LIMIT_VETO,
            "gasPrice": w3.eth.gas_price,
            "nonce": w3.eth.get_transaction_count(VERIFIER),
        })
        signed = account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        log.info("  %s -> %s", label, tx_hash.hex())
        return tx_hash
    except Exception as e:
        log.error("  %s failed: %s", label, str(e)[:120])
        return None

# -- Price Check & Veto Decision ───────────────────────────────────────────
def check_and_veto(raw_log):
    """Parse a QuoteSubmitted log and decide whether to veto."""
    try:
        event = oracle.events.QuoteSubmitted().process_log(raw_log)
    except Exception:
        return

    args      = event["args"]
    quote_id  = args["quoteId"]
    base_tok  = args["baseToken"]
    quote_tok = args["quoteToken"]
    price     = args["price"]         # 1e18 fixed-point
    start_slot= args["startSlot"]

    pair_key = (base_tok.lower(), quote_tok.lower())
    fair_price = FAIR_PRICES.get(pair_key)
    if fair_price is None:
        return

    # Deviation in basis points
    deviation = abs(price - fair_price) * 10000 // fair_price

    log.info("Quote #%d  price=%.2f  fair=%.2f  dev=%d bps  slot=%d",
             quote_id, price / 1e18, fair_price / 1e18, deviation, start_slot)

    if deviation < THRESHOLD_BPS:
        log.info("  -> Skipped (< %d bps threshold)", THRESHOLD_BPS)
        return

    current_block = w3.eth.block_number
    if current_block > start_slot + 2:
        log.warning("  -> Window expired (start=%d, end=%d, current=%d)",
                     start_slot, start_slot + 2, current_block)
        return

    if price < fair_price:
        log.info("  -> Underpriced VETO")
        send_veto(oracle.functions.vetoUnderpriced(quote_id),
                  "vetoUnderpriced")
    else:
        log.info("  -> Overpriced VETO")
        send_veto(oracle.functions.vetoOverpriced(quote_id),
                  "vetoOverpriced")

# -- Event Monitor ─────────────────────────────────────────────────────────
# Event signature: QuoteSubmitted(uint256,address,address,address,uint256,uint256,uint256,uint32)
QUOTE_SUBMITTED_SIG = (
    "QuoteSubmitted(uint256,address,address,address,uint256,uint256,uint256,uint32)"
)
QUOTE_SUBMITTED_TOPIC = Web3.keccak(text=QUOTE_SUBMITTED_SIG)

def event_loop():
    pre_approve()

    # Catch up on recent blocks (in case of restart)
    latest = w3_http.eth.block_number
    start = max(latest - CATCH_UP_BLOCKS, 0)
    log.info("Catching up block %d → %d", start, latest)
    for blk in range(start, latest + 1):
        try:
            logs = w3_http.eth.get_logs({
                "fromBlock": blk, "toBlock": blk,
                "address": ORACLE_ADDRESS,
                "topics": [QUOTE_SUBMITTED_TOPIC],
            })
        except Exception:
            continue
        for raw_log in logs:
            check_and_veto(raw_log)

    log.info("Listening from block %d", latest)

    while True:
        try:
            current = w3_http.eth.block_number
            if current <= latest:
                time.sleep(0.1)
                continue

            # Scan each new block via HTTP (reliable get_logs)
            for blk in range(latest + 1, current + 1):
                try:
                    logs = w3_http.eth.get_logs({
                        "fromBlock": blk, "toBlock": blk,
                        "address": ORACLE_ADDRESS,
                        "topics": [QUOTE_SUBMITTED_TOPIC],
                    })
                except Exception:
                    continue
                for raw_log in logs:
                    check_and_veto(raw_log)

            latest = current
        except Exception as e:
            log.error("Loop error: %s", str(e)[:120])
            time.sleep(1)
            try:
                latest = w3_http.eth.block_number
            except Exception:
                pass

# -- Entry Point ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=== Monoracle Veto Bot ===")
    print(f"  Verifier:  {VERIFIER}")
    print(f"  Oracle:    {ORACLE_ADDRESS}")
    print(f"  Threshold: {THRESHOLD_BPS} bps ({THRESHOLD_BPS / 100:.2f}%)")
    print(f"  Pairs:     {len(FAIR_PRICES)}")
    print(f"  WS RPC:    {RPC_WS_URL}")
    print(f"  HTTP RPC:  {RPC_HTTP_URL}")
    print()
    try:
        event_loop()
    except KeyboardInterrupt:
        log.info("Shutting down.")
