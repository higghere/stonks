'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, TrendingUp, Compass, ArrowUpRight, ArrowDownRight, LayoutDashboard, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { io } from 'socket.io-client';
import { API_URL, WS_URL } from '../lib/config';
import { useAuthStore } from '../store/authStore';

interface TickerInfo {
  id: string;
  name: string;
  assetType: string;
  exchangeId: string;
  sector: string;
  industry: string;
  currency: string;
  price: number;
  change: number;
  changePercent: number;
  isSimulated?: boolean;
}

interface StockRowProps {
  ticker: TickerInfo;
  socket: any;
}

function StockRow({ ticker, socket }: StockRowProps) {
  const { activeSimulationId } = useAuthStore();
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [price, setPrice] = useState(ticker.price);
  const [change, setChange] = useState(ticker.change);
  const [changePercent, setChangePercent] = useState(ticker.changePercent);

  // Sync with initial quote
  useEffect(() => {
    setPrice(ticker.price);
    setChange(ticker.change);
    setChangePercent(ticker.changePercent);
  }, [ticker.price, ticker.change, ticker.changePercent]);

  // Observer to track if the row is visible in the viewport
  useEffect(() => {
    if (!socket || (activeSimulationId && ticker.isSimulated)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Row entered viewport - subscribe to price updates
            socket.emit('join-interest', [ticker.id]);
          } else {
            // Row left viewport - unsubscribe from updates
            socket.emit('leave-interest', [ticker.id]);
          }
        });
      },
      { threshold: 0.05 }
    );

    if (rowRef.current) {
      observer.observe(rowRef.current);
    }

    return () => {
      observer.disconnect();
      socket.emit('leave-interest', [ticker.id]);
    };
  }, [ticker.id, socket, activeSimulationId, ticker.isSimulated]);

  // Listen specifically for price-update broadcasts
  useEffect(() => {
    if (!socket || (activeSimulationId && ticker.isSimulated)) return;

    const handleUpdate = (updatedQuote: any) => {
      if (updatedQuote.ticker === ticker.id) {
        setPrice(updatedQuote.price);
        setChange(updatedQuote.change);
        setChangePercent(updatedQuote.changePercent);
      }
    };

    socket.on('price-update', handleUpdate);

    return () => {
      socket.off('price-update', handleUpdate);
    };
  }, [ticker.id, socket, activeSimulationId, ticker.isSimulated]);

  const isUp = change >= 0;

  return (
    <tr ref={rowRef} className="hover:bg-slate-850/30 transition-colors">
      <td className="px-6 py-4 font-bold text-white font-mono">{ticker.id}</td>
      <td className="px-6 py-4 font-medium text-slate-350">{ticker.name}</td>
      <td className="px-6 py-4">
        <span className="text-[10px] font-mono text-slate-400 bg-slate-950 border border-slate-850 px-2 py-0.5 rounded">
          {ticker.exchangeId}
        </span>
      </td>
      <td className="px-6 py-4 text-slate-500">{ticker.sector}</td>
      <td className="px-6 py-4 text-right font-mono text-white font-semibold">
        {price > 0 ? `$${price.toFixed(2)}` : 'Loading...'}
      </td>
      <td className={`px-6 py-4 text-right font-mono font-bold ${isUp ? 'text-brand-500' : 'text-red-500'}`}>
        {price > 0 ? (
          <span className="flex items-center justify-end gap-1">
            {isUp ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {isUp ? '+' : ''}{changePercent.toFixed(2)}%
          </span>
        ) : (
          <span className="text-slate-600">-</span>
        )}
      </td>
      <td className="px-6 py-4">
        <Link 
          href={`/stock/${ticker.id}`}
          className="inline-block text-xs font-semibold text-brand-500 hover:text-brand-600 transition-colors hover:underline"
        >
          Trade &rarr;
        </Link>
      </td>
    </tr>
  );
}

