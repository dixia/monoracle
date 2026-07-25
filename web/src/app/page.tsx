"use client";

import { useAccount, useConnect, useDisconnect, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { injected } from "wagmi/connectors";
import { CONTRACT_ADDRESS, CONTRACT_ABI, EXPLORER_URL, TEST_TOKENS } from "@/lib/oracle";
import { useState, useEffect, useRef } from "react";
import { parseEther, formatEther, maxUint256 } from "viem";

export default function Home() {
  return (
    <main className="flex-1">
      <Header />
      <div className="max-w-2xl mx-auto px-4 py-12 space-y-10">
        <Hero />
        <ContractInfo />
        <PriceReader />
        <QuoteSubmit />
        <Footer />
      </div>
    </main>
  );
}

function Header() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur sticky top-0 z-50">
      <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
        <span className="font-bold text-lg tracking-tight">Monoracle</span>
        {isConnected ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-400 font-mono">
              {address?.slice(0, 6)}...{address?.slice(-4)}
            </span>
            <button
              onClick={() => disconnect()}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors text-xs font-medium"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => connect({ connector: injected() })}
            className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-colors"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="text-center space-y-4 pt-8">
      <h1 className="text-4xl font-bold tracking-tight">
        <span className="text-amber-500">Monoracle</span>
      </h1>
      <p className="text-zinc-400 text-lg max-w-md mx-auto">
        Fully decentralized price oracle on Monad. Bilateral collateral + permissionless veto arbitrage.
      </p>
      <div className="flex justify-center gap-3 pt-2">
        <a
          href="https://github.com/iamh4/monoracle"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
        >
          GitHub
        </a>
        <a
          href={EXPLORER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
        >
          Explorer
        </a>
      </div>
    </section>
  );
}

function ContractInfo() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
      <h2 className="text-lg font-semibold">Deployed Contract</h2>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-500">Network</span>
          <span className="font-mono text-amber-400">Monad Testnet</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Chain ID</span>
          <span className="font-mono">10143</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-zinc-500">Address</span>
          <a
            href={EXPLORER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm text-blue-400 hover:text-blue-300 truncate max-w-[280px]"
          >
            {CONTRACT_ADDRESS}
          </a>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Verification Window</span>
          <span className="font-mono">2 slots (~600ms)</span>
        </div>
      </div>
    </section>
  );
}

