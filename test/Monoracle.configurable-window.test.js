/**
 * Monoracle — configurable per-quote verification window (CWV-01).
 *
 * Independent Hardhat suite for the windowed oracle semantics on the existing
 * `Monoracle.sol`: the verification window is chosen per quote at submit time via
 * `expiryBlock` instead of a fixed 2-slot constant. A quote is vetoable while
 * `block.number <= expiryBlock` (inclusive) and settleable only after that block.
 * The window length is capped by `MAX_VERIFICATION_SLOTS` so a provider cannot
 * grief by locking collateral for an unbounded duration.
 *
 * Note: milestone #1 ("Parameterize window in Monoracle.sol") is the pending
 * contract change these tests target; they are expected to fail to submit until
 * `submitQuote` accepts `expiryBlock` and `MAX_VERIFICATION_SLOTS` is defined.
 *
 * Test fixtures:
 *   - baseAmount = 3 BASE, quoteAmount = 150 QUOTE  => price = 50 QUOTE / BASE
 *   - provider & verifier each funded with 1000 BASE and 1,000,000 QUOTE
 *   - allowances are pre-approved at max so nothing burns a verification slot
 */
import { expect } from "chai";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();
const ETHER = 10n ** 18n;

describe("Monoracle: per-quote expiry window (CWV-01)", function () {
  let oracle, base, quote, provider, verifier;

  beforeEach(async function () {
    [provider, verifier] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("Monoracle");
    oracle = await Oracle.deploy();

    const Token = await ethers.getContractFactory("MockERC20");
    base = await Token.deploy("Anchor", "ANCHOR", 18);
    quote = await Token.deploy("Settle", "SETTLE", 18);

    await base.mint(provider.address, 1000n * ETHER);
    await quote.mint(provider.address, 1_000_000n * ETHER);
    await base.mint(verifier.address, 1000n * ETHER);
    await quote.mint(verifier.address, 1_000_000n * ETHER);

    await base.connect(provider).approve(oracle.target, ethers.MaxUint256);
    await quote.connect(provider).approve(oracle.target, ethers.MaxUint256);
    await base.connect(verifier).approve(oracle.target, ethers.MaxUint256);
    await quote.connect(verifier).approve(oracle.target, ethers.MaxUint256);
  });

  const PROVIDER_BASE = () => 1000n * ETHER;
  const PROVIDER_QUOTE = () => 1_000_000n * ETHER;
  const VERIFIER_BASE = () => 1000n * ETHER;
  const VERIFIER_QUOTE = () => 1_000_000n * ETHER;
  const BASE_LEG = () => 3n * ETHER;
  const QUOTE_LEG = () => 150n * ETHER;

  async function height() {
    return await ethers.provider.getBlockNumber();
  }

  async function advance(n) {
    await networkHelpers.mine(n);
  }

  // Opens a quote for BASE_LEG/QUOTE_LEG (price = QUOTE_LEG / BASE_LEG = 50).
  async function openQuote(expiry) {
    return await oracle.connect(provider).submitQuote(
      base.target,
      quote.target,
      BASE_LEG(),
      QUOTE_LEG(),
      expiry
    );
  }

  const pairId = () =>
    ethers.keccak256(
      ethers.solidityPacked(["address", "address"], [base.target, quote.target])
    );

  describe("submission window validation", function () {
    it("rejects a non-future expiry at submit time", async function () {
      const now = await height();
      await expect(openQuote(now))
        .to.be.revertedWithCustomError(oracle, "ExpiryMustBeFuture");
    });

    it("rejects an expiry beyond the maximum slot allowance", async function () {
      const cap = await oracle.MAX_VERIFICATION_SLOTS();

      // allowed: expiry comfortably within the cap (submit lands at now1+1, gap < cap)
      const now1 = await height();
      await expect(openQuote(BigInt(now1) + cap)).to.emit(oracle, "QuoteSubmitted");

      // re-read height (the submit above consumed a block); now2+2 exceeds
      // block.number + MAX_VERIFICATION_SLOTS, so it must revert at submit
      const now2 = await height();
      await expect(openQuote(BigInt(now2) + cap + 2n))
        .to.be.revertedWithCustomError(oracle, "ExpiryTooFar");
    });
  });

  describe("quote ledger and event payload", function () {
    it("persists expiryBlock, keeps status ACTIVE, and emits the expiry", async function () {
      const now = await height();
      const expiry = BigInt(now) + 100n;

      const receipt = await (await openQuote(expiry)).wait();
      const log = receipt.logs.find((l) => l.fragment?.name === "QuoteSubmitted");
      expect(log).to.exist;

      const args = log.args;
      expect(args[0]).to.equal(1n);                      // quoteId
      expect(args[1]).to.equal(provider.address);        // provider
      expect(args[2]).to.equal(base.target);             // baseToken
      expect(args[3]).to.equal(quote.target);            // quoteToken
      expect(args[4]).to.equal(BASE_LEG());              // baseAmount
      expect(args[5]).to.equal(QUOTE_LEG());             // quoteAmount
      expect(args[6]).to.equal(50n * ETHER);             // price
      expect(args[8]).to.equal(expiry);                  // expiryBlock

      const q = await oracle.quotes(1);
      expect(q.price).to.equal(50n * ETHER);
      expect(q.startSlot).to.equal(await height());
      expect(q.expiryBlock).to.equal(expiry);
      expect(q.status).to.equal(0n);                     // ACTIVE
    });
  });

  describe("veto inside a long window", function () {
    it("executes the underpriced (LONG) trade far inside the window", async function () {
      const now = await height();
      await openQuote(BigInt(now) + 100n);
      await advance(50); // 50 blocks in: far past the old fixed 2-slot window

      await oracle.connect(verifier).vetoUnderpriced(1);

      // verifier laid out the quote leg, took the base leg
      expect(await base.balanceOf(verifier.address)).to.equal(VERIFIER_BASE() + BASE_LEG());
      expect(await quote.balanceOf(verifier.address)).to.equal(VERIFIER_QUOTE() - QUOTE_LEG());

      // provider forfeits base leg, withdraws double the quote leg;
      // net quote = initial - deposit(QUOTE_LEG) + withdraw(2x QUOTE_LEG)
      expect((await oracle.quotes(1)).status).to.equal(1n); // VETOED_UNDERPRICED
      await oracle.connect(provider).withdrawProviderFunds(1);
      expect(await base.balanceOf(provider.address)).to.equal(PROVIDER_BASE() - BASE_LEG());
      expect(await quote.balanceOf(provider.address)).to.equal(PROVIDER_QUOTE() + QUOTE_LEG());
    });

    it("executes the overpriced (SHORT) trade inside the window", async function () {
      const now = await height();
      await openQuote(BigInt(now) + 100n);

      await oracle.connect(verifier).vetoOverpriced(1);

      // verifier laid out the base leg, took the quote leg
      expect(await base.balanceOf(verifier.address)).to.equal(VERIFIER_BASE() - BASE_LEG());
      expect(await quote.balanceOf(verifier.address)).to.equal(VERIFIER_QUOTE() + QUOTE_LEG());

      // provider forfeits quote leg, withdraws double the base leg;
      // net base = initial - deposit(BASE_LEG) + withdraw(2x BASE_LEG)
      await oracle.connect(provider).withdrawProviderFunds(1);
      expect(await base.balanceOf(provider.address)).to.equal(PROVIDER_BASE() + BASE_LEG());
      expect(await quote.balanceOf(provider.address)).to.equal(PROVIDER_QUOTE() - QUOTE_LEG());
    });
  });

  describe("window boundary enforcement", function () {
    it("refuses settlement while vetoable and vetoes once expired", async function () {
      const now = await height();
      await openQuote(BigInt(now) + 3n);
      await advance(1); // still inside the window

      await expect(oracle.settleValidQuote(1))
        .to.be.revertedWithCustomError(oracle, "VerificationWindowActive");

      await advance(3); // now past expiry
      await expect(oracle.connect(verifier).vetoUnderpriced(1))
        .to.be.revertedWithCustomError(oracle, "VerificationWindowExpired");
    });
  });

  describe("settlement and the canonical price feed", function () {
    it("is absent before settling, then present with the right price", async function () {
      const now = await height();
      await openQuote(BigInt(now) + 2n);

      const before = await oracle.getLatestPrice(base.target, quote.target);
      expect(before[2]).to.equal(false);
      expect(before[0]).to.equal(0n);

      await advance(3);
      await oracle.settleValidQuote(1);

      const after = await oracle.getLatestPrice(base.target, quote.target);
      expect(after[2]).to.equal(true);
      expect(after[0]).to.equal(50n * ETHER);
    });

    it("gives the canonical mark to the last-settled quote", async function () {
      const now = await height();
      const expiry = BigInt(now) + 10n;
      await openQuote(expiry); // round opener
      await openQuote(expiry); // round closer / final quote

      await advance(11);

      // settle oldest first so the final quote is settled LAST
      await oracle.settleValidQuote(1);
      await oracle.settleValidQuote(2);

      expect(await oracle.latestValidQuoteId(pairId())).to.equal(2n);
      const latest = await oracle.getLatestPrice(base.target, quote.target);
      expect(latest[2]).to.equal(true);
      expect(latest[0]).to.equal(50n * ETHER);
    });
  });

  describe("two-slot backward compatibility", function () {
    it("lets a +2 quote be vetoed one block in, like the old fixed window", async function () {
      const now = await height();
      // submit lands at now+1, so expiry = now+3 == startSlot + 2 (the fixed-window default)
      await openQuote(BigInt(now) + 3n);
      await advance(1);

      await expect(oracle.connect(verifier).vetoUnderpriced(1))
        .to.emit(oracle, "QuoteVetoedUnderpriced")
        .withArgs(1, verifier.address);

      expect((await oracle.quotes(1)).status).to.equal(1n);
    });

    it("lets a +2 quote be settled after the window closes", async function () {
      const now = await height();
      await openQuote(BigInt(now) + 2n);
      await advance(3);

      await expect(oracle.settleValidQuote(1))
        .to.emit(oracle, "QuoteSettledValid")
        .withArgs(1, 50n * ETHER);
    });
  });
});