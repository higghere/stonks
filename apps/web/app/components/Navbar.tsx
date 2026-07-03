'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../store/authStore';
import { TrendingUp, LogOut, LogIn, UserPlus, Menu, X } from 'lucide-react';

const NAV_ITEMS = [
  { path: '/', label: 'Home' },
  { path: '/dashboard', label: 'Dashboard', requireAuth: true },
  { path: '/stocks', label: 'All Stocks' },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { token, user, logout } = useAuthStore();
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Hide global navbar on login/register screens for clean authentication visuals
  const isAuthPage = pathname === '/login' || pathname === '/register';
  if (isAuthPage) return null;

  return (
    <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 w-full">
      <div className="max-w-7xl mx-auto px-6 py-3.5 flex justify-between items-center">
        
        {/* Brand Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="bg-brand-500/10 p-2 rounded-xl border border-brand-500/25 group-hover:border-brand-500/50 transition-colors">
            <TrendingUp className="text-brand-500 h-5 w-5" />
          </div>
          <span className="font-extrabold text-lg text-white font-outfit tracking-wide group-hover:text-slate-200 transition-colors">
            Antigravity
          </span>
        </Link>

        {/* Sliding Pill Navigation Container (Desktop) */}
        <nav className="hidden md:flex items-center gap-1.5 bg-slate-900/60 border border-slate-850 px-2 py-1.5 rounded-full relative">
          {NAV_ITEMS.map((item) => {
            // Check if user has access to private route
            if (item.requireAuth && (!mounted || !token)) return null;

            const isActive = pathname === item.path;

            return (
              <Link
                key={item.path}
                href={item.path}
                onMouseEnter={() => setHoveredPath(item.path)}
                onMouseLeave={() => setHoveredPath(null)}
                className="relative px-4 py-2 text-sm font-semibold rounded-full transition-colors z-10"
                style={{
                  color: isActive ? '#030712' : '#9ca3af', // slate-950 vs gray-400
                }}
              >
                {/* Active Slider (layoutId handles smooth morph sliding animation between tabs) */}
                {isActive && (
                  <motion.div
                    layoutId="activePill"
                    className="absolute inset-0 bg-brand-500 rounded-full -z-10"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}

                {/* Hover Slider track */}
                {hoveredPath === item.path && !isActive && (
                  <motion.div
                    layoutId="hoverPill"
                    className="absolute inset-0 bg-slate-800/60 rounded-full -z-10"
                    transition={{ type: 'spring', stiffness: 350, damping: 35 }}
                  />
                )}
                
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User Session Actions */}
        <div className="hidden md:flex items-center gap-4">
          {mounted && user ? (
            <div className="flex items-center gap-4">
              <span className="text-xs text-slate-400 font-mono bg-slate-900 border border-slate-850 px-2.5 py-1 rounded-md">
                {user.name}
              </span>
              <button
                onClick={() => {
                  logout();
                  router.push('/');
                }}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-slate-900/50 hover:bg-slate-900 border border-slate-850 px-3.5 py-2 rounded-xl transition-all"
              >
                <LogOut className="h-3.5 w-3.5" /> Sign Out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
              >
                <LogIn className="h-3.5 w-3.5" /> Sign In
              </Link>
              <Link
                href="/register"
                className="flex items-center gap-1.5 text-xs font-semibold bg-brand-500 text-slate-950 hover:bg-brand-600 px-4 py-2 rounded-xl transition-all"
              >
                <UserPlus className="h-3.5 w-3.5" /> Sign Up
              </Link>
            </div>
          )}
        </div>

        {/* Mobile menu trigger */}
        <button 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 rounded-xl bg-slate-900 border border-slate-850 text-slate-400 hover:text-white transition-colors"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

      </div>

      {/* Mobile Drawer menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-slate-900 bg-slate-950 px-6 py-4 space-y-4 overflow-hidden"
          >
            <div className="flex flex-col gap-2">
              {NAV_ITEMS.map((item) => {
                if (item.requireAuth && (!mounted || !token)) return null;
                const isActive = pathname === item.path;

                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${
                      isActive ? 'bg-brand-500 text-slate-950' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>

            <div className="pt-4 border-t border-slate-900 flex flex-col gap-2">
              {mounted && user ? (
                <>
                  <div className="text-xs text-slate-400 font-mono px-4 py-1">
                    Logged in as: {user.name}
                  </div>
                  <button
                    onClick={() => {
                      logout();
                      setMobileMenuOpen(false);
                      router.push('/');
                    }}
                    className="w-full flex items-center justify-center gap-2 text-sm font-semibold bg-slate-900 border border-slate-850 py-3 rounded-xl text-red-400 hover:bg-slate-850"
                  >
                    <LogOut className="h-4 w-4" /> Sign Out
                  </button>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Link
                    href="/login"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center justify-center gap-1.5 text-xs font-semibold bg-slate-900 border border-slate-850 py-3 rounded-xl text-white"
                  >
                    <LogIn className="h-3.5 w-3.5" /> Sign In
                  </Link>
                  <Link
                    href="/register"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center justify-center gap-1.5 text-xs font-semibold bg-brand-500 py-3 rounded-xl text-slate-950"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Sign Up
                  </Link>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </header>
  );
}
