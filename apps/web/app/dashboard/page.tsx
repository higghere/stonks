'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  TrendingUp,
  Wallet,
  Briefcase,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Eye,
  Bell,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import PortfolioChart from '../components/PortfolioChart';
import { io } from 'socket.io-client';
import { API_URL, WS_URL } from '../lib/config';

interface Position {
  id: string;
  tickerId: string;
  name: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPL: number;
  unrealizedPLPercent: number;
}

interface Order {
  id: string;
  tickerId: string;
  side: string;
  type: string;
  status: string;
  quantity: number;
  price?: number;
  createdAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { token, user, logout } = useAuthStore();
  const setSession = useAuthStore((state) => state.setSession);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isProcessingToken, setIsProcessingToken] = useState(true);

  const [watchlistInput, setWatchlistInput] = useState('');
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [alertSymbol, setAlertSymbol] = useState('');
  const [alertCondition, setAlertCondition] = useState('ABOVE');
  const [alertValue, setAlertValue] = useState('');
  const [alertError, setAlertError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);

  // 1. Extract OAuth token and validate session
  useEffect(() => {
    const handleAuthToken = async () => {
      const searchParams = new URLSearchParams(window.location.search);
      const urlToken = searchParams.get('token');

      if (urlToken) {
        try {
          const res = await fetch(`${API_URL}/api/v1/auth/me`, {
            headers: { Authorization: `Bearer ${urlToken}` },
          });
          const data = (await res.ok) ? await res.json() : null;

          if (data && data.success && data.user) {
            setSession(urlToken, {
              id: data.user.userId,
              email: data.user.email,
              name: data.user.name || 'Trader',
              role: data.user.role || 'user',
            });

            window.history.replaceState({}, document.title, window.location.pathname);
            setIsProcessingToken(false);
            return;
          }
        } catch (err) {
          console.error('OAuth token validation failed', err);
        }
      }

      if (!token && !urlToken) {
        router.push('/login');
      } else {
        setIsProcessingToken(false);
      }
    };

    handleAuthToken();
  }, [token, router, setSession]);

  // 2. Query Portfolio Data
  const {
    data: portfolioData,
    isLoading: portfolioLoading,
    refetch: refetchPortfolio,
  } = useQuery({
    queryKey: ['portfolio'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/v1/portfolio`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to load portfolio');
      const json = await response.json();
      return json.data;
    },
    enabled: !!token,
  });

  // 3. Query User Orders
  const { data: ordersData, isLoading: ordersLoading, refetch: refetchOrders } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/v1/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to load orders');
      const json = await response.json();
      return json.orders;
    },
    enabled: !!token,
  });

  // 4. Query Portfolio History snapshots
  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ['portfolio-history'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/v1/portfolio/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to load portfolio history');
      const json = await response.json();
      return json.history;
    },
    enabled: !!token,
  });

  // 5. Query Watchlist symbols
  const { data: watchlistData, refetch: refetchWatchlist } = useQuery({
    queryKey: ['watchlist'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/v1/watchlist`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to load watchlist');
      const json = await response.json();
      return json.watchlist;
    },
    enabled: !!token,
  });

  // 6. Query Price Alerts
  const { data: alertsData, refetch: refetchAlerts } = useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/v1/alerts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to load alerts');
      const json = await response.json();
      return json.alerts;
    },
    enabled: !!token,
  });

  const [socket, setSocket] = useState<any>(null);

  // 7. WebSocket Listener for real-time alerts and price updates
  useEffect(() => {
    if (!token || !user) return;

    const s = io(WS_URL, {
      query: { userId: user.id },
    });
    setSocket(s);

    s.on('price-alert', (alert: any) => {
      setNotifications((prev) => [
        {
          id: alert.id,
          message: `🔔 Price Alert triggered! ${alert.symbol} is now ${alert.condition.toLowerCase()} $${alert.value} (Current: $${alert.currentPrice.toFixed(2)})`,
          time: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);
      refetchAlerts();
      refetchPortfolio();
      refetchHistory();
    });

    return () => {
      s.disconnect();
    };
  }, [token, user, refetchAlerts, refetchPortfolio, refetchHistory]);

  // 7.1 Active Symbol Tracking (Register interest for holdings & watchlist)
  useEffect(() => {
    if (!socket || !portfolioData) return;

    const watchlistSymbols = (watchlistData || []).map((w: any) => w.symbol);
    const positionSymbols = (portfolioData.positions || []).map((p: Position) => p.tickerId);
    const symbols = Array.from(new Set([...watchlistSymbols, ...positionSymbols]));

    if (symbols.length > 0) {
      socket.emit('join-interest', symbols);
    }

    // Update quote price/change in local states or refetch when updates arrive
    const handlePriceUpdate = (quote: any) => {
      refetchPortfolio();
      refetchWatchlist();
    };

    socket.on('price-update', handlePriceUpdate);

    return () => {
      if (symbols.length > 0) {
        socket.emit('leave-interest', symbols);
      }
      socket.off('price-update', handlePriceUpdate);
    };
  }, [socket, portfolioData, watchlistData, refetchPortfolio, refetchWatchlist]);

  // 8. Handle Search input
  useEffect(() => {
    if (searchQuery.trim().length === 0) {
      setSearchResults([]);
      return;
    }
    const delay = setTimeout(async () => {
      try {
        const response = await fetch(
          `${API_URL}/api/v1/market/search?q=${encodeURIComponent(searchQuery)}`
        );
        if (response.ok) {
          const json = await response.json();
          setSearchResults(json.results);
        }
      } catch (err) {
        console.error(err);
      }
    }, 300);
    return () => clearTimeout(delay);
  }, [searchQuery]);

  const handleAddWatchlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!watchlistInput.trim()) return;
    setWatchlistError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/watchlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ symbol: watchlistInput.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to add symbol');
      setWatchlistInput('');
      refetchWatchlist();
    } catch (err: any) {
      setWatchlistError(err.message);
    }
  };

  const handleRemoveWatchlist = async (symbol: string) => {
    try {
      await fetch(`${API_URL}/api/v1/watchlist/${symbol}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      refetchWatchlist();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alertSymbol.trim() || !alertValue.trim()) return;
    setAlertError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/alerts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          symbol: alertSymbol.trim().toUpperCase(),
          type: 'PRICE',
          condition: alertCondition,
          value: Number(alertValue),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to set alert');
      setAlertSymbol('');
      setAlertValue('');
      refetchAlerts();
    } catch (err: any) {
      setAlertError(err.message);
    }
  };

  const handleDeleteAlert = async (id: string) => {
    try {
      await fetch(`${API_URL}/api/v1/alerts/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      refetchAlerts();
    } catch (err) {
      console.error(err);
    }
  };

  const handleManualRefresh = () => {
    refetchPortfolio();
    refetchOrders();
    refetchHistory();
    refetchWatchlist();
    refetchAlerts();
  };

  if (isProcessingToken || !token || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-brand-500"></div>
      </div>
    );
  }

  const account = portfolioData?.account;
  const positions: Position[] = portfolioData?.positions || [];
  const orders: Order[] = ordersData || [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-16">
      
      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-6 mt-8 space-y-8">
        
        {/* Real-time Alert Notifications */}
        {notifications.length > 0 && (
          <div className="space-y-2">
            {notifications.slice(0, 3).map((notif, index) => (
              <div 
                key={index} 
                className="bg-brand-500/15 border border-brand-500/35 p-4 rounded-xl flex justify-between items-center text-sm text-white animate-pulse"
              >
                <span className="font-semibold">{notif.message}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 font-mono">{notif.time}</span>
                  <button 
                    onClick={() => setNotifications((prev) => prev.filter((_, i) => i !== index))}
                    className="text-slate-500 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Dashboard Title */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-extrabold text-white font-outfit">Trader Dashboard</h1>
            <p className="text-sm text-slate-500 mt-1">Review your simulated portfolio worth and active equity holdings.</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Ticker Search Bar */}
            <div className="w-64 relative">
              <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 focus-within:border-brand-500 transition-colors">
                <Search className="text-slate-500 h-4 w-4 mr-2" />
                <input
                  type="text"
                  placeholder="Search ticker to trade..."
                  className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-500 w-full"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              
              {searchQuery.trim().length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-2xl z-50">
                  {searchResults.length === 0 ? (
                    <div className="p-3 text-xs text-slate-500">No results</div>
                  ) : (
                    searchResults.map((res) => (
                      <button
                        key={res.ticker}
                        onClick={() => {
                          setSearchQuery('');
                          router.push(`/stock/${res.ticker}`);
                        }}
                        className="w-full px-4 py-3 hover:bg-slate-850 text-left flex justify-between items-center text-xs"
                      >
                        <div>
                          <div className="font-bold text-white font-mono">{res.ticker}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{res.name}</div>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded">
                          {res.exchange}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <button
              onClick={handleManualRefresh}
              className="p-2.5 rounded-lg border border-slate-850 bg-slate-900 hover:bg-slate-850 text-slate-400 hover:text-white transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Portfolio Stats Summary Grid */}
        {portfolioLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl h-24 animate-pulse"></div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl h-24 animate-pulse"></div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl h-24 animate-pulse"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Net Asset Value */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl flex items-center justify-between shadow-sm">
              <div className="space-y-1">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Net Asset Value (NAV)</span>
                <h2 className="text-3xl font-extrabold text-white font-mono">
                  ${account?.totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </h2>
              </div>
              <div className="bg-brand-500/10 p-3.5 rounded-xl border border-brand-500/20">
                <Briefcase className="text-brand-500 h-6 w-6" />
              </div>
            </div>

            {/* Cash Balance */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl flex items-center justify-between shadow-sm">
              <div className="space-y-1">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cash Reserves</span>
                <h2 className="text-3xl font-extrabold text-white font-mono">
                  ${account?.cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </h2>
              </div>
              <div className="bg-emerald-500/10 p-3.5 rounded-xl border border-emerald-500/20">
                <Wallet className="text-emerald-500 h-6 w-6" />
              </div>
            </div>

            {/* Total Return */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl flex items-center justify-between shadow-sm">
              <div className="space-y-1">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Assets Value</span>
                <h2 className="text-3xl font-extrabold text-white font-mono">
                  ${account?.totalMarketValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </h2>
              </div>
              <div className="bg-indigo-500/10 p-3.5 rounded-xl border border-indigo-500/20">
                <TrendingUp className="text-indigo-500 h-6 w-6" />
              </div>
            </div>

          </div>
        )}

        {/* Historical Net Worth Chart */}
        {historyData && historyData.length > 0 && (
          <div className="w-full">
            <PortfolioChart data={historyData} />
          </div>
        )}

        {/* Positions and orders details sections */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Active Positions (Left 2 columns) */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-xl font-bold text-white font-outfit">Active Positions</h2>
            
            {portfolioLoading ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl h-80 animate-pulse"></div>
            ) : positions.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-500 text-sm">
                No active stock holdings in your portfolio. Use the search bar to find securities and place a trade!
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-850 bg-slate-950/50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="px-5 py-4">Ticker</th>
                        <th className="px-5 py-4 text-right">Shares</th>
                        <th className="px-5 py-4 text-right">Avg Price</th>
                        <th className="px-5 py-4 text-right">Live Price</th>
                        <th className="px-5 py-4 text-right">Market Value</th>
                        <th className="px-5 py-4 text-right">Return</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850 text-sm">
                      {positions.map((pos) => {
                        const isProfit = pos.unrealizedPL >= 0;
                        return (
                          <tr key={pos.id} className="hover:bg-slate-850/50 transition-colors">
                            <td className="px-5 py-4">
                              <Link href={`/stock/${pos.tickerId}`} className="group">
                                <div className="font-bold text-white font-mono group-hover:text-brand-500 transition-colors">{pos.tickerId}</div>
                                <div className="text-[10px] text-slate-500 mt-0.5">{pos.name}</div>
                              </Link>
                            </td>
                            <td className="px-5 py-4 text-right font-mono text-white font-medium">{pos.quantity}</td>
                            <td className="px-5 py-4 text-right font-mono text-slate-400">${pos.averagePrice.toFixed(2)}</td>
                            <td className="px-5 py-4 text-right font-mono text-white">${pos.currentPrice.toFixed(2)}</td>
                            <td className="px-5 py-4 text-right font-mono text-white font-semibold">${pos.marketValue.toFixed(2)}</td>
                            <td className={`px-5 py-4 text-right font-mono font-bold ${isProfit ? 'text-brand-500' : 'text-red-500'}`}>
                              <span className="flex items-center justify-end gap-1">
                                {isProfit ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                                {isProfit ? '+' : ''}{pos.unrealizedPLPercent.toFixed(2)}%
                              </span>
                              <span className="block text-[10px] font-medium opacity-80 mt-0.5">
                                {isProfit ? '+' : ''}${pos.unrealizedPL.toFixed(2)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Right column - stacked widgets */}
          <div className="space-y-6">
            
            {/* Recent Orders */}
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white font-outfit">Recent Orders</h2>
              
              {ordersLoading ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl h-64 animate-pulse"></div>
              ) : orders.length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-500 text-sm">
                  No orders record found.
                </div>
              ) : (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 divide-y divide-slate-850 shadow-sm max-h-[350px] overflow-y-auto">
                  {orders.slice(0, 10).map((ord) => {
                    const isBuy = ord.side === 'BUY';
                    const dateString = new Date(ord.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div key={ord.id} className="py-3 flex justify-between items-center text-xs">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className={`font-bold uppercase ${isBuy ? 'text-brand-500' : 'text-red-500'}`}>
                              {ord.side}
                            </span>
                            <span className="font-bold text-white font-mono">{ord.tickerId}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{ord.type} &bull; {dateString}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-white font-mono">{ord.quantity} shares</div>
                          <span className={`inline-block mt-1 px-1.5 py-0.5 text-[9px] font-bold rounded ${
                            ord.status === 'FILLED' ? 'bg-brand-500/10 text-brand-500' :
                            ord.status === 'PENDING' ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500'
                          }`}>
                            {ord.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Watchlist Section */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Eye className="text-brand-500 h-5 w-5" /> Watchlist
              </h2>

              {/* Add Watchlist Form */}
              <form onSubmit={handleAddWatchlist} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Ticker (e.g. TSLA)"
                  className="flex-1 bg-slate-950 border border-slate-850 rounded-lg px-3 py-1.5 text-xs text-white uppercase placeholder-slate-650 focus:border-brand-500 outline-none"
                  value={watchlistInput}
                  onChange={(e) => setWatchlistInput(e.target.value)}
                />
                <button
                  type="submit"
                  className="bg-brand-500 hover:bg-brand-600 text-slate-950 px-3.5 py-1.5 rounded-lg text-xs font-semibold"
                >
                  Watch
                </button>
              </form>
              {watchlistError && <p className="text-[10px] text-red-500 mt-1">{watchlistError}</p>}

              {/* Watchlist items */}
              {!watchlistData || watchlistData.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-2">No watchlisted assets.</p>
              ) : (
                <div className="divide-y divide-slate-850">
                  {watchlistData.map((item: any) => (
                    <div key={item.symbol} className="py-2.5 flex justify-between items-center">
                      <div>
                        <Link href={`/stock/${item.symbol}`} className="font-bold text-white font-mono hover:text-brand-500 transition-colors">
                          {item.symbol}
                        </Link>
                        <p className="text-[10px] text-slate-500 mt-0.5">{item.name}</p>
                      </div>
                      <button
                        onClick={() => handleRemoveWatchlist(item.symbol)}
                        className="text-slate-500 hover:text-red-550 p-1 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Price Alerts Section */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Bell className="text-brand-500 h-5 w-5" /> Price Alerts
              </h2>

              {/* Create Alert Form */}
              <form onSubmit={handleCreateAlert} className="space-y-3 bg-slate-950 p-3 border border-slate-850 rounded-xl">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Ticker"
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white uppercase placeholder-slate-500 focus:border-brand-500 outline-none"
                    value={alertSymbol}
                    onChange={(e) => setAlertSymbol(e.target.value)}
                    required
                  />
                  <select
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-350 focus:border-brand-500 outline-none"
                    value={alertCondition}
                    onChange={(e) => setAlertCondition(e.target.value)}
                  >
                    <option value="ABOVE">Above (&ge;)</option>
                    <option value="BELOW">Below (&le;)</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Price ($)"
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-brand-500 outline-none"
                    value={alertValue}
                    onChange={(e) => setAlertValue(e.target.value)}
                    required
                  />
                  <button
                    type="submit"
                    className="bg-brand-500 hover:bg-brand-600 text-slate-950 px-3 py-1.5 rounded-lg text-xs font-semibold"
                  >
                    Set Alert
                  </button>
                </div>
              </form>
              {alertError && <p className="text-[10px] text-red-500 mt-1">{alertError}</p>}

              {/* Price Alerts list */}
              {!alertsData || alertsData.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-2">No active alert triggers.</p>
              ) : (
                <div className="divide-y divide-slate-850 max-h-[250px] overflow-y-auto pr-1">
                  {alertsData.map((alert: any) => (
                    <div key={alert.id} className="py-2.5 flex justify-between items-center text-xs">
                      <div>
                        <span className="font-bold text-white font-mono">{alert.symbol}</span>
                        <span className="mx-1.5 text-slate-500">&bull;</span>
                        <span className={`font-semibold ${alert.isTriggered ? 'text-slate-500 line-through' : 'text-slate-300'}`}>
                          {alert.condition.toLowerCase()} ${alert.value.toFixed(2)}
                        </span>
                        {alert.isTriggered && (
                          <span className="ml-2 px-1.5 py-0.5 text-[9px] font-bold text-brand-500 bg-brand-500/10 rounded">
                            TRIGGERED
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteAlert(alert.id)}
                        className="text-slate-500 hover:text-red-550 p-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
