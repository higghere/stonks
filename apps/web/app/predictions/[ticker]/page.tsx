'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { 
  ArrowLeft, 
  RotateCw, 
  Sparkles, 
  TrendingUp, 
  TrendingDown, 
  ShieldCheck, 
  Activity, 
  CheckCircle2, 
  XCircle, 
  Cpu, 
  Layers, 
  BarChart3, 
  AlertCircle,
  HelpCircle
} from 'lucide-react';
import { API_URL } from '../../lib/config';

interface PredictionDetail {
  expectedPrice: number;
  expectedReturnPercent: number;
  priceRange: { lower: number; upper: number };
  historicalMaePercent: number;
  percentileDistribution: { p10: number; p25: number; p50: number; p75: number; p90: number };
  scenarios: { bearCase: number; baseCase: number; bullCase: number };
}

interface PredictionPayload {
  ticker: string;
  companyName: string;
  exchange: string;
  sector: string;
  country: string;
  currentClose: number;
  marketContext: { regime: string; volatilityIndex: number };
  clarityMetrics: {
    historicalReliabilityPercent: number;
    currentConfidencePercent: number;
    dataCompletenessPercent: number;
  };
  riskMetrics?: {
    valueAtRisk95Percent: number;
    maxDrawdownPercent: number;
    sharpeRatioProxy: number;
    betaVsMarket: number;
  };
  dataCompletenessChecklist: { name: string; available: boolean }[];
  predictions: {
    "5d": PredictionDetail;
    "30d": PredictionDetail;
    "90d": PredictionDetail;
  };
  featureImportancePercent: Record<string, number>;
  weightedDrivers: {
    positive: { impact: string; description: string }[];
    negative: { impact: string; description: string }[];
  };
  predictionMetadata: {
    predictionId: string;
    modelVersion: string;
    featureVersion: string;
    trainingDataset: string;
    predictionLatencyMs: number;
    generatedAt: string;
    marketTimestamp: string;
  };
}

