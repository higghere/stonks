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
  activeSimulationId: string | null;
  activeSimulationName: string | null;
  setSession: (token: string | null, user: User | null) => void;
  setSimulation: (id: string | null, name: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
  const isBrowser = typeof window !== 'undefined';
  const initialToken = isBrowser ? localStorage.getItem('token') : null;
  const initialUser = isBrowser ? localStorage.getItem('user') : null;
  const initialSimId = isBrowser ? localStorage.getItem('simId') : null;
  const initialSimName = isBrowser ? localStorage.getItem('simName') : null;

  return {
    token: initialToken,
    user: initialUser ? JSON.parse(initialUser) : null,
    activeSimulationId: initialSimId,
    activeSimulationName: initialSimName,
    setSession: (token, user) => {
      if (isBrowser) {
        if (token) {
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(user));
        } else {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          localStorage.removeItem('simId');
          localStorage.removeItem('simName');
        }
      }
      set({ token, user });
    },
    setSimulation: (id, name) => {
      if (isBrowser) {
        if (id) {
          localStorage.setItem('simId', id);
          localStorage.setItem('simName', name || '');
        } else {
          localStorage.removeItem('simId');
          localStorage.removeItem('simName');
        }
      }
      set({ activeSimulationId: id, activeSimulationName: name });
    },
    logout: () => {
      if (isBrowser) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('simId');
        localStorage.removeItem('simName');
        fetch(`${API_URL}/api/v1/auth/logout`, { method: 'POST' }).catch(() => {});
      }
      set({ token: null, user: null, activeSimulationId: null, activeSimulationName: null });
    },
  };
});