function PriceReader() {
  const [baseInput, setBaseInput] = useState(TEST_TOKENS.BASE.address);
  const [quoteInput, setQuoteInput] = useState(TEST_TOKENS.QUOTE.address);
  const [base, setBase] = useState(TEST_TOKENS.BASE.address);
  const [quote, setQuote] = useState(TEST_TOKENS.QUOTE.address);

  const { data, isLoading, error } = useReadContract({
    address: CONTRACT_ADDRESS as `0x${string}`,
    abi: CONTRACT_ABI,
    functionName: "getLatestPrice",
    args: [base as `0x${string}`, quote as `0x${string}`],
    query: { enabled: !!base && !!quote },
  });

  const [price, settledSlot, exists] = (data as [bigint, number, boolean]) ?? [0n, 0, false];

  function handleSearch() {
    if (baseInput && quoteInput) {
      setBase(baseInput);
      setQuote(quoteInput);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
      <h2 className="text-lg font-semibold">Read Latest Price</h2>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            value={baseInput}
            onChange={(e) => setBaseInput(e.target.value)}
            placeholder="Base token address"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500"
          />
          <input
            value={quoteInput}
            onChange={(e) => setQuoteInput(e.target.value)}
            placeholder="Quote token address"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500"
          />
          <button
            onClick={handleSearch}
            className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-colors"
          >
            Query
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: "Test BASE/QUOTE", base: TEST_TOKENS.BASE.address, quote: TEST_TOKENS.QUOTE.address },
            { label: "USDC/USDT", base: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", quote: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D" },
            { label: "WETH/WMON", base: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242", quote: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A" },
            { label: "WBTC/USDC", base: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", quote: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => { setBaseInput(p.base); setQuoteInput(p.quote); setBase(p.base); setQuote(p.quote); }}
              className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 transition-colors border border-zinc-700"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-4">
        {isLoading && <p className="text-zinc-500 text-sm">Loading...</p>}
        {error && <p className="text-red-400 text-sm">Error: {error.message}</p>}
        {!isLoading && !error && !exists && (
          <p className="text-zinc-500 text-sm">No price data for this pair yet. Submit a quote first.</p>
        )}
        {!isLoading && exists && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Price (1e18)</span>
              <span className="font-mono text-green-400">{price.toString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Price (decimal)</span>
              <span className="font-mono text-green-400">{formatEther(price)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Settled At Block</span>
              <span className="font-mono">{settledSlot?.toString()}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
];

function QuoteSubmit() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContract, data: txHash, isPending, isError, error } = useWriteContract();
  const { isLoading: isWaiting, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const [baseToken, setBaseToken] = useState(TEST_TOKENS.BASE.address);
  const [quoteToken, setQuoteToken] = useState(TEST_TOKENS.QUOTE.address);
  const [baseAmount, setBaseAmount] = useState("2");
  const [price, setPrice] = useState("100");
  const [status, setStatus] = useState("");
  const [step, setStep] = useState<"idle" | "approve_base" | "approve_quote" | "submit" | "done">("idle");
  const [checking, setChecking] = useState(false);

  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    if (!isSuccess || !txHash) return;
    if (stepRef.current === "approve_base") {
      setStatus("Approved BASE. Approving QUOTE...");
      setStep("approve_quote");
    } else if (stepRef.current === "approve_quote") {
      setStatus("Approved QUOTE. Submitting quote...");
      setStep("submit");
    } else if (stepRef.current === "submit") {
      setStatus("Quote submitted successfully!");
      setStep("done");
    }
  }, [isSuccess, txHash]);

  useEffect(() => {
    if (step === "idle" || step === "done") return;
    if (step === "approve_base") {
      writeContract({
        address: baseToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACT_ADDRESS as `0x${string}`, maxUint256],
      });
      setStatus("Approve BASE in your wallet...");
    } else if (step === "approve_quote") {
      writeContract({
        address: quoteToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACT_ADDRESS as `0x${string}`, maxUint256],
      });
      setStatus("Approve QUOTE in your wallet...");
    } else if (step === "submit") {
      const bAmt = parseEther(baseAmount);
      writeContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: CONTRACT_ABI,
        functionName: "submitQuote",
        args: [baseToken as `0x${string}`, quoteToken as `0x${string}`, bAmt, parseEther(price)],
      });
      setStatus("Submit quote in your wallet...");
    }
  }, [step]);

  useEffect(() => {
    if (isError && error) {
      setStatus(`Error: ${error.message?.split(".")[0] || "User rejected"}`);
      setStep("idle");
    }
  }, [isError, error]);

  async function handleSubmit() {
    if (checking || step !== "idle" || !address || !publicClient || !baseToken || !quoteToken || !baseAmount || !price) return;
    setChecking(true);
    setStatus("Checking allowances...");

    try {
      const bAmt = parseEther(baseAmount);
      const pAmt = parseEther(price);
      const qAmt = (bAmt * pAmt) / 10n ** 18n;

      const [baseAllowance, quoteAllowance] = await Promise.all([
        publicClient.readContract({
          address: baseToken as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, CONTRACT_ADDRESS as `0x${string}`],
        }),
        publicClient.readContract({
          address: quoteToken as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, CONTRACT_ADDRESS as `0x${string}`],
        }),
      ]) as [bigint, bigint];

      const baseNeeded = baseAllowance < bAmt;
      const quoteNeeded = quoteAllowance < qAmt;

      if (!baseNeeded && !quoteNeeded) {
        setStep("submit");
      } else if (baseNeeded) {
        setStep("approve_base");
      } else {
        setStep("approve_quote");
      }
    } catch (e: any) {
      setStatus(`Error checking allowance: ${e.message?.split(".")[0] || e.message}`);
    } finally {
      setChecking(false);
    }
  }

  const busy = checking || (step !== "idle" && step !== "done");

  function handleReset() {
    setStep("idle");
    setStatus("");
  }

  if (!isConnected) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
        <h2 className="text-lg font-semibold">Submit a Quote</h2>
        <p className="text-zinc-500 text-sm">Connect your wallet to submit a price quotation.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
      <h2 className="text-lg font-semibold">Submit a Quote</h2>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Base Token</label>
            <input
              value={baseToken}
              onChange={(e) => setBaseToken(e.target.value)}
              disabled={busy}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Quote Token</label>
            <input
              value={quoteToken}
              onChange={(e) => setQuoteToken(e.target.value)}
              disabled={busy}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500 disabled:opacity-50"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Base Amount (token units)</label>
            <input
              value={baseAmount}
              onChange={(e) => setBaseAmount(e.target.value)}
              disabled={busy}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Price (1e18, quote per base)</label>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={busy}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500 disabled:opacity-50"
            />
          </div>
        </div>
        <button
          onClick={handleSubmit}
          disabled={busy || !baseToken || !quoteToken || !baseAmount || !price}
          className="w-full py-3 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black font-semibold text-sm transition-colors"
        >
          {step === "approve_base" ? "Approving BASE..." :
           step === "approve_quote" ? "Approving QUOTE..." :
           step === "submit" ? "Submitting..." :
           step === "done" ? "Submitted ✓" : "Submit Quote"}
        </button>
        {status && (
          <p className={`text-sm ${step === "done" ? "text-green-400" : "text-zinc-400"}`}>{status}</p>
        )}
        {txHash && (
          <a
            href={`https://testnet.monadscan.com/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-xs text-blue-400 hover:text-blue-300 truncate"
          >
            Tx: {txHash.slice(0, 42)}...
          </a>
        )}
        {step === "done" && (
          <button
            onClick={handleReset}
            className="w-full py-2 rounded-lg border border-zinc-700 hover:bg-zinc-800 text-zinc-400 text-sm transition-colors"
          >
            Submit Another Quote
          </button>
        )}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="text-center text-xs text-zinc-600 py-8 border-t border-zinc-800">
      <p>Monoracle — Built for Monad Blitz@武汉 · Deployed on Monad Testnet</p>
      <p className="mt-1">
        <a href="https://github.com/your-org/monoracle" className="hover:text-zinc-400">GitHub</a>
        {" · "}
        <a href={EXPLORER_URL} className="hover:text-zinc-400">Explorer</a>
        {" · "}
        <span>300ms block time · 2-slot verification window</span>
      </p>
    </footer>
  );
}