export default function StockPredictionDetailPage({ params }: { params: any }) {
  const unwrappedParams = typeof params?.then === 'function' ? use(params) : params;
  const ticker = (unwrappedParams?.ticker || 'AAPL').toUpperCase();

  const [data, setData] = useState<PredictionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeHorizon, setActiveHorizon] = useState<'5d' | '30d' | '90d'>('90d');

  const fetchPrediction = async (force: boolean = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const url = `${API_URL}/api/v1/predictions/${encodeURIComponent(ticker)}${force ? '?force=true' : ''}`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.success && json.data) {
        setData(json.data);
      } else {
        setError(json.error || `Unable to generate prediction for ${ticker}.`);
      }
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPrediction();
  }, [ticker]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-12">
        <div className="max-w-6xl mx-auto space-y-8 animate-pulse">
          <div className="h-6 w-32 bg-slate-800 rounded" />
          <div className="h-24 bg-slate-900/80 rounded-2xl border border-slate-800" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="h-32 bg-slate-900/60 rounded-2xl border border-slate-800" />
            <div className="h-32 bg-slate-900/60 rounded-2xl border border-slate-800" />
            <div className="h-32 bg-slate-900/60 rounded-2xl border border-slate-800" />
          </div>
          <div className="h-64 bg-slate-900/60 rounded-2xl border border-slate-800" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-12 flex flex-col items-center justify-center">
        <div className="max-w-md w-full bg-slate-900/80 border border-slate-800 p-8 rounded-2xl text-center space-y-6">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
          <div>
            <h3 className="text-xl font-bold text-white">Prediction Error</h3>
            <p className="text-sm text-slate-400 mt-2">{error || "Failed to load prediction forecast."}</p>
          </div>
          <div className="flex gap-3">
            <Link href="/predictions" className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-semibold text-slate-200 transition-colors">
              Back to Explorer
            </Link>
            <button onClick={() => fetchPrediction(true)} className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 rounded-xl text-xs font-bold text-slate-950 transition-colors">
              Retry Inference
            </button>
          </div>
        </div>
      </div>
    );
  }

  const pred = data.predictions[activeHorizon];
  const isPositive = pred.expectedReturnPercent >= 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-12">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Navigation & Header Controls */}
        <div className="flex items-center justify-between">
          <Link href="/predictions" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Explorer Directory</span>
          </Link>

          <button
            onClick={() => fetchPrediction(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-semibold text-emerald-400 disabled:opacity-50 transition-colors"
          >
            <RotateCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Running Inference...' : 'Refresh Prediction'}</span>
          </button>
        </div>

        {/* Hero Stock Header */}
        <div className="bg-slate-900/80 border border-slate-800 p-6 md:p-8 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl md:text-4xl font-black text-white tracking-wider">{data.ticker}</h1>
              <span className="text-xs font-bold px-2.5 py-1 rounded bg-slate-800 text-slate-300">
                {data.exchange}
              </span>
              <span className="text-xs font-bold px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Regime: {data.marketContext.regime}
              </span>
            </div>
            <p className="text-base text-slate-300 font-medium">{data.companyName}</p>
            <p className="text-xs text-slate-500 mt-1">{data.sector} • {data.country}</p>
          </div>

          <div className="text-left md:text-right border-t md:border-t-0 pt-4 md:pt-0 border-slate-800">
            <div className="text-xs text-slate-500 font-medium">Live Market Close</div>
            <div className="text-3xl font-black text-white mt-1">${data.currentClose.toFixed(2)}</div>
          </div>
        </div>

        {/* Clarity Metric Triad */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-400">Historical Reliability</span>
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-white">{data.clarityMetrics.historicalReliabilityPercent}%</div>
            <p className="text-xs text-slate-500 mt-1">Evaluated on historical directional accuracy</p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-400">Current Confidence</span>
              <Activity className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-2xl font-black text-white">{data.clarityMetrics.currentConfidencePercent}%</div>
            <p className="text-xs text-slate-500 mt-1">Multi-signal model state certainty</p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-400">Data Completeness</span>
              <Layers className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-black text-white">{data.clarityMetrics.dataCompletenessPercent}%</div>
            <p className="text-xs text-slate-500 mt-1">Feature template input availability ratio</p>
          </div>
        </div>

        {/* Risk Engine Analytics Grid */}
        {data.riskMetrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl">
              <div className="text-[11px] text-slate-500 font-medium">Value-at-Risk (95% 1-Day)</div>
              <div className="text-lg font-bold text-rose-400 mt-1">-{data.riskMetrics.valueAtRisk95Percent}%</div>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl">
              <div className="text-[11px] text-slate-500 font-medium">Max Historical Drawdown</div>
              <div className="text-lg font-bold text-amber-400 mt-1">-{data.riskMetrics.maxDrawdownPercent}%</div>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl">
              <div className="text-[11px] text-slate-500 font-medium">Sharpe Ratio Proxy</div>
              <div className="text-lg font-bold text-emerald-400 mt-1">{data.riskMetrics.sharpeRatioProxy}</div>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl">
              <div className="text-[11px] text-slate-500 font-medium">Market Beta</div>
              <div className="text-lg font-bold text-cyan-400 mt-1">{data.riskMetrics.betaVsMarket}x</div>
            </div>
          </div>
        )}

        {/* Forecast Horizon Tabs & Outlook Card */}
        <div className="bg-slate-900/80 border border-slate-800 p-6 md:p-8 rounded-3xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-400" />
              <span>Institutional Price Outlook</span>
            </h2>

            {/* Horizon Selector */}
            <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
              {(['5d', '30d', '90d'] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setActiveHorizon(h)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    activeHorizon === h
                      ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {h.toUpperCase()} Horizon
                </button>
              ))}
            </div>
          </div>

          {/* Main Forecast Hero Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-slate-950/60 p-6 rounded-2xl border border-slate-800/80 space-y-2">
              <div className="text-xs font-medium text-slate-400">Expected Price Target</div>
              <div className="text-3xl font-black text-white">${pred.expectedPrice.toFixed(2)}</div>
              <div className={`text-xs font-bold flex items-center gap-1 ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                <span>{isPositive ? '+' : ''}{pred.expectedReturnPercent}% Return</span>
              </div>
            </div>

            <div className="bg-slate-950/60 p-6 rounded-2xl border border-slate-800/80 space-y-2">
              <div className="text-xs font-medium text-slate-400">Likely Range (Empirical MAE)</div>
              <div className="text-xl font-bold text-slate-200">${pred.priceRange.lower.toFixed(2)} – ${pred.priceRange.upper.toFixed(2)}</div>
              <div className="text-xs text-slate-500">Historical MAE: ±{pred.historicalMaePercent}%</div>
            </div>

            <div className="bg-slate-950/60 p-6 rounded-2xl border border-slate-800/80 space-y-2">
              <div className="text-xs font-medium text-slate-400">Bull Case Scenario (P90)</div>
              <div className="text-xl font-bold text-emerald-400">${pred.scenarios.bullCase.toFixed(2)}</div>
              <div className="text-xs text-slate-500">90th Percentile Upside</div>
            </div>

            <div className="bg-slate-950/60 p-6 rounded-2xl border border-slate-800/80 space-y-2">
              <div className="text-xs font-medium text-slate-400">Bear Case Scenario (P10)</div>
              <div className="text-xl font-bold text-rose-400">${pred.scenarios.bearCase.toFixed(2)}</div>
              <div className="text-xs text-slate-500">10th Percentile Downside</div>
            </div>
          </div>
        </div>

        {/* Feature Availability & Drivers Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Itemized Feature Audit Checklist */}
          <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Feature Availability Audit</span>
            </h3>
            <div className="space-y-2.5">
              {data.dataCompletenessChecklist.map((item) => (
                <div key={item.name} className="flex items-center justify-between text-xs py-2 px-3 bg-slate-950/60 rounded-xl border border-slate-800/60">
                  <span className="text-slate-300 font-medium">{item.name}</span>
                  {item.available ? (
                    <span className="inline-flex items-center gap-1 font-bold text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Available</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-500">
                      <XCircle className="w-3.5 h-3.5 text-slate-600" />
                      <span>Padded</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Explainable Weighted Drivers */}
          <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-2xl space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-cyan-400" />
              <span>Explainable Model Drivers</span>
            </h3>
            <div className="space-y-3">
              <div>
                <div className="text-xs font-bold text-emerald-400 mb-2">Positive Drivers</div>
                {data.weightedDrivers.positive.map((d, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1.5 text-slate-300">
                    <span>{d.description}</span>
                    <span className="font-mono font-bold text-emerald-400">{d.impact}</span>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-slate-800/80">
                <div className="text-xs font-bold text-rose-400 mb-2">Negative Drivers</div>
                {data.weightedDrivers.negative.map((d, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1.5 text-slate-300">
                    <span>{d.description}</span>
                    <span className="font-mono font-bold text-rose-400">{d.impact}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>

        {/* Prediction Provenance & Metadata Footer */}
        <div className="bg-slate-900/40 border border-slate-800/60 p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            <div className="font-mono text-slate-400 font-semibold">{data.predictionMetadata.predictionId}</div>
            <div className="mt-1">Model: {data.predictionMetadata.modelVersion} • Dataset: {data.predictionMetadata.trainingDataset}</div>
          </div>

          <div className="text-left md:text-right">
            <div>Latency: {data.predictionMetadata.predictionLatencyMs}ms</div>
            <div className="mt-1">Generated: {data.predictionMetadata.generatedAt}</div>
          </div>
        </div>

      </div>
    </div>
  );
}
