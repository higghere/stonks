'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../../store/authStore';
import StockChart from '../../components/StockChart';
import Link from 'next/link';
import { API_URL, WS_URL } from '../../lib/config';

interface OrderPayload {
  tickerId: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP';
  quantity: number;
  price?: number;
  stopPrice?: number;
}

export default function StockPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const ticker = (params.ticker as string).toUpperCase();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  // Form states
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [type, setType] = useState<'MARKET' | 'LIMIT' | 'STOP'>('MARKET');
  const [quantity, setQuantity] = useState<number>(1);
  const [limitPrice, setLimitPrice] = useState<number>(0);
  const [stopPrice, setStopPrice] = useState<number>(0);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<boolean>(false);

  // Time boundaries for historical bars (90 days)
  const to = Math.floor(Date.now() / 1000);
  const from = to - 90 * 24 * 60 * 60;

  // 1. Fetch Ticker info (quote, profile, session)
  const { data: stockData, isLoading: infoLoading, error: infoError } = useQuery({
    queryKey: ['stock', ticker],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/v1/market/stock/${ticker}`);
      if (!response.ok) throw new Error('Stock ticker not found');
      const json = await response.json();
      return json.data;
    },
    refetchInterval: 10000, // Fallback query poll every 10s
  });

  // 2. Fetch Ticker History
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['history', ticker],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/v1/market/history/${ticker}?resolution=1d&from=${from}&to=${to}`);
      if (!response.ok) throw new Error('Failed to fetch history');
      const json = await response.json();
      return json.history;
    },
  });

  // Synchronize input fields with current price when data loads
  useEffect(() => {
    if (stockData?.quote?.price) {
      setLimitPrice(stockData.quote.price);
      setStopPrice(stockData.quote.price);
    }
  }, [stockData]);

  // 3. Connect Socket.io room for live price ticks
  useEffect(() => {
    const socket: Socket = io(WS_URL);
    
    socket.emit('subscribe', `ticker:${ticker}`);

    socket.on('quote', (data: any) => {
      if (data.ticker === ticker) {
        // Optimistically update quote details in query cache
        queryClient.setQueryData(['stock', ticker], (oldData: any) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            quote: {
              ...oldData.quote,
              price: data.price,
              change: data.change,
              changePercent: data.changePercent,
              high: data.high,
              low: data.low,
              timestamp: data.timestamp,
            },
          };
        });
      }
    });

    return () => {
      socket.emit('unsubscribe', `ticker:${ticker}`);
      socket.disconnect();
    };
  }, [ticker, queryClient]);

  // 4. Place Order Mutation
  const orderMutation = useMutation({
    mutationFn: async (payload: OrderPayload) => {
      if (!token) throw new Error('You must be signed in to trade.');
      
      const idempotencyKey = `order-${ticker}-${side}-${type}-${Date.now()}`;

      const response = await fetch(`${API_URL}/api/v1/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.message || 'Order execution rejected.');
      }
      return json;
    },
    onSuccess: () => {
      setOrderSuccess(true);
      setOrderError(null);
      queryClient.invalidateQueries({ queryKey: ['stock', ticker] });
    },
    onError: (err: any) => {
      setOrderError(err.message);
      setOrderSuccess(false);
    },
  });

  const handlePlaceOrder = (e: React.FormEvent) => {
    e.preventDefault();
    setOrderError(null);
    setOrderSuccess(false);

    const payload: OrderPayload = {
      tickerId: ticker,
      side,
      type,
      quantity,
    };

    if (type === 'LIMIT') payload.price = limitPrice;
    if (type === 'STOP') payload.stopPrice = stopPrice;

    orderMutation.mutate(payload);
  };

  if (infoLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-brand-500"></div>
      </div>
    );
  }

  if (infoError || !stockData) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-white gap-4">
        <h1 className="text-2xl font-bold">Ticker {ticker} not found</h1>
        <Link href="/dashboard" className="text-brand-500 hover:underline">Back to Dashboard</Link>
      </div>
    );
  }

  const { quote, profile, session } = stockData;
  const isUp = quote.change >= 0;

  return (
    <div className="min-h-screen bg-slate-950 pb-20 text-slate-100">


      {/* Main Stock layout Grid */}
      <div className="max-w-7xl mx-auto px-6 mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Columns (Details and Chart) */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Stock Header information */}
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-4xl font-extrabold tracking-tight text-white font-outfit">{profile.name}</h1>
              </div>
              <p className="text-slate-500 mt-1 text-sm">{profile.sector} &bull; {profile.industry}</p>
            </div>
            <div className="text-right">
              <div className="text-4xl font-bold tracking-tight text-white font-mono">${quote.price.toFixed(2)}</div>
              <div className={`mt-1 font-semibold font-mono text-sm ${isUp ? 'text-brand-500' : 'text-red-500'}`}>
                {isUp ? '+' : ''}{quote.change.toFixed(2)} ({isUp ? '+' : ''}{quote.changePercent.toFixed(2)}%)
              </div>
            </div>
          </div>

          {/* Interactive Chart */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-300">Live Price Feed</h2>
              <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${session.isOpen ? 'bg-brand-500/10 text-brand-500 border border-brand-500/20' : 'bg-slate-900 text-slate-500 border border-slate-800'}`}>
                {session.isOpen ? '● MARKET OPEN' : '● MARKET CLOSED'}
              </span>
            </div>
            {historyLoading ? (
              <div className="w-full h-[400px] bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-brand-500"></div>
              </div>
            ) : (
              <StockChart data={historyData || []} />
            )}
          </div>

          {/* Company Profile Description */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
            <h3 className="text-lg font-bold text-white font-outfit mb-3">About the Company</h3>
            <p className="text-sm text-slate-400 leading-relaxed">{profile.description}</p>
          </div>

          {/* Core Key Statistics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Market Cap', value: `$${(profile.marketCap / 1e9).toFixed(1)}B` },
              { label: 'P/E Ratio', value: profile.peRatio.toFixed(1) },
              { label: 'EPS', value: `$${profile.eps.toFixed(2)}` },
              { label: 'Dividend Yield', value: `${profile.dividendYield.toFixed(2)}%` },
              { label: 'Beta', value: profile.beta.toFixed(2) },
              { label: '52 Wk High', value: `$${profile.high52Week.toFixed(2)}` },
              { label: '52 Wk Low', value: `$${profile.low52Week.toFixed(2)}` },
              { label: 'Currency', value: profile.currency },
            ].map((stat, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <div className="text-xs text-slate-500 font-medium">{stat.label}</div>
                <div className="text-base font-bold text-white font-mono mt-1">{stat.value}</div>
              </div>
            ))}
          </div>

        </div>

        {/* Right Column (Trading Form Console) */}
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl sticky top-24">
            <h3 className="text-xl font-bold text-white font-outfit mb-6">Place Trade Order</h3>
            
            {/* Side Tabs */}
            <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1.5 rounded-lg border border-slate-800">
              <button
                onClick={() => setSide('BUY')}
                className={`py-2 text-sm font-semibold rounded-md transition-colors ${side === 'BUY' ? 'bg-brand-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
              >
                Buy
              </button>
              <button
                onClick={() => setSide('SELL')}
                className={`py-2 text-sm font-semibold rounded-md transition-colors ${side === 'SELL' ? 'bg-red-500 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Sell
              </button>
            </div>

            {/* Type tabs */}
            <div className="flex gap-4 mt-6 text-sm font-medium border-b border-slate-800 pb-2">
              {['MARKET', 'LIMIT', 'STOP'].map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t as any)}
                  className={`pb-2 border-b-2 transition-colors ${type === t ? 'border-brand-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Order Feedback Messages */}
            {orderSuccess && (
              <div className="mt-6 rounded-lg bg-brand-500/10 border border-brand-500/20 p-4 text-sm text-brand-500">
                Order submitted and executed successfully!
              </div>
            )}
            {orderError && (
              <div className="mt-6 rounded-lg bg-red-950 border border-red-850 p-4 text-sm text-red-400">
                {orderError}
              </div>
            )}

            <form onSubmit={handlePlaceOrder} className="mt-6 space-y-4">
              
              {/* Quantity */}
              <div>
                <label className="text-xs text-slate-500 font-semibold block mb-1">Shares Quantity</label>
                <input
                  type="number"
                  step="any"
                  required
                  min="0.0001"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white font-mono focus:border-brand-500 focus:outline-none"
                  value={quantity}
                  onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                />
              </div>

              {/* Conditional limit price */}
              {type === 'LIMIT' && (
                <div>
                  <label className="text-xs text-slate-500 font-semibold block mb-1">Limit Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white font-mono focus:border-brand-500 focus:outline-none"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(parseFloat(e.target.value) || 0)}
                  />
                </div>
              )}

              {/* Conditional stop price */}
              {type === 'STOP' && (
                <div>
                  <label className="text-xs text-slate-500 font-semibold block mb-1">Stop Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white font-mono focus:border-brand-500 focus:outline-none"
                    value={stopPrice}
                    onChange={(e) => setStopPrice(parseFloat(e.target.value) || 0)}
                  />
                </div>
              )}

              {/* Estimate Calculation */}
              <div className="pt-4 border-t border-slate-800 flex justify-between items-center text-sm font-medium">
                <span className="text-slate-500">Estimated Total Value</span>
                <span className="text-white font-mono">
                  ${((type === 'LIMIT' ? limitPrice : quote.price) * quantity).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={orderMutation.isPending || !user}
                className={`w-full py-3.5 rounded-lg text-sm font-bold transition-colors mt-6 ${!user ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : side === 'BUY' ? 'bg-brand-500 text-slate-950 hover:bg-brand-600' : 'bg-red-500 text-white hover:bg-red-600'} disabled:opacity-50`}
              >
                {!user 
                  ? 'Sign In to Trade' 
                  : orderMutation.isPending 
                    ? 'Executing Transaction...' 
                    : side === 'BUY' 
                      ? 'Submit Buy Order' 
                      : 'Submit Sell Order'
                }
              </button>

            </form>
          </div>
        </div>

      </div>
    </div>
  );
}
