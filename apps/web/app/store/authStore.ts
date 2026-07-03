import { create } from 'zustand';
import { API_URL } from '../lib/config';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  setSession: (token: string | null, user: User | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
  // Safe check for browser environment
  const isBrowser = typeof window !== 'undefined';
  const initialToken = isBrowser ? localStorage.getItem('token') : null;
  const initialUser = isBrowser ? localStorage.getItem('user') : null;

  return {
    token: initialToken,
    user: initialUser ? JSON.parse(initialUser) : null,
    setSession: (token, user) => {
      if (isBrowser) {
        if (token) {
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(user));
        } else {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      }
      set({ token, user });
    },
    logout: () => {
      if (isBrowser) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // Trigger API logout in background
        fetch(`${API_URL}/api/v1/auth/logout`, { method: 'POST' }).catch(() => {});
      }
      set({ token: null, user: null });
    },
  };
});
