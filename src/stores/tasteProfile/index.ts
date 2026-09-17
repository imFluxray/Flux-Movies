import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

/*
 * Answers given in the taste finder, kept per Flux profile so two people
 * sharing a browser do not blend into one taste. Films and series (TMDB ids)
 * and anime (AniList ids) live side by side, told apart by `type`.
 */

export type Reaction = "love" | "like" | "dislike" | "skip";

export type RatedType = "movie" | "show" | "anime";

export interface TasteFeature {
  /**
   * TMDB: "g:<genre id>", "k:<keyword id>", "l:<language>", "e:<decade>",
   * "t:<kind>", "a:anime". AniList: "ag:<genre>", "at:<tag>", "af:<format>",
   * "ae:<decade>".
   */
  key: string;
  label: string;
}

export interface RatedTitle {
  id: number;
  type: RatedType;
  title: string;
  poster: string | null;
  reaction: Reaction;
  features: TasteFeature[];
  ratedAt: number;
}

interface ProfileTaste {
  ratings: Record<string, RatedTitle>;
}

interface TasteProfileStore {
  byProfile: Record<string, ProfileTaste>;
  rate(profileId: string, title: RatedTitle): void;
  unrate(profileId: string, key: string): void;
  reset(profileId: string): void;
}

export function ratedKey(title: { id: number; type: RatedType }) {
  return `${title.type}:${title.id}`;
}

export const useTasteProfileStore = create(
  persist(
    immer<TasteProfileStore>((set) => ({
      byProfile: {},
      rate(profileId, title) {
        set((state) => {
          if (!state.byProfile[profileId])
            state.byProfile[profileId] = { ratings: {} };
          state.byProfile[profileId].ratings[ratedKey(title)] = title;
        });
      },
      unrate(profileId, key) {
        set((state) => {
          const bucket = state.byProfile[profileId];
          if (bucket) delete bucket.ratings[key];
        });
      },
      reset(profileId) {
        set((state) => {
          delete state.byProfile[profileId];
        });
      },
    })),
    { name: "__FLUX::taste-profile" },
  ),
);
