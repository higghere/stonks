'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, Filter, Sparkles, TrendingUp, ChevronRight, Globe, BarChart2, ShieldCheck } from 'lucide-react';
import { API_URL } from '../lib/config';

interface StockItem {
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  country: string;
  currentPrice: number;
  changePercent: number;
}

export default function PredictionsExplorerPage() {
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSector, setSelectedSector] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalStocks, setTotalStocks] = useState(0);

  const fetchStocks = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '16',
        q: searchQuery,
      });
      if (selectedSector) params.append('sector', selectedSector);

      const res = await fetch(`${API_URL}/api/v1/predictions/stocks?${params.toString()}`);
      const data = await res.json();

      if (data.success) {
        setStocks(data.stocks);
        setTotalPages(data.pagination.totalPages);
        setTotalStocks(data.pagination.total);
      }
    } catch (err) {
      console.error('Failed to fetch stock explorer directory:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchStocks();
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedSector, page]);

  const sectorsList = ['Technology', 'Financial Services', 'Consumer Cyclical', 'Healthcare', 'Energy', 'Communication Services'];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-12">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Hero Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-800/80">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Universal Financial Intelligence Platform</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">
              AI Market Intelligence Explorer
            </h1>
            <p className="text-slate-400 mt-2 max-w-2xl text-sm md:text-base">
              Explore {totalStocks > 0 ? totalStocks : '194+'} global equities. Click any asset to trigger on-demand multi-horizon PyTorch predictions, historical reliability metrics, and explainable feature drivers.
            </p>
          </div>
          
          <div className="flex items-center gap-4 text-xs text-slate-400 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>On-Demand Inference</span>
            </div>
            <div className="h-4 w-px bg-slate-800" />
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-cyan-400" />
              <span>Zero-Compute Browse</span>
            </div>
          </div>
        </div>

        {/* Search & Filter Controls */}
        <div className="flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
          {/* Search Bar */}
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by company name, ticker (e.g. AAPL, TSLA, NVDA), or country..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full bg-slate-900/80 border border-slate-800 rounded-xl pl-11 pr-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
            />
          </div>

          {/* Sector Buttons */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
            <button
              onClick={() => { setSelectedSector(''); setPage(1); }}
              className={`px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                selectedSector === ''
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow-lg shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              All Sectors
            </button>
            {sectorsList.map((sec) => (
              <button
                key={sec}
                onClick={() => { setSelectedSector(sec); setPage(1); }}
                className={`px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                  selectedSector === sec
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow-lg shadow-emerald-500/20'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {sec}
              </button>
            ))}
          </div>
        </div>

        {/* Stock Explorer Cards Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-slate-900/40 border border-slate-800/60 p-6 rounded-2xl animate-pulse h-44 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="h-5 bg-slate-800 rounded w-1/3" />
                  <div className="h-4 bg-slate-800/60 rounded w-2/3" />
                </div>
                <div className="h-6 bg-slate-800/80 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : stocks.length === 0 ? (
          <div className="text-center py-16 bg-slate-900/30 rounded-2xl border border-slate-800/60">
            <Filter className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-slate-300">No Equities Found</h3>
            <p className="text-slate-500 text-sm mt-1">Try adjusting your search filters or ticker keywords.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {stocks.map((stock) => (
              <Link
                key={stock.ticker}
                href={`/predictions/${encodeURIComponent(stock.ticker)}`}
                className="group relative bg-slate-900/60 hover:bg-slate-900/90 border border-slate-800 hover:border-emerald-500/50 p-6 rounded-2xl transition-all duration-300 flex flex-col justify-between hover:shadow-xl hover:shadow-emerald-500/5 hover:-translate-y-1"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-lg font-black tracking-wider text-white group-hover:text-emerald-400 transition-colors">
                      {stock.ticker}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-wider">
                      {stock.exchange}
                    </span>
                  </div>

                  <h4 className="text-sm font-medium text-slate-300 line-clamp-1 mb-4">
                    {stock.name}
                  </h4>

                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
                    <Globe className="w-3.5 h-3.5 text-slate-500" />
                    <span>{stock.sector}</span>
                    <span>•</span>
                    <span>{stock.country}</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800/60 flex items-end justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">Live Quote</span>
                      {stock.changePercent !== 0 && (
                        <span className={`text-[11px] font-bold ${stock.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                        </span>
                      )}
                    </div>
                    <div className="text-lg font-bold text-slate-100 mt-0.5">
                      ${stock.currentPrice.toFixed(2)}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-xs font-semibold text-emerald-400 group-hover:translate-x-1 transition-transform">
                    <span>Forecast</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-6 border-t border-slate-800">
            <span className="text-xs text-slate-500">
              Page {page} of {totalPages} ({totalStocks} Equities)
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-800 bg-slate-900 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-800 bg-slate-900 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
