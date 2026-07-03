'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, TrendingUp, Compass, LogIn, UserPlus } from 'lucide-react';
import { useAuthStore } from './store/authStore';

interface SearchResult {
  ticker: string;
  name: string;
  exchange: string;
  assetType: string;
}

const TRENDING_TICKERS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corp.' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
];

function TrendingCard({ symbol, defaultName }: { symbol: string; defaultName: string }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const response = await fetch(`http://localhost:4000/api/v1/market/stock/${symbol}`);
        if (response.ok) {
          const json = await response.json();
          setData(json.data);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchPrice();
    const interval = setInterval(fetchPrice, 10000);
    return () => clearInterval(interval);
  }, [symbol]);

  const price = data?.quote?.price ?? 0;
  const changePercent = data?.quote?.changePercent ?? 0;
  const isUp = changePercent >= 0;

  return (
    <Link
      href={`/stock/${symbol}`}
      className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 shadow transition-all hover:-translate-y-0.5 flex flex-col justify-between h-36"
    >
      <div>
        <span className="font-extrabold text-white font-mono text-base">{symbol}</span>
        <h4 className="text-xs text-slate-500 truncate mt-0.5">{data?.profile?.name ?? defaultName}</h4>
      </div>
      <div className="mt-4 flex justify-between items-baseline">
        <span className="font-bold text-white font-mono">
          {price > 0 ? `$${price.toFixed(2)}` : 'Loading...'}
        </span>
        {price > 0 && (
          <span className={`text-xs font-semibold font-mono ${isUp ? 'text-brand-500' : 'text-red-500'}`}>
            {isUp ? '+' : ''}{changePercent.toFixed(2)}%
          </span>
        )}
      </div>
    </Link>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Debounce search input and call the search API
  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }

    const delay = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(`http://localhost:4000/api/v1/market/search?q=${encodeURIComponent(query)}`);
        if (response.ok) {
          const json = await response.json();
          setResults(json.results);
        }
      } catch (err) {
        console.error('Search query failed', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(delay);
  }, [query]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      


      {/* Hero Section */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-20 flex flex-col items-center justify-center text-center gap-8">
        <div className="space-y-4">
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight text-white font-outfit leading-tight max-w-3xl">
            Simulate the Markets in <span className="text-brand-500 bg-gradient-to-r from-brand-500 to-emerald-400 bg-clip-text text-transparent">Real-Time</span>
          </h1>
          <p className="text-slate-400 text-lg md:text-xl max-w-xl mx-auto leading-relaxed">
            Practice paper trading with $100,000 in virtual capital. Real-time tickers, double-entry ledgers, and zero risk.
          </p>
        </div>

        {/* Global Ticker Search Bar */}
        <div className="w-full max-w-xl relative mt-4">
          <div className="relative flex items-center bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500 transition-all overflow-hidden">
            <Search className="text-slate-500 h-5 w-5 ml-4 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by ticker (e.g. AAPL, MSFT) or company name..."
              className="w-full bg-transparent border-none outline-none py-4 px-3 text-white placeholder-slate-500 text-base"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* Search suggestions drop down results */}
          {query.trim().length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl z-50 text-left">
              {isSearching ? (
                <div className="p-4 text-center text-slate-500 text-sm">Searching Tickers...</div>
              ) : results.length === 0 ? (
                <div className="p-4 text-center text-slate-500 text-sm">No results match "{query}"</div>
              ) : (
                <div className="divide-y divide-slate-850">
                  {results.map((result) => (
                    <button
                      key={result.ticker}
                      onClick={() => router.push(`/stock/${result.ticker}`)}
                      className="w-full px-5 py-4 hover:bg-slate-850 flex justify-between items-center transition-colors text-left"
                    >
                      <div>
                        <div className="font-bold text-white font-mono">{result.ticker}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{result.name}</div>
                      </div>
                      <span className="text-xs font-semibold text-slate-400 bg-slate-950 border border-slate-800 px-2 py-0.5 rounded font-mono">
                        {result.exchange}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Trending tickers showcase grid */}
        <div className="w-full max-w-3xl mt-12 space-y-4 text-left">
          <div className="flex items-center gap-2 text-slate-400 font-bold text-sm uppercase tracking-wider">
            <Compass className="h-4 w-4" /> Trending Equities
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {TRENDING_TICKERS.map((trending) => (
              <TrendingCard
                key={trending.symbol}
                symbol={trending.symbol}
                defaultName={trending.name}
              />
            ))}
          </div>
        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-600 mt-auto">
        &copy; {new Date().getFullYear()} Antigravity Trading Systems. For simulation and training purposes only.
      </footer>
    </div>
  );
}
