'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../store/authStore';
import Link from 'next/link';
import { API_URL } from '../lib/config';

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }

      setSession(data.accessToken, data.user);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    try {
      const response = await fetch(`${API_URL}/api/v1/auth/oauth/${provider}`);
      const data = await response.json();
      if (data.success && data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError(`Failed to start ${provider} login`);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-xl backdrop-blur-md">
        <div>
          <h2 className="mt-2 text-center text-3xl font-extrabold tracking-tight text-white font-outfit">
            Sign in to your account
          </h2>
        </div>

        {error && (
          <div className="rounded-lg bg-red-950 border border-red-800 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4 rounded-md shadow-sm">
            <div>
              <label htmlFor="email-address" className="sr-only">Email address</label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="relative block w-full appearance-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-white placeholder-slate-500 focus:z-10 focus:border-brand-500 focus:outline-none focus:ring-brand-500 sm:text-sm"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="relative block w-full appearance-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-white placeholder-slate-500 focus:z-10 focus:border-brand-500 focus:outline-none focus:ring-brand-500 sm:text-sm"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative flex w-full justify-center rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing In...' : 'Sign In'}
            </button>
          </div>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-slate-800"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-slate-900 px-2 text-slate-500">Or continue with</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleOAuth('google')}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-950 py-2.5 text-sm font-medium text-white hover:bg-slate-900 transition-colors"
          >
            Google
          </button>
          <button
            onClick={() => handleOAuth('github')}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-950 py-2.5 text-sm font-medium text-white hover:bg-slate-900 transition-colors"
          >
            GitHub
          </button>
        </div>

        <div className="text-center text-sm text-slate-400">
          Don't have an account?{' '}
          <Link href="/register" className="font-medium text-brand-500 hover:text-brand-600">
            Sign Up
          </Link>
        </div>
      </div>
    </div>
  );
}
