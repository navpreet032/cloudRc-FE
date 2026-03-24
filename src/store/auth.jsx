import { create } from 'zustand';

export const useAuthStore = create((set) => ({
  token: localStorage.getItem('cloudrc_token') || null,
  user: (() => {
    try { return JSON.parse(localStorage.getItem('cloudrc_user') || 'null'); } catch { return null; }
  })(),

  setAuth: (token, user) => {
    localStorage.setItem('cloudrc_token', token);
    localStorage.setItem('cloudrc_user', JSON.stringify(user));
    set({ token, user });
  },

  clearAuth: () => {
    localStorage.removeItem('cloudrc_token');
    localStorage.removeItem('cloudrc_user');
    set({ token: null, user: null });
  },
}));