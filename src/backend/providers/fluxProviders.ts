import { ScrapeMedia, Stream } from "@movie-web/providers";

import { applySourcePrefs } from "@/utils/sourcePrefs";

/*
 * Runtime provider list.
 *
 * The upstream @movie-web/providers scrapers are compiled into the bundle and
 * are all dead, so nothing they return can be played. This module replaces
 * them with a list read from /providers.json at RUNTIME - editing that file and
 * refreshing is enough, no rebuild.
 *
 * Nothing here ever logs a provider's url or host: a broken source is reported
 * by `name` only, so the config stays private in a shared console.
 */

export interface FluxProvider {
  id: string;
  name: string;
  url: string;
  movie_url_pattern: string;
  tv_url_pattern: string;
  /** optional second pattern, tried only after the primary comes up empty */
  movie_alias?: string | null;
  tv_alias?: string | null;
  scraper_timeout_seconds?: number;
  enabled?: boolean;
  /** route the lookup through the CORS proxy (default true) */
  use_proxy?: boolean;
  /** also route the resulting playlist/file through the proxy (default false) */
  proxy_stream?: boolean;
  /** resolve this exact scraper from the bundled Movie-Web provider package */
  movie_web_source?: string;
  /** resolve this exact scraper from the newer P-Stream/Afterstream fork */
  pstream_source?: string;
  /** resolve this exact scraper from KDesa's shipped browser provider module */
  kdesa_source?: string;
  /** restrict a provider to media it actually supports */
  media_types?: Array<"movie" | "show">;
  /** ask the same-origin resolver for one specific browser provider */
  resolver_provider?: string;
  request_method?: "GET" | "POST";
  /** Resolve anime through the locally hosted Anivexa aggregator. */
  anivexa?: boolean;
  /** Resolve anime to MegaPlay's embedded player, driven by our controls. */
  megaplay?: boolean;
}

const CONFIG_URL = "/providers.json";
const DEFAULT_TIMEOUT_SECONDS = 30;

/** Anime-only sources: they resolve by AniList id, not by a url pattern. */
export function isAnimeResolver(p: FluxProvider): boolean {
  return Boolean(p.anivexa || p.megaplay);
}

function usable(p: any): p is FluxProvider {
  if (!p || typeof p !== "object") return false;
  if (p.enabled === false) return false;
  if (typeof p.id !== "string" || !p.id) return false;
  if (typeof p.name !== "string" || !p.name) return false;
  if (typeof p.movie_web_source === "string" && p.movie_web_source) return true;
  if (typeof p.pstream_source === "string" && p.pstream_source) return true;
  if (typeof p.kdesa_source === "string" && p.kdesa_source) return true;
  if (
    (p.anivexa === true || p.megaplay === true) &&
    typeof p.url === "string" &&
    p.url
  )
    return true;
  if (typeof p.url !== "string" || !p.url) return false;
  try {
    // eslint-disable-next-line no-new
    new URL(p.url);
  } catch {
    return false;
  }
  return (
    typeof p.movie_url_pattern === "string" ||
    typeof p.tv_url_pattern === "string"
  );
}

async function load(): Promise<FluxProvider[]> {
  try {
    const res = await fetch(CONFIG_URL, { cache: "no-store" });
    if (!res.ok) return [];
    const raw = await res.json();
    // a single provider may be written as a bare object rather than an array
    const list = Array.isArray(raw) ? raw : [raw];
    const ok = list.filter(usable);
    const skipped = list.length - ok.length;
    if (skipped > 0) {
      // names only - never the url
      const bad = list
        .filter((p: any) => !usable(p))
        .map((p: any) => (p && p.name) || "<unnamed>")
        .join(", ");
      console.warn(
        `[flux] ${skipped} provider(s) ignored (missing fields, bad url, or disabled): ${bad}`,
      );
    }
    return ok;
  } catch (err) {
    console.warn(`[flux] could not read ${CONFIG_URL}`, err);
    return [];
  }
}

let cache: Promise<FluxProvider[]> | null = null;
let resolvedCache: FluxProvider[] = [];

/** Every configured provider, including ones the viewer has switched off. */
export function getAllFluxProviders(): Promise<FluxProvider[]> {
  if (!cache)
    cache = load().then((providers) => {
      resolvedCache = providers;
      return providers;
    });
  return cache;
}

/**
 * The providers playback should actually use: the viewer's order, minus any
 * they have switched off. Settings reads getAllFluxProviders instead, so a
 * disabled source stays listed and can be switched back on.
 */
export function getFluxProviders(): Promise<FluxProvider[]> {
  return getAllFluxProviders().then(applySourcePrefs);
}

/** Runtime providers already loaded for this page, used by player menus. */
export function getCachedFluxProviders(): FluxProvider[] {
  return resolvedCache;
}

/** Whether a source id belongs to one of the anime resolvers. */
export function isAnimeSourceId(id: string | null | undefined): boolean {
  if (!id) return false;
  return getCachedFluxProviders().some(
    (p) => p.id === id && isAnimeResolver(p),
  );
}

export function timeoutMs(p: FluxProvider): number {
  const s = p.scraper_timeout_seconds;
  if (typeof s !== "number" || !Number.isFinite(s) || s <= 0)
    return DEFAULT_TIMEOUT_SECONDS * 1000;
  return Math.min(s, 120) * 1000;
}

/**
 * Fill the placeholders. {url} is substituted raw; the ids and numbers are
 * encoded, so a stray character in a tmdb id cannot break out of the query.
 */
export function buildUrl(
  p: FluxProvider,
  media: ScrapeMedia,
  useAlias = false,
): string | null {
  if (
    p.movie_web_source ||
    p.pstream_source ||
    p.kdesa_source ||
    isAnimeResolver(p)
  )
    return null;
  const isShow = media.type === "show";
  const pattern = useAlias
    ? isShow
      ? p.tv_alias
      : p.movie_alias
    : isShow
      ? p.tv_url_pattern
      : p.movie_url_pattern;
  if (!pattern || typeof pattern !== "string") return null;

  const base = p.url.replace(/\/+$/, "");
  const enc: Record<string, string> = {
    "{tmdbId}": media.tmdbId ? String(media.tmdbId) : "",
    "{imdbId}": media.imdbId ? String(media.imdbId) : "",
    "{type}": isShow ? "tv" : "movie",
    "{season}": isShow ? String(media.season.number) : "",
    "{episode}": isShow ? String(media.episode.number) : "",
  };

  let out = pattern.split("{url}").join(base);
  for (const [token, value] of Object.entries(enc)) {
    out = out.split(token).join(encodeURIComponent(value));
  }
  return out;
}

/** Which placeholders were left empty - used to explain a skip in the UI. */
export function missingFields(p: FluxProvider, media: ScrapeMedia): string[] {
  const isShow = media.type === "show";
  const pattern = isShow ? p.tv_url_pattern : p.movie_url_pattern;
  const gaps: string[] = [];
  if (typeof pattern !== "string") return gaps;
  if (pattern.includes("{imdbId}") && !media.imdbId) gaps.push("imdbId");
  if (pattern.includes("{tmdbId}") && !media.tmdbId) gaps.push("tmdbId");
  return gaps;
}

export type { Stream };