export default function AllStocksPage() {
  const { activeSimulationId, token } = useAuthStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [tickersList, setTickersList] = useState<TickerInfo[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [socket, setSocket] = useState<any>(null);

  const loaderRef = useRef<HTMLDivElement>(null);

  // 1. WebSocket initialization
  useEffect(() => {
    const s = io(WS_URL);
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, []);

  // 2. Debounce search query
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(1);
      setTickersList([]);
      setHasMore(true);
    }, 450);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // 3. React Query to fetch paginated directory listings
  const { isLoading, isFetching, refetch } = useQuery({
    queryKey: ['tickers', debouncedQuery, page, activeSimulationId, token],
    queryFn: async () => {
      const url = activeSimulationId
        ? `${API_URL}/api/v1/simulation/${activeSimulationId}/tickers`
        : debouncedQuery.trim()
          ? `${API_URL}/api/v1/market/tickers?q=${encodeURIComponent(debouncedQuery)}&page=${page}&limit=20`
          : `${API_URL}/api/v1/market/tickers?page=${page}&limit=20`;

      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error('Failed to fetch stocks');
      
      const json = await response.json();
      const results = json.tickers || [];

      const finalResults = activeSimulationId && debouncedQuery.trim()
        ? results.filter((t: TickerInfo) => t.id.toUpperCase().includes(debouncedQuery.toUpperCase()) || t.name.toUpperCase().includes(debouncedQuery.toUpperCase()))
        : results;

      if (finalResults.length < 20 || activeSimulationId) {
        setHasMore(false);
      }

      setTickersList((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const filteredNew = finalResults.filter((t: TickerInfo) => !existingIds.has(t.id));
        return page === 1 ? finalResults : [...prev, ...filteredNew];
      });

      return results;
    },
    enabled: true,
  });

  // 4. Infinite scroll intersection observer trigger
  useEffect(() => {
    if (!hasMore || isLoading || isFetching) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    if (loaderRef.current) {
      observer.observe(loaderRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, isLoading, isFetching]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-20">
      
      {/* Content wrapper */}
      <div className="max-w-7xl mx-auto px-6 mt-8 space-y-6">
        
        {/* Title */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-extrabold text-white font-outfit">Market Directory</h1>
            <p className="text-sm text-slate-500 mt-1">Explore all supported stocks, live quotes, and sector specifications.</p>
          </div>
          <button
            onClick={() => {
              setPage(1);
              setTickersList([]);
              setHasMore(true);
              refetch();
            }}
            className="p-2.5 rounded-lg border border-slate-850 bg-slate-900 hover:bg-slate-850 text-slate-400 hover:text-white transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Global Search Bar */}
        <div className="w-full max-w-md">
          <div className="flex items-center bg-slate-900 border border-slate-850 rounded-xl px-4 py-3 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500 transition-all">
            <Search className="text-slate-500 h-5 w-5 mr-3" />
            <input
              type="text"
              placeholder="Search millions of global stocks (e.g. AMZN, TSLA, GME)..."
              className="bg-transparent border-none outline-none text-sm text-white placeholder-slate-500 w-full"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Table of stocks */}
        {isLoading && page === 1 ? (
          <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl h-96 animate-pulse"></div>
        ) : tickersList.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 p-12 rounded-2xl text-center text-slate-500 text-sm">
            No stock listings matched your query "{searchQuery}".
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-850 bg-slate-950 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="px-6 py-4">Symbol</th>
                    <th className="px-6 py-4">Company Name</th>
                    <th className="px-6 py-4">Exchange</th>
                    <th className="px-6 py-4">Sector</th>
                    <th className="px-6 py-4 text-right">Live Price</th>
                    <th className="px-6 py-4 text-right">Change</th>
                    <th className="px-6 py-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850 text-sm">
                  {tickersList.map((t) => (
                    <StockRow key={t.id} ticker={t} socket={socket} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Infinite Scroll Sentinel Loading Indicator */}
        {hasMore && (
          <div ref={loaderRef} className="py-6 flex justify-center items-center">
            <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-brand-500"></div>
            <span className="text-xs text-slate-500 ml-3">Loading more symbols...</span>
          </div>
        )}

      </div>
    </div>
  );
}
