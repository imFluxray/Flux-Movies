import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export interface TasteMediaItem {
  id: number;
  type: "movie" | "show";
  title: string;
  updatedAt: number;
}

interface TasteStore {
  likes: Record<string, TasteMediaItem>;
  replaceLikes(items: Record<string, TasteMediaItem>): void;
  toggleLike(item: Omit<TasteMediaItem, "updatedAt">): void;
}

export function tasteKey(item: { id: number; type: "movie" | "show" }) {
  return `${item.type}:${item.id}`;
}

export const useTasteStore = create(
  persist(
    immer<TasteStore>((set) => ({
      likes: {},
      replaceLikes(items) {
        set((state) => {
          state.likes = items;
        });
      },
      toggleLike(item) {
        set((state) => {
          const key = tasteKey(item);
          if (state.likes[key]) delete state.likes[key];
          else state.likes[key] = { ...item, updatedAt: Date.now() };
        });
      },
    })),
    { name: "__FLUX::taste" },
  ),
);
