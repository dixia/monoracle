# Monoracle Verifier Bot

Reference implementation of a Monoracle verifier bot. Monitors `QuoteSubmitted` events via WebSocket, compares quoted prices against a configurable fair price, and auto-vetoes mispriced quotes within the 2-slot verification window (~600ms on Monad testnet).

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env: set PRIVATE_KEY to your verifier wallet's key

# Run the bot
python verifier.py
```

## How It Works

```
WebSocket → QuoteSubmitted event detected
    │
    ├─ Extract: quoteId, baseToken, quoteToken, quote.price
    │
    ├─ Look up fair price from FAIR_PRICES[(baseToken, quoteToken)]
    │
    ├─ Compute: deviation = |quote.price - fair_price| / fair_price
    │
    ├─ if deviation * 10000 < THRESHOLD_BPS → IGNORE (not profitable)
    │
    ├─ if quote.price < fair_price → vetoUnderpriced(quoteId)
    │    Verifier pays quoteAmount QUOTE, receives baseAmount BASE
    │
    └─ if quote.price > fair_price → vetoOverpriced(quoteId)
         Verifier pays baseAmount BASE, receives quoteAmount QUOTE
```

## Demo Flow

1. Start the bot, pre-approves BASE and QUOTE tokens for the oracle
2. Submit a quote on the frontend
3. Bot detects the event, compares against FAIR_PRICES, vetoes if mispriced
4. Watch logs for veto tx hash and confirmation

## Configuration

See `.env.example` for all parameters:

| Parameter | Default | Description |
|---|---|---|---|
| `PRIVATE_KEY` | (required) | Verifier wallet private key |
| `RPC_WS_URL` | `wss://testnet-rpc.monad.xyz` | Monad WebSocket RPC (veto tx) |
| `RPC_HTTP_URL` | `https://testnet-rpc.monad.xyz` | Monad HTTP RPC (event polling) |
| `ORACLE_ADDRESS` | `0xF92A...` | Monoracle contract |
| `MONITORED_PAIRS` | `BASE,QUOTE,100` | Pairs to watch (token,token,fair_price) |
| `THRESHOLD_BPS` | `100` | Min deviation in bps (100 = 1%) |
| `CATCH_UP_BLOCKS` | `10` | Recent blocks scanned on startup |
| `GAS_LIMIT_VETO` | `120000` | Veto tx gas limit |

## Production Deployment

Replace the artificial `FAIR_PRICES` dict with a real price feed:

```python
# Instead of:
FAIR_PRICES = {(base, quote): 100 * 10**18}

# Use:
def get_fair_price(base_token: str, quote_token: str) -> int:
    # Example: fetch from most liquid CEX or DEX
    response = requests.get(f"https://api.binance.com/api/v3/ticker/price?symbol=MONUSDC")
    return int(float(response.json()["price"]) * 1e18)
```

For maximum speed (critical within the 600ms window), consider:
1. Co-locating the bot near a Monad RPC node
2. Using a local price cache updated every 100ms
3. Pre-signing common veto calldata
4. Maintaining a hot wallet with pre-approved tokens
