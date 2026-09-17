import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import { UserIcons } from "@/components/UserIcon";
import { BookmarkMediaItem } from "@/stores/bookmarks";
import { ProgressMediaItem } from "@/stores/progress";
import { TasteMediaItem } from "@/stores/taste";

export interface ProfileLibrary {
  bookmarks: Record<string, BookmarkMediaItem>;
  likes: Record<string, TasteMediaItem>;
  progress: Record<string, ProgressMediaItem>;
}

export interface LocalProfile {
  avatarUrl?: string;
  /** kept from an earlier avatar system; avatarUrl is the live field */
  avatarStyle?: string;
  avatarSeed?: string;
  colorA: string;
  colorB: string;
  icon: UserIcons;
  id: string;
  name: string;
  library: ProfileLibrary;
}

interface ProfileStore {
  activeId: string | null;
  sessionReady: boolean;
  profiles: LocalProfile[];
  addProfile(profile: Omit<LocalProfile, "id" | "library">): string;
  removeProfile(id: string): void;
  renameProfile(id: string, name: string): void;
  setAvatar(
    id: string,
    preset: Pick<LocalProfile, "avatarUrl" | "colorA" | "colorB" | "icon">,
  ): void;
  saveLibrary(id: string, library: ProfileLibrary): void;
  selectProfile(id: string): void;
}

export const useProfileStore = create(
  persist(
    immer<ProfileStore>((set) => ({
      activeId: null,
      sessionReady: false,
      profiles: [],
      addProfile(profile) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        set((state) => {
          state.profiles.push({
            ...profile,
            id,
            library: { bookmarks: {}, likes: {}, progress: {} },
          });
          state.activeId = id;
          state.sessionReady = true;
        });
        return id;
      },
      removeProfile(id) {
        set((state) => {
          state.profiles = state.profiles.filter(
            (profile) => profile.id !== id,
          );
          if (state.activeId === id)
            state.activeId = state.profiles[0]?.id ?? null;
        });
      },
      renameProfile(id, name) {
        set((state) => {
          const profile = state.profiles.find((item) => item.id === id);
          if (profile && name.trim()) profile.name = name.trim();
        });
      },
      setAvatar(id, preset) {
        set((state) => {
          const profile = state.profiles.find((item) => item.id === id);
          if (profile) Object.assign(profile, preset);
        });
      },
      saveLibrary(id, library) {
        set((state) => {
          const profile = state.profiles.find((item) => item.id === id);
          if (profile) profile.library = library;
        });
      },
      selectProfile(id) {
        set((state) => {
          if (state.profiles.some((profile) => profile.id === id))
            state.activeId = id;
          state.sessionReady = true;
        });
      },
    })),
    {
      name: "__FLUX::profiles",
      partialize: (state) => ({
        activeId: state.activeId,
        profiles: state.profiles,
      }),
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        profiles: (persisted?.profiles ?? []).map((profile: LocalProfile) => ({
          ...profile,
          // anything created before avatars gets a stable seed from its id,
          // so it keeps the same face from now on
          avatarSeed: profile.avatarSeed ?? `flux-${profile.id}`,
          library: profile.library ?? {
            bookmarks: {},
            likes: {},
            progress: {},
          },
        })),
        sessionReady: false,
      }),
    },
  ),
);
