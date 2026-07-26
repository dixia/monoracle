import { expect } from "chai";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();
const ONE_ETH = ethers.parseEther("1");

describe("Monoracle", function () {
  let accounts, baseToken, quoteToken, oracle;

  before(async function () {
    accounts = {};
    [accounts.provider, accounts.verifier, accounts.consumer, accounts.other] =
      await ethers.getSigners();

    const TokenA = await ethers.getContractFactory("MockERC20");
    baseToken = await TokenA.deploy("Base Token", "BASE", 18);
    quoteToken = await TokenA.deploy("Quote Token", "QUOTE", 18);

    await baseToken.mint(accounts.provider.address, ethers.parseEther("10000"));
    await quoteToken.mint(accounts.provider.address, ethers.parseEther("10000000"));
    await baseToken.mint(accounts.verifier.address, ethers.parseEther("10000"));
    await quoteToken.mint(accounts.verifier.address, ethers.parseEther("10000000"));

    const Monoracle = await ethers.getContractFactory("Monoracle");
    oracle = await Monoracle.deploy();
  });

  async function submitAndSettle(bAmt, price) {
    const qAmt = bAmt * price / ONE_ETH;
    await baseToken.connect(accounts.provider).approve(oracle.target, bAmt);
    await quoteToken.connect(accounts.provider).approve(oracle.target, qAmt);
    const tx = await oracle.connect(accounts.provider).submitQuote(
      baseToken.target, quoteToken.target, bAmt, price
    );
    const receipt = await tx.wait();
    const qId = receipt.logs.find(l => l.fragment?.name === "QuoteSubmitted").args[0];

    await networkHelpers.mine(3);
    await oracle.connect(accounts.other).settleValidQuote(qId);
    return { qId, bAmt, price, qAmt };
  }

  async function submit(bAmt, price, overrides = {}) {
    const qAmt = bAmt * price / ONE_ETH;
    const _base = overrides.baseToken ?? baseToken;
    const _quote = overrides.quoteToken ?? quoteToken;

    await _base.connect(accounts.provider).approve(oracle.target, bAmt);
    await _quote.connect(accounts.provider).approve(oracle.target, qAmt);
    const tx = await oracle.connect(accounts.provider).submitQuote(
      _base.target, _quote.target, bAmt, price
    );
    const receipt = await tx.wait();
    const qId = receipt.logs.find(l => l.fragment?.name === "QuoteSubmitted").args[0];
    return { qId, bAmt, price, qAmt };
  }

  async function mine(n) {
    await networkHelpers.mine(n);
  }

  // ============================================================
  // Deployment
  // ============================================================
  describe("Deployment", function () {
    it("nextQuoteId starts at 0", async () => {
      expect(await oracle.nextQuoteId()).to.equal(0n);
    });

    it("VERIFICATION_SLOTS = 2", async () => {
      expect(await oracle.VERIFICATION_SLOTS()).to.equal(2n);
    });
  });

  // ============================================================
  // submitQuote
  // ============================================================
  describe("submitQuote", function () {
    it("creates quote and emits QuoteSubmitted", async () => {
      const bAmt = ethers.parseEther("2");
      const price = ethers.parseEther("100");
      const qAmt = bAmt * price / ONE_ETH;

      await baseToken.connect(accounts.provider).approve(oracle.target, bAmt);
      await quoteToken.connect(accounts.provider).approve(oracle.target, qAmt);

      await expect(
        oracle.connect(accounts.provider).submitQuote(baseToken.target, quoteToken.target, bAmt, price)
      ).to.emit(oracle, "QuoteSubmitted");

      const q = await oracle.quotes(0n);
      expect(q.provider).to.equal(accounts.provider.address);
      expect(q.baseAmount).to.equal(bAmt);
      expect(q.quoteAmount).to.equal(qAmt);
      expect(q.price).to.equal(price);
      expect(q.status).to.equal(0n); // ACTIVE
    });

    it("increments nextQuoteId", async () => {
      const before = await oracle.nextQuoteId();
      await submit(ethers.parseEther("1"), ethers.parseEther("100"));
      expect(await oracle.nextQuoteId()).to.equal(before + 1n);
      await submit(ethers.parseEther("1"), ethers.parseEther("100"));
      expect(await oracle.nextQuoteId()).to.equal(before + 2n);
    });

    it("pulls tokens from provider", async () => {
      const bAmt = ethers.parseEther("5");
      const price = ethers.parseEther("10");
      const qAmt = bAmt * price / ONE_ETH;

      const bBefore = await baseToken.balanceOf(accounts.provider.address);
      const qBefore = await quoteToken.balanceOf(accounts.provider.address);

      await submit(bAmt, price);

      expect(await baseToken.balanceOf(accounts.provider.address)).to.equal(bBefore - bAmt);
      expect(await quoteToken.balanceOf(accounts.provider.address)).to.equal(qBefore - qAmt);
    });

    it("reverts on zero baseAmount", async () => {
      await expect(
        oracle.connect(accounts.provider).submitQuote(baseToken.target, quoteToken.target, 0, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(oracle, "ZeroBaseAmount");
    });

    it("reverts on zero price", async () => {
      await expect(
        oracle.connect(accounts.provider).submitQuote(baseToken.target, quoteToken.target, ethers.parseEther("1"), 0)
      ).to.be.revertedWithCustomError(oracle, "ZeroPrice");
    });

    it("reverts on address(0)", async () => {
      await expect(
        oracle.connect(accounts.provider).submitQuote(
          "0x0000000000000000000000000000000000000000", quoteToken.target, ethers.parseEther("1"), ethers.parseEther("100")
        )
      ).to.be.revertedWithCustomError(oracle, "InvalidToken");
    });

    it("reverts on identical tokens", async () => {
      await expect(
        oracle.connect(accounts.provider).submitQuote(baseToken.target, baseToken.target, ethers.parseEther("1"), ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(oracle, "IdenticalTokens");
    });

    it("reverts when quoteAmount rounds to 0", async () => {
      await baseToken.connect(accounts.provider).approve(oracle.target, 1000n);
      await quoteToken.connect(accounts.provider).approve(oracle.target, 1n);
      await expect(
        oracle.connect(accounts.provider).submitQuote(baseToken.target, quoteToken.target, 1000n, 1n)
      ).to.be.revertedWithCustomError(oracle, "QuoteAmountTooSmall");
    });

    it("reverts without allowance", async () => {
      await expect(
        oracle.connect(accounts.provider).submitQuote(baseToken.target, quoteToken.target, ethers.parseEther("1"), ethers.parseEther("100"))
      ).to.revert(ethers);
    });
  });

  // ============================================================
  // vetoUnderpriced
  // ============================================================
  describe("vetoUnderpriced", function () {
    it("executes underpriced veto", async () => {
      const { qId, bAmt, qAmt } = await submit(ethers.parseEther("2"), ethers.parseEther("100"));

      await quoteToken.connect(accounts.verifier).approve(oracle.target, qAmt);
      const vBaseBefore = await baseToken.balanceOf(accounts.verifier.address);
      const vQuoteBefore = await quoteToken.balanceOf(accounts.verifier.address);

      await expect(oracle.connect(accounts.verifier).vetoUnderpriced(qId))
        .to.emit(oracle, "QuoteVetoedUnderpriced");

      expect(await baseToken.balanceOf(accounts.verifier.address)).to.equal(vBaseBefore + bAmt);
      expect(await quoteToken.balanceOf(accounts.verifier.address)).to.equal(vQuoteBefore - qAmt);
      expect((await oracle.quotes(qId)).status).to.equal(1n); // VETOED_UNDERPRICED
    });

    it("reverts after verification window", async () => {
      const { qId, qAmt } = await submit(ethers.parseEther("2"), ethers.parseEther("100"));
      await quoteToken.connect(accounts.verifier).approve(oracle.target, qAmt);
      await mine(3);
      await expect(
        oracle.connect(accounts.verifier).vetoUnderpriced(qId)
      ).to.be.revertedWithCustomError(oracle, "VerificationWindowExpired");
    });

    it("reverts for non-existent quote", async () => {
      await expect(oracle.vetoUnderpriced(999)).to.be.revertedWithCustomError(oracle, "QuoteDoesNotExist");
    });

    it("reverts on settled quote", async () => {
      const { qId } = await submitAndSettle(ethers.parseEther("2"), ethers.parseEther("100"));
      await expect(
        oracle.connect(accounts.verifier).vetoUnderpriced(qId)
      ).to.be.revertedWithCustomError(oracle, "VerificationWindowExpired");
    });
  });

  // ============================================================
  // vetoOverpriced
  // ============================================================
  describe("vetoOverpriced", function () {
    it("executes overpriced veto", async () => {
      const { qId, bAmt, qAmt } = await submit(ethers.parseEther("2"), ethers.parseEther("100"));

      await baseToken.connect(accounts.verifier).approve(oracle.target, bAmt);
      const vBaseBefore = await baseToken.balanceOf(accounts.verifier.address);
      const vQuoteBefore = await quoteToken.balanceOf(accounts.verifier.address);

      await expect(oracle.connect(accounts.verifier).vetoOverpriced(qId))
        .to.emit(oracle, "QuoteVetoedOverpriced");

      expect(await baseToken.balanceOf(accounts.verifier.address)).to.equal(vBaseBefore - bAmt);
      expect(await quoteToken.balanceOf(accounts.verifier.address)).to.equal(vQuoteBefore + qAmt);
      expect((await oracle.quotes(qId)).status).to.equal(2n);
    });

    it("reverts after verification window", async () => {
      const { qId, bAmt } = await submit(ethers.parseEther("2"), ethers.parseEther("100"));
      await baseToken.connect(accounts.verifier).approve(oracle.target, bAmt);
      await mine(3);
      await expect(
        oracle.connect(accounts.verifier).vetoOverpriced(qId)
      ).to.be.revertedWithCustomError(oracle, "VerificationWindowExpired");
    });
  });

  // ============================================================
  // settleValidQuote
  // ============================================================
  describe("settleValidQuote", function () {
    it("settles after verification window", async () => {
      const { qId, price } = await submit(ethers.parseEther("2"), ethers.parseEther("100"));
      await mine(3);

      await expect(oracle.connect(accounts.other).settleValidQuote(qId))
        .to.emit(oracle, "QuoteSettledValid");

      const q = await oracle.quotes(qId);
      expect(q.status).to.equal(3n); // SETTLED_VALID
      expect(q.settledSlot).to.not.equal(0n);
    });

    it("updates latestValidQuoteId", async () => {
      const { qId } = await submit(ethers.parseEther("2"), ethers.parseEther("100"));
      await mine(3);
      await oracle.connect(accounts.other).settleValidQuote(qId);

      const pairKey = ethers.keccak256(
        ethers.solidityPacked(["address", "address"], [baseToken.target, quoteToken.target])
      );
      expect(await oracle.latestValidQuoteId(pairKey)).to.equal(qId);
    });

    it("reverts during verification window", async () => {
      const { qId } = await submit(ethers.parseEther("2"), ethers.parseEther("100"));
      await expect(
        oracle.settleValidQuote(qId)
      ).to.be.revertedWithCustomError(oracle, "VerificationWindowActive");
    });

    it("reverts on vetoed quote", async () => {
      const { qId, bAmt } = await submit(ethers.parseEther("2"), ethers.parseEther("100"));
      await baseToken.connect(accounts.verifier).approve(oracle.target, bAmt);
      await oracle.connect(accounts.verifier).vetoOverpriced(qId);
      await mine(3);
      await expect(
        oracle.settleValidQuote(qId)
      ).to.be.revertedWithCustomError(oracle, "QuoteNotActive");
    });
  });

  // ============================================================
  // withdrawProviderFunds
  // ============================================================
  describe("withdrawProviderFunds", function () {
    it("returns full collateral for valid quote", async () => {
      const { qId, bAmt, qAmt } = await submitAndSettle(ethers.parseEther("10"), ethers.parseEther("50"));

      const bBefore = await baseToken.balanceOf(accounts.provider.address);
      const qBefore = await quoteToken.balanceOf(accounts.provider.address);

      await expect(oracle.connect(accounts.provider).withdrawProviderFunds(qId))
        .to.emit(oracle, "FundsWithdrawn");

      expect(await baseToken.balanceOf(accounts.provider.address)).to.equal(bBefore + bAmt);
      expect(await quoteToken.balanceOf(accounts.provider.address)).to.equal(qBefore + qAmt);
      expect((await oracle.quotes(qId)).status).to.equal(4n);
    });

    it("returns 2x quote for underpriced veto", async () => {
      const { qId, qAmt } = await submit(ethers.parseEther("5"), ethers.parseEther("200"));
      await quoteToken.connect(accounts.verifier).approve(oracle.target, qAmt);
      await oracle.connect(accounts.verifier).vetoUnderpriced(qId);

      const qBefore = await quoteToken.balanceOf(accounts.provider.address);
      await oracle.connect(accounts.provider).withdrawProviderFunds(qId);
      expect(await quoteToken.balanceOf(accounts.provider.address)).to.equal(qBefore + qAmt * 2n);
    });

    it("returns 2x base for overpriced veto", async () => {
      const { qId, bAmt } = await submit(ethers.parseEther("5"), ethers.parseEther("30"));
      await baseToken.connect(accounts.verifier).approve(oracle.target, bAmt);
      await oracle.connect(accounts.verifier).vetoOverpriced(qId);

      const bBefore = await baseToken.balanceOf(accounts.provider.address);
      await oracle.connect(accounts.provider).withdrawProviderFunds(qId);
      expect(await baseToken.balanceOf(accounts.provider.address)).to.equal(bBefore + bAmt * 2n);
    });

    it("reverts for non-provider", async () => {
      const { qId } = await submitAndSettle(ethers.parseEther("1"), ethers.parseEther("100"));
      await expect(
        oracle.connect(accounts.verifier).withdrawProviderFunds(qId)
      ).to.be.revertedWithCustomError(oracle, "NotQuoteProvider");
    });

    it("reverts for ACTIVE quote", async () => {
      const { qId } = await submit(ethers.parseEther("1"), ethers.parseEther("100"));
      await expect(
        oracle.connect(accounts.provider).withdrawProviderFunds(qId)
      ).to.be.revertedWithCustomError(oracle, "NotWithdrawable");
    });

    it("reverts on double withdrawal", async () => {
      const { qId } = await submitAndSettle(ethers.parseEther("1"), ethers.parseEther("100"));
      await oracle.connect(accounts.provider).withdrawProviderFunds(qId);
      await expect(
        oracle.connect(accounts.provider).withdrawProviderFunds(qId)
      ).to.be.revertedWithCustomError(oracle, "NotWithdrawable");
    });
  });

  // ============================================================
  // getLatestPrice
  // ============================================================
  describe("getLatestPrice", function () {
    it("returns price after settlement", async () => {
      const { price } = await submitAndSettle(ethers.parseEther("1"), ethers.parseEther("500"));
      const [p, slot, exists] = await oracle.getLatestPrice(baseToken.target, quoteToken.target);
      expect(p).to.equal(price);
      expect(slot).to.not.equal(0n);
      expect(exists).to.equal(true);
    });

    it("returns exists=false for unknown pair", async () => {
      const [, , exists] = await oracle.getLatestPrice(
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002"
      );
      expect(exists).to.equal(false);
    });

    it("returns latest price after multiple settlements", async () => {
      const { price: p1 } = await submitAndSettle(ethers.parseEther("1"), ethers.parseEther("100"));
      const { price: p2 } = await submitAndSettle(ethers.parseEther("1"), ethers.parseEther("200"));
      const [price, , exists] = await oracle.getLatestPrice(baseToken.target, quoteToken.target);
      expect(price).to.equal(p2);
      expect(exists).to.equal(true);
    });
  });

  // ============================================================
  // Full Lifecycle
  // ============================================================
  describe("Full lifecycle", function () {
    it("submit -> settle -> withdraw", async () => {
      const { qId, bAmt, qAmt } = await submitAndSettle(ethers.parseEther("10"), ethers.parseEther("50"));
      const bBefore = await baseToken.balanceOf(accounts.provider.address);
      await oracle.connect(accounts.provider).withdrawProviderFunds(qId);
      expect(await baseToken.balanceOf(accounts.provider.address)).to.equal(bBefore + bAmt);
    });

    it("submit -> veto underpriced -> withdraw", async () => {
      const { qId, qAmt } = await submit(ethers.parseEther("5"), ethers.parseEther("200"));
      await quoteToken.connect(accounts.verifier).approve(oracle.target, qAmt);
      await oracle.connect(accounts.verifier).vetoUnderpriced(qId);

      const qBefore = await quoteToken.balanceOf(accounts.provider.address);
      await oracle.connect(accounts.provider).withdrawProviderFunds(qId);
      expect(await quoteToken.balanceOf(accounts.provider.address)).to.equal(qBefore + qAmt * 2n);
    });

    it("submit -> veto overpriced -> withdraw", async () => {
      const { qId, bAmt } = await submit(ethers.parseEther("5"), ethers.parseEther("30"));
      await baseToken.connect(accounts.verifier).approve(oracle.target, bAmt);
      await oracle.connect(accounts.verifier).vetoOverpriced(qId);

      const bBefore = await baseToken.balanceOf(accounts.provider.address);
      await oracle.connect(accounts.provider).withdrawProviderFunds(qId);
      expect(await baseToken.balanceOf(accounts.provider.address)).to.equal(bBefore + bAmt * 2n);
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================
  describe("Edge cases", function () {
    it("6-decimal tokens work correctly", async () => {
      const Token6 = await ethers.getContractFactory("MockERC20");
      const usdc = await Token6.deploy("USDC", "USDC", 6);
      const usdt = await Token6.deploy("USDT", "USDT", 6);
      await usdc.mint(accounts.provider.address, 1_000_000_000n);
      await usdt.mint(accounts.provider.address, 1_000_000_000n);

      const bAmt = 1_000_000n; // 1 USDC
      const price = ethers.parseEther("1");
      const qAmt = bAmt * price / ONE_ETH;

      expect(qAmt).to.equal(1_000_000n); // 1 USDT

      const { qId } = await submit(bAmt, price, { baseToken: usdc, quoteToken: usdt });
      const q = await oracle.quotes(qId);
      expect(q.baseAmount).to.equal(bAmt);
      expect(q.quoteAmount).to.equal(qAmt);
    });

    it("large amounts don't overflow", async () => {
      const bAmt = ethers.parseEther("1000");
      const price = ethers.parseEther("1");
      const { qId } = await submit(bAmt, price);
      const q = await oracle.quotes(qId);
      expect(q.quoteAmount).to.equal(bAmt * price / ONE_ETH);
    });

    it("double veto fails", async () => {
      const bAmt = ethers.parseEther("2");
      const price = ethers.parseEther("100");
      const qAmt = bAmt * price / ONE_ETH;
      await quoteToken.connect(accounts.verifier).approve(oracle.target, qAmt);
      const { qId } = await submit(bAmt, price);
      await oracle.connect(accounts.verifier).vetoUnderpriced(qId);
      await expect(
        oracle.connect(accounts.verifier).vetoUnderpriced(qId)
      ).to.be.revertedWithCustomError(oracle, "QuoteNotActive");
    });

    it("settling vetoed quote fails", async () => {
      const { qId, bAmt } = await submit(ethers.parseEther("2"), ethers.parseEther("100"));
      await baseToken.connect(accounts.verifier).approve(oracle.target, bAmt);
      await oracle.connect(accounts.verifier).vetoOverpriced(qId);
      await mine(3);
      await expect(
        oracle.settleValidQuote(qId)
      ).to.be.revertedWithCustomError(oracle, "QuoteNotActive");
    });

    it("independent direction pairs", async () => {
      // BASE/QUOTE
      const { qId: id1, price: p1 } = await submit(ethers.parseEther("1"), ethers.parseEther("100"));
      // QUOTE/BASE
      const { qId: id2, price: p2 } = await submit(
        ethers.parseEther("1"), ethers.parseEther("100"),
        { baseToken: quoteToken, quoteToken: baseToken }
      );
      await mine(3);
      await oracle.settleValidQuote(id1);
      await oracle.settleValidQuote(id2);

      const [r1, , e1] = await oracle.getLatestPrice(baseToken.target, quoteToken.target);
      const [r2, , e2] = await oracle.getLatestPrice(quoteToken.target, baseToken.target);
      expect(e1).to.equal(true);
      expect(e2).to.equal(true);
      expect(r1).to.equal(p1);
      expect(r2).to.equal(p2);
    });

    it("collateral is isolated per quote", async () => {
      const bAmt = ethers.parseEther("10");
      const price = ethers.parseEther("100");
      const qAmt = bAmt * price / ONE_ETH;

      const bBefore = await baseToken.balanceOf(oracle.target);
      const qBefore = await quoteToken.balanceOf(oracle.target);

      await submit(bAmt, price); // quote 0
      await submit(bAmt, price); // quote 1

      expect(await baseToken.balanceOf(oracle.target)).to.equal(bBefore + bAmt * 2n);
      expect(await quoteToken.balanceOf(oracle.target)).to.equal(qBefore + qAmt * 2n);

      await mine(3);
      await oracle.settleValidQuote(0n);
      await oracle.settleValidQuote(1n);
      await oracle.connect(accounts.provider).withdrawProviderFunds(0n);
      await oracle.connect(accounts.provider).withdrawProviderFunds(1n);
    });
  });
});
