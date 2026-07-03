'use client';

import React, { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

interface HistoryPoint {
  date: string;
  totalValue: number;
  cash: number;
}

interface PortfolioChartProps {
  data: HistoryPoint[];
}

export default function PortfolioChart({ data }: PortfolioChartProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl h-80 flex items-center justify-center">
        <div className="animate-pulse text-slate-500 text-sm">Rendering performance chart...</div>
      </div>
    );
  }

  // Format Y Axis amounts to human-readable strings (e.g. $100K)
  const formatYAxis = (val: number) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
    return `$${val}`;
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const dataPoint = payload[0].payload as HistoryPoint;
      return (
        <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl shadow-2xl space-y-1.5 font-mono text-xs">
          <p className="text-slate-400 font-semibold">{dataPoint.date}</p>
          <div className="h-px bg-slate-850 my-1" />
          <p className="text-brand-500 flex justify-between gap-4 font-bold">
            <span>Net Asset Value:</span>
            <span>${dataPoint.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </p>
          <p className="text-emerald-500 flex justify-between gap-4">
            <span>Cash Reserves:</span>
            <span>${dataPoint.cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
      <div>
        <h3 className="text-lg font-bold text-white">Net Worth Performance</h3>
        <p className="text-xs text-slate-500">Visual performance chart of your cumulative cash and asset valuations.</p>
      </div>

      <div className="h-72 w-full pr-2">
        {/* @ts-ignore */}
        <ResponsiveContainer width="100%" height="100%">
          {/* @ts-ignore */}
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorValuation" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
              </linearGradient>
            </defs>

            {/* @ts-ignore */}
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
            
            {/* @ts-ignore */}
            <XAxis 
              dataKey="date" 
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }}
              dy={10}
            />
            
            {/* @ts-ignore */}
            <YAxis 
              tickFormatter={formatYAxis}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }}
              domain={['auto', 'auto']}
              dx={-10}
            />
            
            {/* @ts-ignore */}
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#334155', strokeWidth: 1 }} />
            
            {/* @ts-ignore */}
            <Area 
              type="monotone" 
              dataKey="totalValue" 
              stroke="#10b981" 
              strokeWidth={2.5}
              fillOpacity={1} 
              fill="url(#colorValuation)" 
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
