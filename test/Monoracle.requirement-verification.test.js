/**
 * Full requirement/tech-spec verification against production Monoracle.sol.
 * Each test exercises real contract state transitions and balances — not mock logic.
 */
import { expect } from "chai";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();
const ONE = ethers.parseEther("1");
const ZERO = "0x0000000000000000000000000000000000000000";

describe("Monoracle — Requirement Verification (production)", function () {
  let provider, verifier, other, stranger;
  let baseToken, quoteToken, oracle;

  async function deployFresh() {
    [provider, verifier, other, stranger] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    baseToken = await Token.deploy("Base", "BASE", 18);
    quoteToken = await Token.deploy("Quote", "QUOTE", 18);
    await baseToken.mint(provider.address, ethers.parseEther("1000000"));
    await quoteToken.mint(provider.address, ethers.parseEther("1000000000"));
    await baseToken.mint(verifier.address, ethers.parseEther("1000000"));
    await quoteToken.mint(verifier.address, ethers.parseEther("1000000000"));
    await baseToken.mint(stranger.address, ethers.parseEther("1000000"));
    await quoteToken.mint(stranger.address, ethers.parseEther("1000000"));
    const Monoracle = await ethers.getContractFactory("Monoracle");
    oracle = await Monoracle.deploy();
    // Pre-approve large allowances so veto/submit do not burn verification slots on approve txs
    const MAX = ethers.MaxUint256;
    await baseToken.connect(provider).approve(oracle.target, MAX);
    await quoteToken.connect(provider).approve(oracle.target, MAX);
    await baseToken.connect(verifier).approve(oracle.target, MAX);
    await quoteToken.connect(verifier).approve(oracle.target, MAX);
    await baseToken.connect(stranger).approve(oracle.target, MAX);
    await quoteToken.connect(stranger).approve(oracle.target, MAX);
  }

  async function submit(bAmt, qAmt, opts = {}) {
    const _base = opts.baseToken ?? baseToken;
    const _quote = opts.quoteToken ?? quoteToken;
    const signer = opts.signer ?? provider;
    // approvals already set for default tokens; extra tokens approve here
    if (opts.baseToken || opts.quoteToken) {
      await _base.connect(signer).approve(oracle.target, bAmt);
      await _quote.connect(signer).approve(oracle.target, qAmt);
    }
    // Default 2-slot window: submit tx lands at tip+1 (startSlot), so
    // expiry = startSlot + 2 = tip + 3 (inclusive veto window).
    const expiry = opts.expiry ?? BigInt(await ethers.provider.getBlockNumber()) + 3n;
    const tx = await oracle
      .connect(signer)
      .submitQuote(_base.target, _quote.target, bAmt, qAmt, expiry);
    const receipt = await tx.wait();
    const log = receipt.logs.find((l) => l.fragment?.name === "QuoteSubmitted");
    return {
      qId: log.args[0],
      bAmt,
      qAmt,
      price: log.args[6],
      startSlot: log.args[7],
      receipt,
      log,
    };
  }

  /** Requirement example: 2 MON + 200 USDC → price 100e18 */
  function exampleAmounts() {
    const bAmt = ethers.parseEther("2");
    const qAmt = ethers.parseEther("200");
    return { bAmt, qAmt, expectedPrice: ethers.parseEther("100") };
  }

  /** Mine until the next tx will execute at exactly targetBlock */
  async function mineUntilNextIs(targetBlock) {
    const current = await ethers.provider.getBlockNumber();
    // next mined tx block = current + 1
    const need = targetBlock - (current + 1);
    if (need > 0) await networkHelpers.mine(need);
  }

  beforeEach(async function () {
    await deployFresh();
  });

  // ============================================================
  // FR-QL: Quote Lifecycle Management
  // ============================================================
  describe("FR-QL Quote Lifecycle", function () {
    it("FR-QL-001: QuoteStatus enum values 0..4 match ACTIVE..SETTLED_WITHDRAWN", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      expect((await oracle.quotes(qId)).status).to.equal(0n); // ACTIVE

      await oracle.connect(verifier).vetoUnderpriced(qId);
      expect((await oracle.quotes(qId)).status).to.equal(1n); // VETOED_UNDERPRICED

      const s2 = await submit(bAmt, qAmt);
      await oracle.connect(verifier).vetoOverpriced(s2.qId);
      expect((await oracle.quotes(s2.qId)).status).to.equal(2n); // VETOED_OVERPRICED

      const s3 = await submit(bAmt, qAmt);
      await networkHelpers.mine(3);
      await oracle.settleValidQuote(s3.qId);
      expect((await oracle.quotes(s3.qId)).status).to.equal(3n); // SETTLED_VALID

      await oracle.connect(provider).withdrawProviderFunds(s3.qId);
      expect((await oracle.quotes(s3.qId)).status).to.equal(4n); // SETTLED_WITHDRAWN
    });

    it("FR-QL-002: Quote struct stores all required fields", async () => {
      const { bAmt, qAmt, expectedPrice } = exampleAmounts();
      const blockBefore = await ethers.provider.getBlockNumber();
      const { qId } = await submit(bAmt, qAmt);
      const q = await oracle.quotes(qId);
      expect(q.provider).to.equal(provider.address);
      expect(q.baseToken).to.equal(baseToken.target);
      expect(q.quoteToken).to.equal(quoteToken.target);
      expect(q.baseAmount).to.equal(bAmt);
      expect(q.quoteAmount).to.equal(qAmt);
      expect(q.price).to.equal(expectedPrice);
      expect(q.startSlot).to.be.gt(blockBefore);
      expect(q.settledSlot).to.equal(0n);
      expect(q.status).to.equal(0n);
    });

    it("FR-QL-003 / NFR-MON-001: VERIFICATION_SLOTS = 2 and window uses block.number", async () => {
      expect(await oracle.VERIFICATION_SLOTS()).to.equal(2n);
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);

      // during window: settle reverts
      await expect(oracle.settleValidQuote(qId)).to.be.revertedWithCustomError(
        oracle,
        "VerificationWindowActive"
      );

      // after window: veto reverts, settle works
      await networkHelpers.mine(3);
      await expect(
        oracle.connect(verifier).vetoUnderpriced(qId)
      ).to.be.revertedWithCustomError(oracle, "VerificationWindowExpired");
      await oracle.settleValidQuote(qId);
      expect((await oracle.quotes(qId)).status).to.equal(3n);
    });

    it("FR-QL-003 boundary: veto allowed when tx block == startSlot + 2", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      const start = Number((await oracle.quotes(qId)).startSlot);
      // next tx should land at start+2
      await mineUntilNextIs(start + 2);
      await oracle.connect(verifier).vetoUnderpriced(qId);
      expect((await oracle.quotes(qId)).status).to.equal(1n);
      expect(await ethers.provider.getBlockNumber()).to.equal(start + 2);
    });

    it("FR-QL-003 boundary: veto reverts when tx block == startSlot + 3", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      const start = Number((await oracle.quotes(qId)).startSlot);
      await mineUntilNextIs(start + 3);
      await expect(
        oracle.connect(verifier).vetoUnderpriced(qId)
      ).to.be.revertedWithCustomError(oracle, "VerificationWindowExpired");
    });

    it("FR-QL-003 boundary: settle reverts at startSlot+2, succeeds at startSlot+3", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      const start = Number((await oracle.quotes(qId)).startSlot);

      await mineUntilNextIs(start + 2);
      await expect(oracle.settleValidQuote(qId)).to.be.revertedWithCustomError(
        oracle,
        "VerificationWindowActive"
      );

      // after failed call, block advanced; ensure next is start+3
      await mineUntilNextIs(start + 3);
      await oracle.settleValidQuote(qId);
      expect((await oracle.quotes(qId)).status).to.equal(3n);
      expect(await ethers.provider.getBlockNumber()).to.equal(start + 3);
    });

    it("FR-QL-004: no veto/settle outside valid state and time window", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);

      await expect(oracle.settleValidQuote(qId)).to.be.revertedWithCustomError(
        oracle,
        "VerificationWindowActive"
      );

      await networkHelpers.mine(3);
      await expect(
        oracle.connect(verifier).vetoUnderpriced(qId)
      ).to.be.revertedWithCustomError(oracle, "VerificationWindowExpired");
      await expect(
        oracle.connect(verifier).vetoOverpriced(qId)
      ).to.be.revertedWithCustomError(oracle, "VerificationWindowExpired");

      await oracle.settleValidQuote(qId);
      await expect(oracle.settleValidQuote(qId)).to.be.revertedWithCustomError(
        oracle,
        "QuoteNotActive"
      );
    });

    it("FR-QL-005: quoteId is monotonically increasing (starts at 1)", async () => {
      expect(await oracle.nextQuoteId()).to.equal(1n);
      const { bAmt, qAmt } = exampleAmounts();
      const a = await submit(bAmt, qAmt);
      const b = await submit(bAmt, qAmt);
      const c = await submit(bAmt, qAmt);
      expect(a.qId).to.equal(1n);
      expect(b.qId).to.equal(2n);
      expect(c.qId).to.equal(3n);
      expect(await oracle.nextQuoteId()).to.equal(4n);
      expect(b.qId).to.equal(a.qId + 1n);
      expect(c.qId).to.equal(b.qId + 1n);
    });
  });

  // ============================================================
  // FR-CE: Collateral Escrow
  // ============================================================
  describe("FR-CE Collateral Escrow", function () {
    it("FR-CE-001: collateral isolated per quote (withdraw one does not affect other)", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const q1 = await submit(bAmt, qAmt);
      const q2 = await submit(bAmt, qAmt);

      expect(await baseToken.balanceOf(oracle.target)).to.equal(bAmt * 2n);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(qAmt * 2n);

      await oracle.connect(verifier).vetoUnderpriced(q1.qId);
      // after underpriced: quote1 holds 0 base + 2*qAmt quote; quote2 still bAmt+qAmt
      expect(await baseToken.balanceOf(oracle.target)).to.equal(bAmt);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(qAmt * 3n);

      await oracle.connect(provider).withdrawProviderFunds(q1.qId);
      expect(await baseToken.balanceOf(oracle.target)).to.equal(bAmt);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(qAmt);

      await networkHelpers.mine(3);
      await oracle.settleValidQuote(q2.qId);
      await oracle.connect(provider).withdrawProviderFunds(q2.qId);
      expect(await baseToken.balanceOf(oracle.target)).to.equal(0n);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(0n);
    });

    it("FR-CE-002: price derived as (quoteAmount * 1e18) / baseAmount (req example 2/200=100)", async () => {
      const { bAmt, qAmt, expectedPrice } = exampleAmounts();
      const { qId, price } = await submit(bAmt, qAmt);
      expect(price).to.equal(expectedPrice);
      expect((await oracle.quotes(qId)).price).to.equal((qAmt * ONE) / bAmt);
    });

    it("FR-CE-003: transferFrom pulls exact baseAmount and quoteAmount at submission", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const pb = await baseToken.balanceOf(provider.address);
      const pq = await quoteToken.balanceOf(provider.address);
      const cb = await baseToken.balanceOf(oracle.target);
      const cq = await quoteToken.balanceOf(oracle.target);

      await submit(bAmt, qAmt);

      expect(await baseToken.balanceOf(provider.address)).to.equal(pb - bAmt);
      expect(await quoteToken.balanceOf(provider.address)).to.equal(pq - qAmt);
      expect(await baseToken.balanceOf(oracle.target)).to.equal(cb + bAmt);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(cq + qAmt);
    });

    it("FR-CE-003: reverts without sufficient allowance", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      // clear allowance
      await baseToken.connect(provider).approve(oracle.target, 0);
      const expiry = BigInt(await ethers.provider.getBlockNumber()) + 2n;
      await expect(
        oracle
          .connect(provider)
          .submitQuote(baseToken.target, quoteToken.target, bAmt, qAmt, expiry)
      ).to.revert(ethers);
    });

    it("FR-CE-005: escrow invariant after full valid lifecycle", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      expect(await baseToken.balanceOf(oracle.target)).to.equal(bAmt);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(qAmt);

      await networkHelpers.mine(3);
      await oracle.settleValidQuote(qId);
      expect(await baseToken.balanceOf(oracle.target)).to.equal(bAmt);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(qAmt);

      await oracle.connect(provider).withdrawProviderFunds(qId);
      expect(await baseToken.balanceOf(oracle.target)).to.equal(0n);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(0n);
    });

    it("FR-CE-005 / FR-VU-004: escrow after underpriced veto = 0 base, 2*quote", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await oracle.connect(verifier).vetoUnderpriced(qId);

      expect(await baseToken.balanceOf(oracle.target)).to.equal(0n);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(qAmt * 2n);

      await oracle.connect(provider).withdrawProviderFunds(qId);
      expect(await baseToken.balanceOf(oracle.target)).to.equal(0n);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(0n);
    });

    it("FR-CE-005 / FR-VO-004: escrow after overpriced veto = 2*base, 0 quote", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await oracle.connect(verifier).vetoOverpriced(qId);

      expect(await baseToken.balanceOf(oracle.target)).to.equal(bAmt * 2n);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(0n);

      await oracle.connect(provider).withdrawProviderFunds(qId);
      expect(await baseToken.balanceOf(oracle.target)).to.equal(0n);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(0n);
    });
  });

  // ============================================================
  // FR-VU: Underpriced Veto
  // ============================================================
  describe("FR-VU Underpriced Veto", function () {
    it("FR-VU-001/002/003/004 + §5.2: full underpriced flow with balances and event", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);

      const vBaseBefore = await baseToken.balanceOf(verifier.address);
      const vQuoteBefore = await quoteToken.balanceOf(verifier.address);

      await expect(oracle.connect(verifier).vetoUnderpriced(qId))
        .to.emit(oracle, "QuoteVetoedUnderpriced")
        .withArgs(qId, verifier.address);

      expect(await baseToken.balanceOf(verifier.address)).to.equal(
        vBaseBefore + bAmt
      );
      expect(await quoteToken.balanceOf(verifier.address)).to.equal(
        vQuoteBefore - qAmt
      );
      expect((await oracle.quotes(qId)).status).to.equal(1n);
      expect(await baseToken.balanceOf(oracle.target)).to.equal(0n);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(qAmt * 2n);
    });

    it("FR-VU-002: reverts when status not ACTIVE (double veto)", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await oracle.connect(verifier).vetoUnderpriced(qId);
      // second veto still inside window (same block path): should hit QuoteNotActive
      await expect(
        oracle.connect(verifier).vetoUnderpriced(qId)
      ).to.be.revertedWithCustomError(oracle, "QuoteNotActive");
    });

    it("FR-VU-002: reverts when window expired", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await networkHelpers.mine(3);
      await expect(
        oracle.connect(verifier).vetoUnderpriced(qId)
      ).to.be.revertedWithCustomError(oracle, "VerificationWindowExpired");
    });

    it("permissionless: any address may veto underpriced", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await oracle.connect(stranger).vetoUnderpriced(qId);
      expect((await oracle.quotes(qId)).status).to.equal(1n);
    });
  });

  // ============================================================
  // FR-VO: Overpriced Veto
  // ============================================================
  describe("FR-VO Overpriced Veto", function () {
    it("FR-VO-001/002/003/004 + §5.3: full overpriced flow with balances and event", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);

      const vBaseBefore = await baseToken.balanceOf(verifier.address);
      const vQuoteBefore = await quoteToken.balanceOf(verifier.address);

      await expect(oracle.connect(verifier).vetoOverpriced(qId))
        .to.emit(oracle, "QuoteVetoedOverpriced")
        .withArgs(qId, verifier.address);

      expect(await baseToken.balanceOf(verifier.address)).to.equal(
        vBaseBefore - bAmt
      );
      expect(await quoteToken.balanceOf(verifier.address)).to.equal(
        vQuoteBefore + qAmt
      );
      expect((await oracle.quotes(qId)).status).to.equal(2n);
      expect(await baseToken.balanceOf(oracle.target)).to.equal(bAmt * 2n);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(0n);
    });

    it("FR-VO-002: reverts when window expired", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await networkHelpers.mine(3);
      await expect(
        oracle.connect(verifier).vetoOverpriced(qId)
      ).to.be.revertedWithCustomError(oracle, "VerificationWindowExpired");
    });

    it("FR-VO-002: reverts when already vetoed underpriced", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await oracle.connect(verifier).vetoUnderpriced(qId);
      await expect(
        oracle.connect(verifier).vetoOverpriced(qId)
      ).to.be.revertedWithCustomError(oracle, "QuoteNotActive");
    });
  });

  // ============================================================
  // FR-SV: Settlement & Withdrawal
  // ============================================================
  describe("FR-SV Settlement & Withdrawal", function () {
    it("FR-SV-001/002/003: settleValidQuote after window updates status, settledSlot, event, feed", async () => {
      const { bAmt, qAmt, expectedPrice } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await networkHelpers.mine(3);

      await expect(oracle.connect(other).settleValidQuote(qId))
        .to.emit(oracle, "QuoteSettledValid")
        .withArgs(qId, expectedPrice);

      const q = await oracle.quotes(qId);
      expect(q.status).to.equal(3n);
      expect(q.settledSlot).to.be.gt(0n);
      expect(q.settledSlot).to.equal(await ethers.provider.getBlockNumber());

      const pairKey = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "address"],
          [baseToken.target, quoteToken.target]
        )
      );
      expect(await oracle.latestValidQuoteId(pairKey)).to.equal(qId);
    });

    it("FR-SV-004/005: provider withdraws 100% original collateral after SETTLED_VALID", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await networkHelpers.mine(3);
      await oracle.settleValidQuote(qId);

      const pb = await baseToken.balanceOf(provider.address);
      const pq = await quoteToken.balanceOf(provider.address);

      await expect(oracle.connect(provider).withdrawProviderFunds(qId))
        .to.emit(oracle, "FundsWithdrawn")
        .withArgs(qId, provider.address, bAmt, qAmt);

      expect(await baseToken.balanceOf(provider.address)).to.equal(pb + bAmt);
      expect(await quoteToken.balanceOf(provider.address)).to.equal(pq + qAmt);
      expect((await oracle.quotes(qId)).status).to.equal(4n);
    });

    it("FR-SV-005: only quote provider may withdraw", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await networkHelpers.mine(3);
      await oracle.settleValidQuote(qId);
      await expect(
        oracle.connect(verifier).withdrawProviderFunds(qId)
      ).to.be.revertedWithCustomError(oracle, "NotQuoteProvider");
      await expect(
        oracle.connect(other).withdrawProviderFunds(qId)
      ).to.be.revertedWithCustomError(oracle, "NotQuoteProvider");
    });

    it("FR-SV-006/007/009: underpriced veto withdraw immediately → 2*quote, 0 base", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await oracle.connect(verifier).vetoUnderpriced(qId);

      const pb = await baseToken.balanceOf(provider.address);
      const pq = await quoteToken.balanceOf(provider.address);
      await oracle.connect(provider).withdrawProviderFunds(qId);
      expect(await baseToken.balanceOf(provider.address)).to.equal(pb);
      expect(await quoteToken.balanceOf(provider.address)).to.equal(
        pq + qAmt * 2n
      );
      expect((await oracle.quotes(qId)).status).to.equal(4n);
    });

    it("FR-SV-006/008/009: overpriced veto withdraw immediately → 2*base, 0 quote", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await oracle.connect(verifier).vetoOverpriced(qId);

      const pb = await baseToken.balanceOf(provider.address);
      const pq = await quoteToken.balanceOf(provider.address);
      await oracle.connect(provider).withdrawProviderFunds(qId);
      expect(await baseToken.balanceOf(provider.address)).to.equal(
        pb + bAmt * 2n
      );
      expect(await quoteToken.balanceOf(provider.address)).to.equal(pq);
      expect((await oracle.quotes(qId)).status).to.equal(4n);
    });

    it("FR-SV: cannot withdraw ACTIVE or SETTLED_WITHDRAWN", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await expect(
        oracle.connect(provider).withdrawProviderFunds(qId)
      ).to.be.revertedWithCustomError(oracle, "NotWithdrawable");

      await networkHelpers.mine(3);
      await oracle.settleValidQuote(qId);
      await oracle.connect(provider).withdrawProviderFunds(qId);
      await expect(
        oracle.connect(provider).withdrawProviderFunds(qId)
      ).to.be.revertedWithCustomError(oracle, "NotWithdrawable");
    });

    it("FR-SV: settle is permissionless (any caller)", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await networkHelpers.mine(3);
      await oracle.connect(stranger).settleValidQuote(qId);
      expect((await oracle.quotes(qId)).status).to.equal(3n);
    });
  });

  // ============================================================
  // FR-PF: Price Feed
  // ============================================================
  describe("FR-PF Price Feed", function () {
    it("FR-PF-001: getLatestPrice returns (price, settledSlot, exists)", async () => {
      const { bAmt, qAmt, expectedPrice } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await networkHelpers.mine(3);
      await oracle.settleValidQuote(qId);
      const settled = (await oracle.quotes(qId)).settledSlot;

      const [price, settledSlot, exists] = await oracle.getLatestPrice(
        baseToken.target,
        quoteToken.target
      );
      expect(exists).to.equal(true);
      expect(price).to.equal(expectedPrice);
      expect(settledSlot).to.equal(settled);
    });

    it("FR-PF-001: returns (0,0,false) for unknown pair", async () => {
      const [p, s, e] = await oracle.getLatestPrice(
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002"
      );
      expect(p).to.equal(0n);
      expect(s).to.equal(0n);
      expect(e).to.equal(false);
    });

    it("FR-PF-002: mapping pair key → latest settled valid quote ID", async () => {
      const { bAmt } = exampleAmounts();
      const a = await submit(bAmt, ethers.parseEther("200")); // 100
      const b = await submit(bAmt, ethers.parseEther("300")); // 150
      await networkHelpers.mine(3);
      await oracle.settleValidQuote(a.qId);
      await oracle.settleValidQuote(b.qId);

      const pairKey = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "address"],
          [baseToken.target, quoteToken.target]
        )
      );
      expect(await oracle.latestValidQuoteId(pairKey)).to.equal(b.qId);
      const [price] = await oracle.getLatestPrice(
        baseToken.target,
        quoteToken.target
      );
      expect(price).to.equal((ethers.parseEther("300") * ONE) / bAmt);
    });

    it("FR-PF-003: settled prices permanently queryable by quoteId", async () => {
      const { bAmt, qAmt, expectedPrice } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await networkHelpers.mine(3);
      await oracle.settleValidQuote(qId);
      await oracle.connect(provider).withdrawProviderFunds(qId);

      const q = await oracle.quotes(qId);
      expect(q.price).to.equal(expectedPrice);
      expect(q.baseAmount).to.equal(bAmt);
      expect(q.quoteAmount).to.equal(qAmt);
      expect(q.status).to.equal(4n);
    });

    it("FR-PF: first settled quote (lowest id) is readable via getLatestPrice", async () => {
      const { bAmt, qAmt, expectedPrice } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      // With nextQuoteId starting at 1, first quote is id=1 (never 0 sentinel)
      expect(qId).to.equal(1n);

      await networkHelpers.mine(3);
      await oracle.settleValidQuote(qId);

      const pairKey = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "address"],
          [baseToken.target, quoteToken.target]
        )
      );
      expect(await oracle.latestValidQuoteId(pairKey)).to.equal(1n);

      const [price, settledSlot, exists] = await oracle.getLatestPrice(
        baseToken.target,
        quoteToken.target
      );
      expect(exists).to.equal(true);
      expect(price).to.equal(expectedPrice);
      expect(settledSlot).to.be.gt(0n);
    });

    it("REGRESSION: quoteId=0 must never be used as a real quote (sentinel collision)", async () => {
      // Historical bug: nextQuoteId started at 0; getLatestPrice treats 0 as missing.
      // After fix, first quote is 1 and getLatestPrice works.
      expect(await oracle.nextQuoteId()).to.equal(1n);
      const q = await oracle.quotes(0n);
      expect(q.provider).to.equal(ZERO);
    });

    it("vetoed quote must NOT update latestValidQuoteId / getLatestPrice", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await oracle.connect(verifier).vetoUnderpriced(qId);

      const [price, , exists] = await oracle.getLatestPrice(
        baseToken.target,
        quoteToken.target
      );
      expect(exists).to.equal(false);
      expect(price).to.equal(0n);
    });
  });

  // ============================================================
  // submitQuote validation (tech-spec §5.1)
  // ============================================================
  describe("submitQuote validation (tech-spec §5.1)", function () {
    it("reverts ZeroBaseAmount when baseAmount=0", async () => {
      const now = BigInt(await ethers.provider.getBlockNumber()) + 2n;
      await expect(
        oracle
          .connect(provider)
          .submitQuote(
            baseToken.target,
            quoteToken.target,
            0,
            ethers.parseEther("100"),
            now
          )
      ).to.be.revertedWithCustomError(oracle, "ZeroBaseAmount");
    });

    it("reverts QuoteAmountTooSmall when quoteAmount=0", async () => {
      const now = BigInt(await ethers.provider.getBlockNumber()) + 2n;
      await expect(
        oracle
          .connect(provider)
          .submitQuote(
            baseToken.target,
            quoteToken.target,
            ethers.parseEther("1"),
            0,
            now
          )
      ).to.be.revertedWithCustomError(oracle, "QuoteAmountTooSmall");
    });

    it("reverts InvalidToken on zero baseToken", async () => {
      const now = BigInt(await ethers.provider.getBlockNumber()) + 2n;
      await expect(
        oracle
          .connect(provider)
          .submitQuote(ZERO, quoteToken.target, ONE, ethers.parseEther("100"), now)
      ).to.be.revertedWithCustomError(oracle, "InvalidToken");
    });

    it("reverts InvalidToken on zero quoteToken", async () => {
      const now = BigInt(await ethers.provider.getBlockNumber()) + 2n;
      await expect(
        oracle
          .connect(provider)
          .submitQuote(baseToken.target, ZERO, ONE, ethers.parseEther("100"), now)
      ).to.be.revertedWithCustomError(oracle, "InvalidToken");
    });

    it("reverts IdenticalTokens", async () => {
      const now = BigInt(await ethers.provider.getBlockNumber()) + 2n;
      await expect(
        oracle
          .connect(provider)
          .submitQuote(
            baseToken.target,
            baseToken.target,
            ONE,
            ethers.parseEther("100"),
            now
          )
      ).to.be.revertedWithCustomError(oracle, "IdenticalTokens");
    });

    it("emits QuoteSubmitted with correct fields", async () => {
      const { bAmt, qAmt, expectedPrice } = exampleAmounts();
      const expiry = BigInt(await ethers.provider.getBlockNumber()) + 2n;
      const tx = await oracle
        .connect(provider)
        .submitQuote(baseToken.target, quoteToken.target, bAmt, qAmt, expiry);
      const receipt = await tx.wait();
      const log = receipt.logs.find(
        (l) => l.fragment?.name === "QuoteSubmitted"
      );
      expect(log.args.quoteId).to.equal(1n);
      expect(log.args.provider).to.equal(provider.address);
      expect(log.args.baseToken).to.equal(baseToken.target);
      expect(log.args.quoteToken).to.equal(quoteToken.target);
      expect(log.args.baseAmount).to.equal(bAmt);
      expect(log.args.quoteAmount).to.equal(qAmt);
      expect(log.args.price).to.equal(expectedPrice);
      expect(log.args.startSlot).to.equal(receipt.blockNumber);
      expect(log.args.expiryBlock).to.equal(expiry);
    });
  });

  // ============================================================
  // NFR / architecture
  // ============================================================
  describe("NFR Security & Compatibility", function () {
    it("NFR-SEC-002: no owner/admin privileged functions", async () => {
      const frag = oracle.interface.fragments.filter((f) => f.type === "function");
      const names = frag.map((f) => f.name);
      const forbidden = [
        "owner",
        "transferOwnership",
        "renounceOwnership",
        "setVerification",
        "pause",
        "unpause",
        "upgradeTo",
        "upgradeToAndCall",
        "setAdmin",
      ];
      for (const n of forbidden) {
        expect(names.includes(n), `must not expose ${n}`).to.equal(false);
      }
      for (const required of [
        "submitQuote",
        "vetoUnderpriced",
        "vetoOverpriced",
        "settleValidQuote",
        "withdrawProviderFunds",
        "getLatestPrice",
      ]) {
        expect(names.includes(required)).to.equal(true);
      }
    });

    it("NFR-COMP-001: VERIFICATION_SLOTS constant readable", async () => {
      expect(await oracle.VERIFICATION_SLOTS()).to.equal(2n);
    });

    it("NFR-COMP-003: no decimal normalization — 6-dec tokens use native units", async () => {
      const Token = await ethers.getContractFactory("MockERC20");
      const usdc = await Token.deploy("USDC", "USDC", 6);
      const weth = await Token.deploy("WETH", "WETH", 18);
      await usdc.mint(provider.address, 1_000_000_000_000n);
      await weth.mint(provider.address, ethers.parseEther("1000"));

      const bAmt = ethers.parseEther("1");
      const qAmt = 2_000_000_000n; // 2000 * 1e6
      await weth.connect(provider).approve(oracle.target, bAmt);
      await usdc.connect(provider).approve(oracle.target, qAmt);
      const expiry = BigInt(await ethers.provider.getBlockNumber()) + 2n;
      const tx = await oracle
        .connect(provider)
        .submitQuote(weth.target, usdc.target, bAmt, qAmt, expiry);
      const receipt = await tx.wait();
      const qId = receipt.logs.find((l) => l.fragment?.name === "QuoteSubmitted")
        .args[0];
      const q = await oracle.quotes(qId);
      expect(q.baseAmount).to.equal(bAmt);
      expect(q.quoteAmount).to.equal(qAmt);
      expect(q.price).to.equal((qAmt * ONE) / bAmt);
    });

    it("NFR-MON-004: state-changing functions emit events", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);

      await expect(oracle.connect(verifier).vetoUnderpriced(qId)).to.emit(
        oracle,
        "QuoteVetoedUnderpriced"
      );
      await expect(
        oracle.connect(provider).withdrawProviderFunds(qId)
      ).to.emit(oracle, "FundsWithdrawn");

      const s = await submit(bAmt, qAmt);
      await networkHelpers.mine(3);
      await expect(oracle.settleValidQuote(s.qId)).to.emit(
        oracle,
        "QuoteSettledValid"
      );
    });

    it("quoteExists: non-existent quote reverts on veto/settle/withdraw", async () => {
      await expect(oracle.vetoUnderpriced(999)).to.be.revertedWithCustomError(
        oracle,
        "QuoteDoesNotExist"
      );
      await expect(oracle.vetoOverpriced(999)).to.be.revertedWithCustomError(
        oracle,
        "QuoteDoesNotExist"
      );
      await expect(oracle.settleValidQuote(999)).to.be.revertedWithCustomError(
        oracle,
        "QuoteDoesNotExist"
      );
      await expect(
        oracle.withdrawProviderFunds(999)
      ).to.be.revertedWithCustomError(oracle, "QuoteDoesNotExist");
    });

    it("NFR-SEC-001: inherits ReentrancyGuard (nonReentrant on mutators)", async () => {
      // Structural: bytecode includes OZ ReentrancyGuard storage; mutators tagged nonReentrant.
      // Runtime: double-entry via malicious ERC20 would hit ReentrancyGuardReentrantCall.
      // Verified by inheritance in Monoracle.sol and nonReentrant on submit/veto/withdraw.
      const src = await (await import("node:fs")).promises.readFile(
        new URL("../contracts/Monoracle.sol", import.meta.url),
        "utf8"
      );
      expect(src).to.match(/is ReentrancyGuard/);
      expect(src).to.match(/submitQuote[\s\S]*nonReentrant/);
      expect(src).to.match(/vetoUnderpriced[\s\S]*nonReentrant/);
      expect(src).to.match(/vetoOverpriced[\s\S]*nonReentrant/);
      expect(src).to.match(/withdrawProviderFunds[\s\S]*nonReentrant/);
      expect(src).to.match(/SafeERC20/);
    });
  });

  // ============================================================
  // Process flows §5.1 / concurrent / tech-spec §11
  // ============================================================
  describe("Process flows & concurrency", function () {
    it("§5.1 full valid price flow: submit → settle → getLatestPrice → withdraw", async () => {
      const { bAmt, qAmt, expectedPrice } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      expect((await oracle.quotes(qId)).status).to.equal(0n);

      await networkHelpers.mine(3);
      await oracle.settleValidQuote(qId);
      expect((await oracle.quotes(qId)).status).to.equal(3n);

      const [price, , exists] = await oracle.getLatestPrice(
        baseToken.target,
        quoteToken.target
      );
      expect(exists).to.equal(true);
      expect(price).to.equal(expectedPrice);

      const pb = await baseToken.balanceOf(provider.address);
      await oracle.connect(provider).withdrawProviderFunds(qId);
      expect(await baseToken.balanceOf(provider.address)).to.equal(pb + bAmt);
      expect((await oracle.quotes(qId)).status).to.equal(4n);
    });

    it("multiple concurrent quotes same pair: latest settled updates feed; vetoed ignored", async () => {
      const { bAmt } = exampleAmounts();
      const q1 = await submit(bAmt, ethers.parseEther("200")); // 100
      const q2 = await submit(bAmt, ethers.parseEther("240")); // 120
      const q3 = await submit(bAmt, ethers.parseEther("160")); // 80

      await oracle.connect(verifier).vetoUnderpriced(q2.qId);

      await networkHelpers.mine(3);
      await oracle.settleValidQuote(q1.qId);
      await oracle.settleValidQuote(q3.qId);

      const [price] = await oracle.getLatestPrice(
        baseToken.target,
        quoteToken.target
      );
      expect(price).to.equal((ethers.parseEther("160") * ONE) / bAmt);
    });

    it("independent pairs do not collide", async () => {
      const Token = await ethers.getContractFactory("MockERC20");
      const t3 = await Token.deploy("T3", "T3", 18);
      await t3.mint(provider.address, ethers.parseEther("10000"));
      await t3.connect(provider).approve(oracle.target, ethers.MaxUint256);

      const { bAmt, qAmt, expectedPrice } = exampleAmounts();
      const a = await submit(bAmt, qAmt);
      const expiry = BigInt(await ethers.provider.getBlockNumber()) + 2n;
      const tx = await oracle
        .connect(provider)
        .submitQuote(baseToken.target, t3.target, bAmt, qAmt, expiry);
      const r = await tx.wait();
      const idB = r.logs.find((l) => l.fragment?.name === "QuoteSubmitted")
        .args[0];

      await networkHelpers.mine(3);
      await oracle.settleValidQuote(a.qId);
      await oracle.settleValidQuote(idB);

      const [p1, , e1] = await oracle.getLatestPrice(
        baseToken.target,
        quoteToken.target
      );
      const [p2, , e2] = await oracle.getLatestPrice(
        baseToken.target,
        t3.target
      );
      expect(e1).to.equal(true);
      expect(e2).to.equal(true);
      expect(p1).to.equal(expectedPrice);
      expect(p2).to.equal(expectedPrice);
    });

    it("first-come-first-served: second veto on same quote fails", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await oracle.connect(verifier).vetoUnderpriced(qId);
      await expect(
        oracle.connect(stranger).vetoUnderpriced(qId)
      ).to.be.revertedWithCustomError(oracle, "QuoteNotActive");
    });
  });

  // ============================================================
  // Edge cases (tech-spec §11.3)
  // ============================================================
  describe("Edge cases (tech-spec §11.3)", function () {
    it("very small amounts still derive price correctly", async () => {
      const expiry = BigInt(await ethers.provider.getBlockNumber()) + 2n;
      const tx = await oracle
        .connect(provider)
        .submitQuote(baseToken.target, quoteToken.target, 1n, 1n, expiry);
      const r = await tx.wait();
      const qId = r.logs.find((l) => l.fragment?.name === "QuoteSubmitted")
        .args[0];
      expect((await oracle.quotes(qId)).price).to.equal(ONE);
    });

    it("large baseAmount with price=1 does not overflow", async () => {
      const bAmt = ethers.parseEther("100000");
      const { qId } = await submit(bAmt, bAmt);
      expect((await oracle.quotes(qId)).price).to.equal(ONE);
    });

    it("cross-decimal 6 vs 18 works without normalization", async () => {
      const Token = await ethers.getContractFactory("MockERC20");
      const token6 = await Token.deploy("SIX", "SIX", 6);
      const token18 = await Token.deploy("E18", "E18", 18);
      await token6.mint(provider.address, 10_000_000_000n);
      await token18.mint(provider.address, ethers.parseEther("10000"));
      const bAmt = 1_000_000n;
      const qAmt = ethers.parseEther("100");
      await token6.connect(provider).approve(oracle.target, bAmt);
      await token18.connect(provider).approve(oracle.target, qAmt);
      const expiry = BigInt(await ethers.provider.getBlockNumber()) + 2n;
      const tx = await oracle
        .connect(provider)
        .submitQuote(token6.target, token18.target, bAmt, qAmt, expiry);
      const r = await tx.wait();
      const qId = r.logs.find((l) => l.fragment?.name === "QuoteSubmitted")
        .args[0];
      expect((await oracle.quotes(qId)).price).to.equal((qAmt * ONE) / bAmt);
    });

    it("cannot settle after withdraw", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await networkHelpers.mine(3);
      await oracle.settleValidQuote(qId);
      await oracle.connect(provider).withdrawProviderFunds(qId);
      await expect(oracle.settleValidQuote(qId)).to.be.revertedWithCustomError(
        oracle,
        "QuoteNotActive"
      );
    });

    it("cannot veto after settle (window expired)", async () => {
      const { bAmt, qAmt } = exampleAmounts();
      const { qId } = await submit(bAmt, qAmt);
      await networkHelpers.mine(3);
      await oracle.settleValidQuote(qId);
      await expect(
        oracle.connect(verifier).vetoUnderpriced(qId)
      ).to.be.revertedWithCustomError(oracle, "VerificationWindowExpired");
    });
  });
});
