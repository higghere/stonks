'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../store/authStore';
import { API_URL } from '../lib/config';
import { 
  Play, 
  RotateCw, 
  TrendingUp, 
  AlertTriangle, 
  Info, 
  BookOpen, 
  Sliders, 
  FileText,
  Activity,
  ArrowRight,
  TrendingDown
} from 'lucide-react';
import Link from 'next/link';

interface SimSave {
  id: string;
  name: string;
  tickNumber: number;
  difficulty: string;
  seed: string;
  divergenceScore: number;
  worldState: any;
  createdAt: string;
}

export default function SimulationPage() {
  const router = useRouter();
  const { token, setSimulation } = useAuthStore();
  const [saves, setSaves] = useState<SimSave[]>([]);
  const [activeSave, setActiveSave] = useState<SimSave | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Creation state
  const [name, setName] = useState('');
  const [difficulty, setDifficulty] = useState('NORMAL');
  const [seed, setSeed] = useState('');

  // Selected company for report modal
  const [selectedReportCompany, setSelectedReportCompany] = useState<any | null>(null);
  const [reportYear, setReportYear] = useState(2027);

  // Fetch saves
  const fetchSaves = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/simulation`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setSaves(data.saves);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!token) {
      router.push('/login');
      return;
    }
    fetchSaves();
  }, [token]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/simulation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, difficulty, seed }),
      });
      const data = await res.json();
      if (data.success) {
        setName('');
        fetchSaves();
        setActiveSave(data.simulation);
        setSimulation(data.simulation.id, data.simulation.name);
        router.push('/dashboard');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleTick = async () => {
    if (!activeSave) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/simulation/${activeSave.id}/tick`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setActiveSave(data.simulation);
        // Refresh saves list
        fetchSaves();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadSave = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/simulation/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setActiveSave(data.simulation);
        setSimulation(data.simulation.id, data.simulation.name);
        router.push('/dashboard');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Parse worldState
  const world = activeSave?.worldState ? (
    typeof activeSave.worldState === 'string' 
      ? JSON.parse(activeSave.worldState) 
      : activeSave.worldState
  ) : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      {/* Navigation */}
      <div className="flex justify-between items-center mb-8 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-500 bg-clip-text text-transparent">
            Alternate Reality Simulation
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Build your corporate empire in a decoupled economy driven by player decisions.
          </p>
        </div>
        <Link href="/dashboard" className="text-sm bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg transition">
          Back to Trading Dashboard
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left column: Saves and Create */}
        <div className="lg:col-span-4 space-y-6">
          {/* Create Save Card */}
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-850 p-6 rounded-2xl">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-emerald-400">
              <Sliders size={20} /> New Simulation
            </h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">Save Name</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  placeholder="e.g. Nokia Revival"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-slate-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">Difficulty</label>
                  <select 
                    value={difficulty} 
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-slate-100"
                  >
                    <option value="EASY">Easy</option>
                    <option value="NORMAL">Normal</option>
                    <option value="HARD">Hard</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">Custom Seed</label>
                  <input 
                    type="text" 
                    value={seed} 
                    onChange={(e) => setSeed(e.target.value)} 
                    placeholder="Random"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-slate-100"
                  />
                </div>
              </div>
              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold py-2 rounded-lg transition duration-200 text-sm"
              >
                Create Universe
              </button>
            </form>
          </div>

          {/* Saves list */}
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-850 p-6 rounded-2xl">
            <h2 className="text-xl font-semibold mb-4">Saved Universes</h2>
            {saves.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No universes created yet.</p>
            ) : (
              <div className="space-y-3">
                {saves.map((s) => (
                  <div 
                    key={s.id} 
                    onClick={() => loadSave(s.id)}
                    className={`p-4 rounded-xl border cursor-pointer transition ${
                      activeSave?.id === s.id 
                        ? 'bg-emerald-550/20 border-emerald-500' 
                        : 'bg-slate-950 border-slate-850 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-sm">{s.name}</span>
                      <span className="text-xs bg-slate-850 px-2 py-0.5 rounded text-slate-400 uppercase">{s.difficulty}</span>
                    </div>
                    <div className="flex justify-between items-center mt-2 text-xs text-slate-400">
                      <span>Day Tick: {s.tickNumber}</span>
                      <span>Divergence: {parseFloat(s.divergenceScore.toString()).toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column: Simulation Details Dashboard */}
        <div className="lg:col-span-8 space-y-6">
          {activeSave && world ? (
            <>
              {/* Header Status Dashboard */}
              <div className="bg-gradient-to-r from-slate-900 to-slate-850 border border-slate-800 p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <h2 className="text-2xl font-bold">{activeSave.name}</h2>
                  <div className="flex items-center gap-4 mt-2 text-sm text-slate-400">
                    <span>Active Cycle Tick: <strong className="text-emerald-400">{activeSave.tickNumber}</strong></span>
                    <span>•</span>
                    <span>Seed: <strong className="text-cyan-400">{activeSave.seed}</strong></span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-xs block text-slate-400 uppercase font-semibold">Divergence Score</span>
                    <div className="w-40 bg-slate-850 h-3 rounded-full overflow-hidden mt-1 relative">
                      <div 
                        className="bg-gradient-to-r from-emerald-400 to-rose-500 h-full"
                        style={{ width: `${activeSave.divergenceScore}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold text-slate-300 mt-1 block">
                      {parseFloat(activeSave.divergenceScore.toString()).toFixed(1)}% split from real timeline
                    </span>
                  </div>

                  <button 
                    onClick={handleTick}
                    disabled={loading}
                    className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-6 py-3 rounded-xl font-bold transition shadow-lg shadow-emerald-500/10"
                  >
                    <RotateCw size={18} className={loading ? 'animate-spin' : ''} /> Run Tick
                  </button>
                </div>
              </div>

              {/* Tickers list */}
              <div className="bg-slate-900/60 border border-slate-850 p-6 rounded-2xl">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Activity size={18} className="text-cyan-400" /> Simulated Corporations
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.values(world.companies).map((c: any) => (
                    <div key={c.tickerId} className="bg-slate-950 border border-slate-850 p-5 rounded-xl space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-bold text-lg text-emerald-400">{c.tickerId}</h4>
                          <span className="text-xs bg-slate-900 px-2 py-0.5 rounded text-slate-400 font-semibold uppercase">
                            {c.lifecycle}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-2xl font-black">${parseFloat(c.stockPrice).toFixed(2)}</span>
                          <span className="block text-xs text-slate-500">Stock Price</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-sm border-t border-b border-slate-900 py-3">
                        <div>
                          <span className="text-xs text-slate-500 block">Cash Reserve</span>
                          <span className="font-semibold">${(c.cash / 1000000).toFixed(1)}M</span>
                        </div>
                        <div>
                          <span className="text-xs text-slate-500 block">Total Debt</span>
                          <span className="font-semibold">${(c.debt / 1000000).toFixed(1)}M</span>
                        </div>
                        <div>
                          <span className="text-xs text-slate-500 block">Brand Equity</span>
                          <span className="font-semibold">{c.brandEquity.toFixed(0)} pts</span>
                        </div>
                        <div>
                          <span className="text-xs text-slate-500 block">Tech Index</span>
                          <span className="font-semibold">{c.technologyIndex.toFixed(0)}</span>
                        </div>
                      </div>

                      {/* Dynamic why-card details */}
                      <div className="bg-slate-900/60 p-3 rounded-lg text-xs space-y-2 border border-slate-850">
                        <span className="font-bold text-slate-300 flex items-center gap-1">
                          <Info size={14} className="text-cyan-400" /> Explainability Valuation path:
                        </span>
                        <div className="space-y-1 text-slate-400">
                          <div>• Tech index +{c.technologyIndex.toFixed(0)} improves base DCF margins</div>
                          <div>• Cash reserve at ${(c.cash / 1000000).toFixed(1)}M offsets credit leverage default rates</div>
                          <div>• Market psychology index (greed: {world.economy.fearGreedIndex}) expands PE multiplier</div>
                        </div>
                      </div>

                      <button 
                        onClick={() => setSelectedReportCompany(c)}
                        className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-slate-300 py-2 rounded-lg text-xs font-semibold transition"
                      >
                        <FileText size={14} /> View Annual Report
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Economic indicators */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Global Economy */}
                <div className="bg-slate-900/60 border border-slate-850 p-6 rounded-2xl">
                  <h3 className="text-lg font-bold mb-4">Macro Resource Indexes</h3>
                  <div className="space-y-4">
                    {Object.values(world.resources.nodes).map((res: any) => (
                      <div key={res.name} className="flex justify-between items-center border-b border-slate-850 pb-2 text-sm">
                        <span className="text-slate-400">{res.name}</span>
                        <span className="font-bold text-emerald-400">${res.price.toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center text-sm pt-2">
                      <span className="text-slate-400">Fear & Greed index</span>
                      <span className="font-bold text-yellow-400">{world.economy.fearGreedIndex} / 100</span>
                    </div>
                  </div>
                </div>

                {/* Country profiles */}
                <div className="bg-slate-900/60 border border-slate-850 p-6 rounded-2xl">
                  <h3 className="text-lg font-bold mb-4">Country GDP Growth</h3>
                  <div className="space-y-4">
                    {Object.values(world.countries).map((country: any) => (
                      <div key={country.code} className="flex justify-between items-center border-b border-slate-850 pb-2 text-sm">
                        <span className="text-slate-400">{country.code} GDP</span>
                        <span className="font-bold">${(country.gdp / 1000000000000).toFixed(2)} Trillion</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Timeline logger */}
              <div className="bg-slate-900/60 border border-slate-850 p-6 rounded-2xl">
                <h3 className="text-lg font-bold mb-4">Divergence Timeline logs</h3>
                <div className="space-y-3 max-h-40 overflow-y-auto pr-2">
                  {world.divergenceTree.map((event: string, idx: number) => (
                    <div key={idx} className="bg-slate-950 border border-slate-900 p-3 rounded-lg text-xs text-slate-300">
                      {event}
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-slate-900/60 border border-slate-850 p-12 rounded-2xl text-center space-y-4">
              <AlertTriangle className="mx-auto text-yellow-500" size={48} />
              <h2 className="text-2xl font-bold">No Active Universe Loaded</h2>
              <p className="text-slate-400 max-w-md mx-auto text-sm">
                Create a new simulation save on the left panel or select an existing one to initialize the Alternate Reality economic sandbox.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Annual Report Overlay Modal */}
      {selectedReportCompany && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-8 max-h-[85vh] overflow-y-auto relative space-y-6">
            <button 
              onClick={() => setSelectedReportCompany(null)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-200 transition"
            >
              ✕ Close
            </button>

            <div>
              <span className="text-xs bg-emerald-500/20 text-emerald-400 font-bold px-3 py-1 rounded-full uppercase">
                Annual Shareholder Report
              </span>
              <h3 className="text-2xl font-bold mt-2">{selectedReportCompany.tickerId}</h3>
              <p className="text-xs text-slate-400 mt-1">Fiscal Year {reportYear} • Generated from active simulation logs</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-850">
                <span className="text-xs text-slate-500 block">Total Revenue</span>
                <span className="text-lg font-bold">${(selectedReportCompany.cashFlow * 2.5 / 1000000).toFixed(1)}M</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-850">
                <span className="text-xs text-slate-500 block">Cash Reserve</span>
                <span className="text-lg font-bold">${(selectedReportCompany.cash / 1000000).toFixed(1)}M</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-850">
                <span className="text-xs text-slate-500 block">Total Debt</span>
                <span className="text-lg font-bold">${(selectedReportCompany.debt / 1000000).toFixed(1)}M</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-850">
                <span className="text-xs text-slate-500 block">Factories</span>
                <span className="text-lg font-bold">{selectedReportCompany.factories.length}</span>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-300">Letter to Shareholders from the CEO</h4>
              <div className="bg-slate-950 p-5 rounded-xl border border-slate-850 text-xs text-slate-400 leading-relaxed whitespace-pre-line">
                {`Dear Shareholders,\n\nThis fiscal year has been marked by strong execution and financial growth. Our net cash flow reached $${(selectedReportCompany.cashFlow / 1000000).toFixed(2)}M, reflecting robust demand for our core product offerings. We continue to invest in R&D ($${(selectedReportCompany.rdInvestment / 1000000).toFixed(2)}M) to protect our tech advantage.\n\nWe are extremely grateful to our engineering and design teams for their dedication. Our brand reputation index remains strong at ${(selectedReportCompany.reputation.innovation).toFixed(0)} points in innovation. Thank you for your continued partnership.\n\nSincerely,\nCEO of ${selectedReportCompany.tickerId}`}
              </div>
            </div>

            <div className="flex justify-end gap-4">
              <button 
                onClick={() => setSelectedReportCompany(null)}
                className="bg-slate-800 hover:bg-slate-700 px-6 py-2 rounded-xl text-sm font-semibold transition"
              >
                Back to dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
