import { create } from 'zustand';

export interface AppState {
  currentUserId: string | null;
  setCurrentUserId: (id: string) => void;
}

export const useStore = create<AppState>((set) => ({
  currentUserId: null,
  setCurrentUserId: (id) => set({ currentUserId: id }),
}));
