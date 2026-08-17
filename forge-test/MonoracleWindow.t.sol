// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Monoracle} from "../contracts/Monoracle.sol";
import {MockERC20} from "../contracts/MockERC20.sol";

/**
 * @dev CWV-01: Configurable verification window.
 *      Deterministic tests — block numbers are controlled with vm.roll(),
 *      so there is no RPC head-lag flakiness like on live testnet.
 */
contract MonoracleWindowTest is Test {
    Monoracle internal oracle;
    MockERC20 internal base;
    MockERC20 internal quote;

    address internal provider = makeAddr("provider");
    address internal verifier = makeAddr("verifier");
    address internal other = makeAddr("other");

    uint256 internal constant BASE_AMT = 1e18;
    uint256 internal constant QUOTE_AMT = 100e18; // price 100 (1e18 fixed)

    function setUp() public {
        base = new MockERC20("Base", "BASE", 18);
        quote = new MockERC20("Quote", "QUOTE", 18);
        oracle = new Monoracle();

        base.mint(provider, BASE_AMT * 10);
        quote.mint(provider, QUOTE_AMT * 10);
        base.mint(verifier, BASE_AMT * 10);
        quote.mint(verifier, QUOTE_AMT * 10);

        vm.startPrank(provider);
        base.approve(address(oracle), type(uint256).max);
        quote.approve(address(oracle), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(verifier);
        base.approve(address(oracle), type(uint256).max);
        quote.approve(address(oracle), type(uint256).max);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------

    function test_constants() public view {
        assertEq(oracle.VERIFICATION_SLOTS(), 2);
        assertEq(oracle.MAX_VERIFICATION_SLOTS(), 12000);
    }

    // ---------------------------------------------------------------
    // Expiry validation at submit time
    // ---------------------------------------------------------------

    function test_expiryMustBeFuture() public {
        uint32 expiry = uint32(block.number);
        vm.prank(provider);
        vm.expectRevert(Monoracle.ExpiryMustBeFuture.selector);
        oracle.submitQuote(address(base), address(quote), BASE_AMT, QUOTE_AMT, expiry);
    }

    function test_expiryTooFar() public {
        uint32 expiry = uint32(block.number + oracle.MAX_VERIFICATION_SLOTS() + 1);
        vm.prank(provider);
        vm.expectRevert(Monoracle.ExpiryTooFar.selector);
        oracle.submitQuote(address(base), address(quote), BASE_AMT, QUOTE_AMT, expiry);
    }

    function test_expiryAtMaxBoundaryAllowed() public {
        uint32 expiry = uint32(block.number + oracle.MAX_VERIFICATION_SLOTS());
        vm.prank(provider);
        uint256 id = oracle.submitQuote(address(base), address(quote), BASE_AMT, QUOTE_AMT, expiry);
        assertEq(id, 1);
        Monoracle.Quote memory q = _getQuote(id);
        assertEq(q.startSlot, uint32(block.number));
        assertEq(q.expiryBlock, expiry);
    }

    // ---------------------------------------------------------------
    // Window is inclusive: veto allowed at exactly expiryBlock
    // ---------------------------------------------------------------

    function test_vetoAllowedAtExactExpiryBlock() public {
        uint32 expiry = uint32(block.number + 5);
        vm.prank(provider);
        uint256 id = oracle.submitQuote(address(base), address(quote), BASE_AMT, QUOTE_AMT, expiry);

        // Move to exactly expiryBlock and veto — must succeed (inclusive).
        vm.roll(expiry);
        vm.prank(verifier);
        oracle.vetoOverpriced(id);
        assertEq(uint256(_getQuote(id).status), uint256(Monoracle.QuoteStatus.VETOED_OVERPRICED));
    }

    function test_vetoRejectedOneBlockAfterExpiry() public {
        uint32 expiry = uint32(block.number + 5);
        vm.prank(provider);
        uint256 id = oracle.submitQuote(address(base), address(quote), BASE_AMT, QUOTE_AMT, expiry);

        vm.roll(expiry + 1);
        vm.prank(verifier);
        vm.expectRevert(Monoracle.VerificationWindowExpired.selector);
        oracle.vetoOverpriced(id);
    }

    // ---------------------------------------------------------------
    // Long window: quote stays vetoable well past the default 2 slots
    // ---------------------------------------------------------------

    function test_longWindowStaysActivePastDefaultWindow() public {
        uint32 submittedAt = uint32(block.number);
        uint32 expiry = uint32(block.number + 200);
        vm.prank(provider);
        uint256 id = oracle.submitQuote(address(base), address(quote), BASE_AMT, QUOTE_AMT, expiry);

        // Way past the default 2-slot window, quote still ACTIVE.
        vm.roll(submittedAt + 50);
        assertEq(uint256(_getQuote(id).status), uint256(Monoracle.QuoteStatus.ACTIVE));
        assertEq(_getQuote(id).startSlot, submittedAt);

        // Still vetoable deep inside the long window.
        vm.roll(submittedAt + 100);
        vm.prank(verifier);
        oracle.vetoOverpriced(id);
        assertEq(uint256(_getQuote(id).status), uint256(Monoracle.QuoteStatus.VETOED_OVERPRICED));
    }

    function test_longWindowVetoAfterExpiryRejected() public {
        uint32 expiry = uint32(block.number + 200);
        vm.prank(provider);
        uint256 id = oracle.submitQuote(address(base), address(quote), BASE_AMT, QUOTE_AMT, expiry);

        vm.roll(expiry + 1);
        vm.prank(verifier);
        vm.expectRevert(Monoracle.VerificationWindowExpired.selector);
        oracle.vetoOverpriced(id);
    }

    // ---------------------------------------------------------------
    // Settle gating by expiry
    // ---------------------------------------------------------------

    function test_settleRejectedInsideWindow() public {
        uint32 expiry = uint32(block.number + 100);
        vm.prank(provider);
        uint256 id = oracle.submitQuote(address(base), address(quote), BASE_AMT, QUOTE_AMT, expiry);

        vm.roll(block.number + 10);
        vm.prank(other);
        vm.expectRevert(Monoracle.VerificationWindowActive.selector);
        oracle.settleValidQuote(id);
    }

    function test_settleAllowedAfterExpiry() public {
        uint32 expiry = uint32(block.number + 3);
        vm.prank(provider);
        uint256 id = oracle.submitQuote(address(base), address(quote), BASE_AMT, QUOTE_AMT, expiry);

        vm.roll(expiry + 1);
        vm.prank(other);
        oracle.settleValidQuote(id);

        (uint256 price, uint32 settledSlot, bool exists) = oracle.getLatestPrice(address(base), address(quote));
        assertTrue(exists);
        assertEq(price, QUOTE_AMT * 1e18 / BASE_AMT);
        assertGt(settledSlot, 0);
        assertEq(_getQuote(id).settledSlot, uint32(expiry + 1));
    }

    // ---------------------------------------------------------------
    // Short (default) window: settle only after the window passes
    // ---------------------------------------------------------------

    function test_shortWindowSettleSequence() public {
        uint32 expiry = uint32(block.number + oracle.VERIFICATION_SLOTS());
        vm.prank(provider);
        uint256 id = oracle.submitQuote(address(base), address(quote), BASE_AMT, QUOTE_AMT, expiry);

        // Inside window: settle reverts.
        vm.roll(block.number + 1);
        vm.prank(other);
        vm.expectRevert(Monoracle.VerificationWindowActive.selector);
        oracle.settleValidQuote(id);

        // After window: settle succeeds.
        vm.roll(expiry + 1);
        vm.prank(other);
        oracle.settleValidQuote(id);
        assertEq(uint256(_getQuote(id).status), uint256(Monoracle.QuoteStatus.SETTLED_VALID));
    }

    // ---------------------------------------------------------------
    // Default 2-slot veto timing parity
    // ---------------------------------------------------------------

    function test_defaultTwoSlotVetoTiming() public {
        uint32 expiry = uint32(block.number + oracle.VERIFICATION_SLOTS());
        vm.prank(provider);
        uint256 id = oracle.submitQuote(address(base), address(quote), BASE_AMT, QUOTE_AMT, expiry);

        // Veto at +1 (inside) — succeeds.
        vm.roll(block.number + 1);
        vm.prank(verifier);
        oracle.vetoUnderpriced(id);
        assertEq(uint256(_getQuote(id).status), uint256(Monoracle.QuoteStatus.VETOED_UNDERPRICED));
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    function _getQuote(uint256 id) internal view returns (Monoracle.Quote memory q) {
        (
            address provider_,
            address baseToken_,
            address quoteToken_,
            uint256 baseAmount_,
            uint256 quoteAmount_,
            uint256 price_,
            uint32 startSlot_,
            uint32 expiryBlock_,
            uint32 settledSlot_,
            Monoracle.QuoteStatus status_
        ) = oracle.quotes(id);
        q.provider = provider_;
        q.baseToken = baseToken_;
        q.quoteToken = quoteToken_;
        q.baseAmount = baseAmount_;
        q.quoteAmount = quoteAmount_;
        q.price = price_;
        q.startSlot = startSlot_;
        q.expiryBlock = expiryBlock_;
        q.settledSlot = settledSlot_;
        q.status = status_;
    }
}
