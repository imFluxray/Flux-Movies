import { get } from "@/backend/metadata/tmdb";
import { conf } from "@/setup/config";
import { BookmarkMediaItem } from "@/stores/bookmarks";
import { ProgressMediaItem } from "@/stores/progress";
import { TasteMediaItem } from "@/stores/taste";

/*
 * Personal recommendations for the home hero.
 *
 * Rather than keeping a genre model of our own, this leans on TMDB's
 * per-title recommendations: take the handful of things you most recently
 * watched or saved, ask TMDB what pairs with each, then merge and rank.
 * That is a few requests instead of one per history item, and it lets each
 * suggestion say *why* it is there ("Because you watched X").
 *
 * With no history at all it falls back to what is trending, so the hero is
 * never empty on a first visit.
 */

export interface FeedItem {
  id: number;
  type: "movie" | "show";
  title: string;
  overview: string;
  backdrop: string | null;
  poster: string | null;
  year: number | null;
  rating: number | null;
  /** what in your history produced this, if anything */
  because?: string;
}

const SEED_COUNT = 5; // history items to ask TMDB about
const HERO_SIZE = 8;

function tmdbParams() {
  return { api_key: conf().TMDB_READ_API_KEY, language: "en-US" };
}

function img(path: string | null | undefined, size: string): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

function year(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.slice(0, 4));
  return Number.isFinite(n) ? n : null;
}

/** TMDB mixes movie and tv shapes; normalise to one thing the UI can render. */
export function toFeedItem(raw: any, because?: string): FeedItem | null {
  if (!raw || typeof raw.id !== "number") return null;
  const isShow = raw.media_type === "tv" || (!raw.title && !!raw.name);
  const title = raw.title ?? raw.name;
  if (!title) return null;
  return {
    id: raw.id,
    type: isShow ? "show" : "movie",
    title,
    overview: raw.overview ?? "",
    backdrop: img(raw.backdrop_path, "w1280"),
    poster: img(raw.poster_path, "w342"),
    year: year(raw.release_date ?? raw.first_air_date),
    rating: typeof raw.vote_average === "number" ? raw.vote_average : null,
    because,
  };
}

interface Seed {
  tmdbId: string;
  title: string;
  type: "show" | "movie";
  updatedAt: number;
  /** watched beats merely bookmarked */
  weight: number;
}

/** Most recent things you engaged with, best signal first. */
function collectSeeds(
  progress: Record<string, ProgressMediaItem>,
  bookmarks: Record<string, BookmarkMediaItem>,
  likes: Record<string, TasteMediaItem>,
): Seed[] {
  const seeds = new Map<string, Seed>();

  Object.entries(bookmarks).forEach(([tmdbId, b]) => {
    seeds.set(tmdbId, {
      tmdbId,
      title: b.title,
      type: b.type,
      updatedAt: b.updatedAt ?? 0,
      weight: 1,
    });
  });

  // a started title is a stronger signal than a saved one, so it overwrites
  Object.entries(progress).forEach(([tmdbId, p]) => {
    const episodes = Object.values(p.episodes ?? {});
    const latest = episodes.reduce(
      (acc, e) => Math.max(acc, e.updatedAt ?? 0),
      p.updatedAt ?? 0,
    );
    seeds.set(tmdbId, {
      tmdbId,
      title: p.title,
      type: p.type,
      updatedAt: latest,
      weight: 2,
    });
  });

  // A thumbs-up is the clearest preference signal and deliberately outranks
  // passive viewing history. Keep the media type in the map key because TMDB
  // movie and television identifiers can overlap.
  Object.values(likes).forEach((liked) => {
    seeds.set(`${liked.type}:${liked.id}`, {
      tmdbId: String(liked.id),
      title: liked.title,
      type: liked.type,
      updatedAt: liked.updatedAt,
      weight: 3,
    });
  });

  return [...seeds.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function trendingFallback(): Promise<FeedItem[]> {
  const data = await get<any>("/trending/all/week", tmdbParams());
  return (data?.results ?? [])
    .map((r: any) => toFeedItem(r))
    .filter((i: FeedItem | null): i is FeedItem => i !== null && !!i.backdrop)
    .slice(0, HERO_SIZE);
}

/**
 * Ranked picks for the hero. Never throws - a failed sub-request just
 * contributes nothing, and an empty result falls back to trending.
 */
export async function getRecommendations(
  progress: Record<string, ProgressMediaItem>,
  bookmarks: Record<string, BookmarkMediaItem>,
  likes: Record<string, TasteMediaItem> = {},
): Promise<{ items: FeedItem[]; personalised: boolean }> {
  const seeds = collectSeeds(progress, bookmarks, likes).slice(0, SEED_COUNT);
  if (seeds.length === 0) {
    return { items: await trendingFallback(), personalised: false };
  }

  // Movie and TV ids are separate TMDB namespaces, so never key by the bare
  // number. A movie and a series can legitimately share the same numeric id.
  const seen = new Set([
    ...Object.entries(progress).map(([id, item]) => `${item.type}:${id}`),
    ...Object.entries(bookmarks).map(([id, item]) => `${item.type}:${id}`),
    ...Object.values(likes).map((item) => `${item.type}:${item.id}`),
  ]);
  const scored = new Map<string, { item: FeedItem; score: number }>();

  const lists = await Promise.all(
    seeds.map(async (seed, idx) => {
      const path = seed.type === "show" ? "tv" : "movie";
      try {
        const data = await get<any>(
          `/${path}/${seed.tmdbId}/recommendations`,
          tmdbParams(),
        );
        return { seed, idx, results: data?.results ?? [] };
      } catch {
        return { seed, idx, results: [] as any[] };
      }
    }),
  );

  lists.forEach(({ seed, idx, results }) => {
    // earlier seeds are more recent, so they count for more
    const seedWeight = seed.weight * (1 - idx / (SEED_COUNT + 1));
    results.forEach((raw: any, rank: number) => {
      const item = toFeedItem(raw, seed.title);
      if (!item || !item.backdrop) return;
      const itemKey = `${item.type}:${item.id}`;
      if (seen.has(itemKey)) return;
      // position in TMDB's own list matters, but less than which seed it came from
      const positional = 1 / (1 + rank * 0.15);
      const quality = (item.rating ?? 5) / 10;
      const add = seedWeight * positional * (0.7 + quality * 0.6);
      const existing = scored.get(itemKey);
      if (existing) {
        // appearing under several seeds is a strong signal
        existing.score += add;
      } else {
        scored.set(itemKey, { item, score: add });
      }
    });
  });

  const items = [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, HERO_SIZE)
    .map((s) => s.item);

  if (items.length < 3) {
    const filler = await trendingFallback();
    const have = new Set(items.map((i) => `${i.type}:${i.id}`));
    items.push(...filler.filter((f) => !have.has(`${f.type}:${f.id}`)));
    return { items: items.slice(0, HERO_SIZE), personalised: items.length > 0 };
  }

  return { items, personalised: true };
}
