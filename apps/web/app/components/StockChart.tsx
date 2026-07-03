'use client';

import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, ISeriesApi } from 'lightweight-charts';

interface BarData {
  time: number; // Unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface StockChartProps {
  data: BarData[];
  type?: 'candlestick' | 'line' | 'area';
}

export default function StockChart({ data, type = 'candlestick' }: StockChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return;

    const handleResize = () => {
      chart.applyOptions({ width: chartContainerRef.current!.clientWidth });
    };

    // Initialize Chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#030712' }, // slate-950
        textColor: '#9ca3af', // gray-400
      },
      grid: {
        vertLines: { color: '#1f2937' }, // gray-800
        horzLines: { color: '#1f2937' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });

    let series: ISeriesApi<any>;

    if (type === 'line') {
      series = chart.addLineSeries({
        color: '#22c55e', // Green
        lineWidth: 2,
      });
      series.setData(data.map(d => ({ time: d.time, value: d.close })));
    } else if (type === 'area') {
      series = chart.addAreaSeries({
        topColor: 'rgba(34, 197, 94, 0.4)',
        bottomColor: 'rgba(34, 197, 94, 0.0)',
        lineColor: '#22c55e',
        lineWidth: 2,
      });
      series.setData(data.map(d => ({ time: d.time, value: d.close })));
    } else {
      // Default: Candlestick
      series = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });
      series.setData(data);
    }

    chart.timeScale().fitContent();

    window.addEventListener('resize', handleResize);

    // Clean up
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data, type]);

  return <div ref={chartContainerRef} className="w-full h-[400px] bg-slate-950 rounded-xl overflow-hidden border border-slate-800" />;
}
