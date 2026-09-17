import { get } from "@/backend/metadata/tmdb";
import { conf } from "@/setup/config";
import { FeedItem, toFeedItem } from "@/utils/algorithm";

/*
 * The rows on the home page - a smaller, opinionated cut of Discover.
 *
 * Two of these are switchable: the streaming service on "Only on ...", and
 * the genre row. Both keep their choice in localStorage so the page comes
 * back the way you left it.
 */

export interface WatchProvider {
  id: number;
  name: string;
}

// TMDB watch-provider ids (US region). Kept short on purpose - a long list
// turns the row header into a menu nobody reads.
export const WATCH_PROVIDERS: WatchProvider[] = [
  { id: 8, name: "Netflix" },
  { id: 337, name: "Disney+" },
  { id: 9, name: "Prime Video" },
  { id: 1899, name: "Max" },
  { id: 15, name: "Hulu" },
  { id: 350, name: "Apple TV+" },
  { id: 531, name: "Paramount+" },
  { id: 386, name: "Peacock" },
];

export const PROVIDER_KEY = "flux.home.provider";
export const GENRE_KEY = "flux.home.genre";
export const DEFAULT_GENRE_ID = 35; // Comedy, per the brief

function params(extra?: Record<string, string | number>) {
  return {
    api_key: conf().TMDB_READ_API_KEY,
    language: "en-US",
    ...(extra ?? {}),
  };
}

function clean(results: any[], requireBackdrop = false): FeedItem[] {
  return (results ?? [])
    .map((r) => toFeedItem(r))
    .filter((i): i is FeedItem => {
      if (!i) return false;
      if (requireBackdrop) return !!i.backdrop;
      return !!i.poster;
    });
}

/** Today's trending, split so the ranked row and the long row never repeat. */
export async function fetchTrendingToday(): Promise<{
  top10: FeedItem[];
  rest: FeedItem[];
}> {
  const data = await get<any>("/trending/all/day", params());
  const all = clean(data?.results ?? []);
  return { top10: all.slice(0, 10), rest: all.slice(10) };
}

export async function fetchOnlyOn(providerId: number): Promise<FeedItem[]> {
  const data = await get<any>(
    "/discover/movie",
    params({
      with_watch_providers: providerId,
      watch_region: "US",
      sort_by: "popularity.desc",
      "vote_count.gte": 40,
    }),
  );
  return clean(data?.results ?? []);
}

export async function fetchTopRated(): Promise<FeedItem[]> {
  const data = await get<any>("/movie/top_rated", params());
  return clean(data?.results ?? []);
}

export async function fetchByGenre(genreId: number): Promise<FeedItem[]> {
  const data = await get<any>(
    "/discover/movie",
    params({
      with_genres: genreId,
      sort_by: "popularity.desc",
      "vote_count.gte": 100,
    }),
  );
  return clean(data?.results ?? []);
}

export async function fetchGenres(): Promise<{ id: number; name: string }[]> {
  const data = await get<any>("/genre/movie/list", params());
  return data?.genres ?? [];
}

/** localStorage access that cannot throw in private mode. */
export function readPref(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* private mode - the choice just will not persist */
  }
}
