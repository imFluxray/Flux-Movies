import {
  FullScraperEvents,
  RunOutput,
  ScrapeMedia,
} from "@movie-web/providers";

import { getLoadbalancedProxyUrl } from "@/backend/providers/fetchers";
import {
  FluxProvider,
  buildUrl,
  isAnimeResolver,
  missingFields,
  timeoutMs,
} from "@/backend/providers/fluxProviders";
import {
  getFluxKdesaProviders,
  getFluxNativeProviders,
  getFluxPstreamProviders,
} from "@/backend/providers/providers";
import { getPreferredAnimeAudio } from "@/utils/animeAudio";
import { isCodecBanned, refererHostOfStream } from "@/utils/codecBans";

/*
 * Runs the sources from providers.json and returns the first playable result.
 * Emits the same events the upstream runner did, so the "finding sources" UI
 * works unchanged.
 *
 * An endpoint may answer with any of:
 *   - JSON holding ONE stream, or a LIST of already-resolved streams
 *   - an m3u8 playlist   -> hls stream
 *   - an mp4             -> file stream
 *   - an HTML page       -> last resort, we look for a playlist inside it
 *
 * The list form is the fast path: an aggregator that has already checked its
 * sources returns every working stream in a single request, so nothing has to
 * be probed one at a time. When that list carries several qualities of the
 * same file they are merged into one stream, which is what gives the player
 * its quality picker.
 */

type Stream = RunOutput["stream"];
type Caption = Stream["captions"][number];

/** init carries names too: our ids are not in the library's metadata table. */
export type FluxInitEvent = {
  sourceIds: string[];
  sourceNames?: Record<string, string>;
};
export type FluxEvents = Omit<FullScraperEvents, "init"> & {
  init?: (evt: FluxInitEvent) => void;
};

const M3U8 = /^(application\/(vnd\.apple\.mpegurl|x-mpegurl)|audio\/mpegurl)/i;

/*
 * Anivexa caches its mirror ranking per {anilistId, episode, audio}. Once we
 * have asked it to warm the alternate audio, a later resolve is a cache read
 * rather than another round of probing, so it is safe to await then. Before
 * that it must never be awaited: that is what used to hold up playback.
 */
const warmedRankings = new Set<string>();

/*
 * The alternate audio track, kept rather than thrown away.
 *
 * The background resolve used to discard the Stream it produced and keep only
 * the "this ranking is warm" side effect, so pressing Dub started a second,
 * identical resolve from scratch - mirrors re-ranked, segments re-benchmarked.
 * That is the whole reason switching audio was slow.
 *
 * Entries hold the in-flight promise, so a switch that arrives mid-resolve
 * joins the existing work instead of racing it. Signed playlist URLs expire,
 * so anything older than the TTL is discarded rather than handed to a player
 * that would fail on a dead token.
 */
const ALTERNATE_TTL_MS = 4 * 60 * 1000;
// How long the unselected track may take before we stop waiting for it.
const ALTERNATE_WINDOW_MS = 3_000;
const ALTERNATE_MAX_ENTRIES = 24;
const alternateStreams = new Map<
  string,
  { at: number; stream: Promise<Stream | null> }
>();

function alternateKey(
  anilistId: number | string,
  episodeNumber: number | string,
  audio: string,
): string {
  return `${anilistId}:${episodeNumber}:${audio}`;
}

function rememberAlternate(key: string, stream: Promise<Stream | null>): void {
  alternateStreams.set(key, { at: Date.now(), stream });
  if (alternateStreams.size > ALTERNATE_MAX_ENTRIES) {
    const oldest = alternateStreams.keys().next().value;
    if (oldest !== undefined) alternateStreams.delete(oldest);
  }
}

function recallAlternate(key: string): Promise<Stream | null> | null {
  const hit = alternateStreams.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ALTERNATE_TTL_MS) {
    alternateStreams.delete(key);
    return null;
  }
  return hit.stream;
}
const MP4 = /^video\/(mp4|x-m4v)/i;
const JSONISH = /^application\/(json|.*\+json)/i;
const HTMLISH = /^(text\/html|application\/xhtml)/i;

function proxied(
  url: string,
  provider?: string,
  headers?: Record<string, string>,
  hlsRelay = false,
): string {
  const proxy = getLoadbalancedProxyUrl();
  if (!proxy) return url;
  const params = new URLSearchParams({ destination: url });
  if (provider) params.set("provider", provider);
  if (headers && Object.keys(headers).length)
    params.set("headers", JSON.stringify(headers));
  if (hlsRelay) params.set("hls", "1");
  return `${proxy}?${params.toString()}`;
}

function looksLikePlaylist(u: string): boolean {
  try {
    return new URL(u, "http://x").pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return u.toLowerCase().includes(".m3u8");
  }
}

function looksLikeFile(u: string): boolean {
  try {
    return /\.(mp4|m4v|webm|mkv)$/i.test(new URL(u, "http://x").pathname);
  } catch {
    return /\.(mp4|m4v|webm|mkv)(\?|$)/i.test(u);
  }
}

/** The player only understands this fixed ladder, so map anything onto it. */
function qualityKey(raw: any): string {
  const s = String(raw ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/(2160|4k|uhd)/.test(s)) return "4k";
  if (/1080|fhd/.test(s)) return "1080";
  if (/720|hd\b/.test(s)) return "720";
  if (/480/.test(s)) return "480";
  if (/360/.test(s)) return "360";
  return "unknown";
}

function pickUrl(o: any): string | null {
  const v =
    o.playlist ??
    o.m3u8 ??
    o.hls ??
    o.url ??
    o.file ??
    o.link ??
    o.src ??
    o.mp4;
  return typeof v === "string" && v ? v : null;
}

function isHls(o: any, url: string): boolean {
  const t = String(o.type ?? o.format ?? "").toLowerCase();
  if (t.includes("hls") || t.includes("m3u8")) return true;
  if (t === "file" || t === "mp4") return false;
  return looksLikePlaylist(url);
}

function isSameOrigin(u: string): boolean {
  try {
    return new URL(u, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

function normaliseCaptions(o: any): Caption[] {
  const candidate = o.captions ?? o.subtitles ?? o.subtitle ?? o.tracks;
  const raw = Array.isArray(candidate)
    ? candidate
    : candidate && typeof candidate === "object"
      ? Object.values(candidate)
      : candidate
        ? [candidate]
        : [];
  return raw
    .map((c: any, i: number): Caption | null => {
      const url = typeof c === "string" ? c : (c?.url ?? c?.file ?? c?.src);
      if (typeof url !== "string" || !url) return null;
      const lang =
        c?.language ?? c?.lang ?? c?.srclang ?? c?.label ?? "unknown";
      const declared = String(
        c?.format ?? c?.type ?? c?.kind ?? "",
      ).toLowerCase();
      return {
        type:
          declared === "srt" || (!declared && /\.srt(\?|$)/i.test(url))
            ? "srt"
            : "vtt",
        id: String(c?.id ?? `cap-${i}`),
        url,
        // third-party caption hosts send no CORS headers, so the player
        // must fetch them through the proxy (needsProxy reads this flag)
        hasCorsRestrictions: !isSameOrigin(url),
        language: String(lang),
      } as Caption;
    })
    .filter((c): c is Caption => c !== null);
}

// .sub and .txt results are frame-based or unstructured; nothing here reads them
const OPENSUBTITLES_FORMATS = ["srt", "vtt", "ass", "ssa"];

/*
 * OpenSubtitles' legacy REST API. It needs no key, only a user agent it
 * recognises (forwarded by the proxy). Series are found by the show's IMDb id
 * plus season and episode, in the alphabetical path order it expects.
 */
export async function fetchOpenSubtitles(
  media: ScrapeMedia,
): Promise<Caption[]> {
  if (!media.imdbId) return [];
  const showPath =
    media.type === "show"
      ? `episode-${media.episode.number}/imdbid-${media.imdbId.slice(2)}/season-${media.season.number}`
      : `imdbid-${media.imdbId.slice(2)}`;
  try {
    const response = await fetch(
      proxied(`https://rest.opensubtitles.org/search/${showPath}`, undefined, {
        "X-User-Agent": "VLSub 0.10.2",
      }),
      {
        headers: { Accept: "application/json" },
        // opensubtitles is a free endpoint that rate-limits by stalling
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) return [];
    const payload = await response.json();
    if (!Array.isArray(payload)) return [];
    // one file per language: the most downloaded is usually the best synced
    const ranked = [...payload].sort(
      (a, b) =>
        Number(b?.SubDownloadsCnt ?? 0) - Number(a?.SubDownloadsCnt ?? 0),
    );
    const byLanguage = new Map<string, Caption>();
    ranked.forEach((item: any, index: number) => {
      const rawUrl = item?.SubDownloadLink;
      const language = String(item?.ISO639 ?? item?.SubLanguageID ?? "").trim();
      const format = String(item?.SubFormat ?? "srt").toLowerCase();
      if (typeof rawUrl !== "string" || !rawUrl || !language) return;
      if (!OPENSUBTITLES_FORMATS.includes(format)) return;
      if (byLanguage.has(language)) return;
      const url = rawUrl
        .replace(".gz", "")
        .replace("download/", "download/subencoding-utf8/");
      byLanguage.set(language, {
        id: `opensubtitles-${language}-${item?.IDSubtitleFile ?? index}`,
        opensubtitles: true,
        url,
        // ASS and SSA are cleaned into SRT when downloaded (utils/captions)
        type: format === "vtt" ? "vtt" : "srt",
        hasCorsRestrictions: true,
        language,
      } as Caption);
    });
    return [...byLanguage.values()];
  } catch {
    return [];
  }
}

function mergeCaptions(stream: Stream, additions: Caption[]): Stream {
  if (!additions.length) return stream;
  const captions = [...(stream.captions ?? [])];
  additions.forEach((caption) => {
    if (
      !captions.some(
        (existing) =>
          existing.url === caption.url ||
          (existing.opensubtitles && existing.language === caption.language),
      )
    )
      captions.push(caption);
  });
  return { ...stream, captions } as Stream;
}

function headerRecord(o: any): Record<string, string> {
  if (!o || typeof o !== "object") return {};
  const supplied = o.headers ?? o.requestHeaders;
  const headers =
    supplied && typeof supplied === "object" ? { ...supplied } : {};
  if (
    typeof o.referer === "string" &&
    !Object.keys(headers).some((key) => key.toLowerCase() === "referer")
  )
    headers.Referer = o.referer;
  if (
    typeof o.origin === "string" &&
    !Object.keys(headers).some((key) => key.toLowerCase() === "origin")
  )
    headers.Origin = o.origin;
  return headers;
}

function extraHeaders(o: any, parent?: any): Partial<Stream> {
  const h = { ...headerRecord(parent), ...headerRecord(o) };
  if (!Object.keys(h).length) return {};
  return { headers: h, preferredHeaders: h } as Partial<Stream>;
}

/** Unwrap the common envelopes an endpoint might use around its payload. */
function unwrap(
  data: any,
  depth = 0,
  container: any = null,
): { items: any[]; container: any } {
  if (!data || depth > 4) return { items: [], container };
  if (Array.isArray(data)) return { items: data, container };
  if (typeof data !== "object") return { items: [], container };
  for (const key of [
    "streams",
    "sources",
    "results",
    "data",
    "items",
    "list",
    "stream",
  ]) {
    if (data[key] !== undefined) return unwrap(data[key], depth + 1, data);
  }
  return { items: [data], container };
}

/**
 * Turn a payload into playable streams. Several qualities of the same file
 * collapse into a single stream so the player can offer a quality picker;
 * playlists stay separate because an m3u8 carries its own variant ladder.
 */
export function normaliseStreams(payload: any): {
  streams: Stream[];
  count: number;
} {
  const found = unwrap(payload);
  const items = found.items.filter((o) => {
    if (!o || typeof o !== "object") return false;
    const url = pickUrl(o);
    if (!url) return false;
    const declared = String(o.type ?? o.format ?? "").toLowerCase();
    // Anivexa can return iframe/embed pages alongside resolved streams. A
    // plain embed URL is HTML, not a file stream, even though it has a `url`.
    if (
      (declared === "embed" ||
        declared === "iframe" ||
        declared === "player") &&
      !looksLikePlaylist(url) &&
      !looksLikeFile(url)
    )
      return false;
    return true;
  });
  // e.g. { sources: [...], subtitles: [...] } - the tracks belong to all of them
  const outerCaptions = found.container
    ? normaliseCaptions(found.container)
    : [];
  const captionsFor = (o: any) => {
    const own = normaliseCaptions(o);
    return own.length ? own : outerCaptions;
  };
  if (!items.length) return { streams: [], count: 0 };

  const firstUrl = pickUrl(items[0]) as string;
  const firstIsHls = isHls(items[0], firstUrl);

  if (firstIsHls) {
    // respect the endpoint's own ordering; it ranked these already
    const streams = items
      .map((o) => {
        const url = pickUrl(o) as string;
        if (!isHls(o, url)) return null;
        return {
          id: "primary",
          type: "hls",
          playlist: url,
          flags: ["cors-allowed"],
          captions: captionsFor(o),
          ...extraHeaders(o, found.container),
        } as unknown as Stream;
      })
      .filter((s): s is Stream => s !== null);
    return { streams, count: items.length };
  }

  const qualities: Record<string, { type: "mp4"; url: string }> = {};
  let captions: Caption[] = [];
  let headers: Partial<Stream> = {};
  items.forEach((o, i) => {
    const url = pickUrl(o) as string;
    if (isHls(o, url)) return;
    let key = qualityKey(
      o.quality ?? o.res ?? o.resolution ?? o.height ?? o.label,
    );
    // two unlabelled files would otherwise overwrite each other
    if (key === "unknown" && qualities.unknown && i > 0) return;
    if (qualities[key]) key = "unknown";
    if (qualities[key]) return;
    qualities[key] = { type: "mp4", url };
    if (!captions.length) captions = captionsFor(o);
    if (!Object.keys(headers).length)
      headers = extraHeaders(o, found.container);
  });

  if (!Object.keys(qualities).length)
    return { streams: [], count: items.length };
  return {
    streams: [
      {
        id: "primary",
        type: "file",
        qualities,
        flags: ["cors-allowed"],
        captions,
        ...headers,
      } as unknown as Stream,
    ],
    count: items.length,
  };
}

function hls(playlist: string): Stream {
  return {
    id: "primary",
    type: "hls",
    playlist,
    flags: ["cors-allowed"],
    captions: [],
  } as unknown as Stream;
}

function file(url: string, quality = "unknown"): Stream {
  return {
    id: "primary",
    type: "file",
    qualities: { [quality]: { type: "mp4", url } },
    flags: ["cors-allowed"],
    captions: [],
  } as unknown as Stream;
}

/** Last resort: pull a playlist or file url out of an embed page. */
function scrapeHtml(html: string, pageUrl: string): Stream | null {
  const playlist = html.match(/https?:\/\/[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*/i);
  if (playlist) return hls(playlist[0]);
  const mp4 = html.match(/https?:\/\/[^\s"'<>\\]+?\.mp4[^\s"'<>\\]*/i);
  if (mp4) return file(mp4[0]);
  const rel = html.match(/["'](\/[^\s"'<>]+?\.m3u8[^\s"'<>]*)["']/i);
  if (rel) {
    try {
      return hls(new URL(rel[1], pageUrl).toString());
    } catch {
      /* ignore */
    }
  }
  return null;
}

function maybeProxyStream(p: FluxProvider, stream: Stream): Stream {
  if (!p.proxy_stream) return stream;
  const provider =
    p.kdesa_source ??
    p.pstream_source ??
    p.movie_web_source ??
    (p.anivexa ? "anivexa" : undefined);
  if (stream.type === "hls")
    return {
      ...stream,
      playlist: proxied(
        stream.playlist,
        provider,
        stream.headers,
        Boolean(p.kdesa_source || p.anivexa),
      ),
      headers: undefined,
      preferredHeaders: undefined,
      flags: ["cors-allowed"],
    };
  const qualities = Object.fromEntries(
    Object.entries(stream.qualities).map(([k, v]: [string, any]) => [
      k,
      { ...v, url: proxied(v.url, provider, stream.headers) },
    ]),
  );
  return { ...stream, qualities } as Stream;
}

/**
 * A fast resolver response is not the same as a fast video. Validate the
 * manifest (or the first bytes of a file) through the exact URL the player
 * will use so dead/403 servers lose the race before playback starts.
 */
/*
 * Is this stream worth handing to the player?
 *
 * "Worth handing over" is not the same as "answers our probe". Many of these
 * CDNs issue tokens bound to the requesting client, or refuse anything that
 * is not the player itself, so they answer this check with 401/403 while
 * playing perfectly well moments later. Treating that as a dead stream
 * rejected every candidate in turn and left the anime path with nothing.
 *
 * So an auth refusal counts as reachable. Anything the browser genuinely
 * cannot decode is caught afterwards by the codec ban, which is based on what
 * the player actually did rather than on what a side-channel request was
 * allowed to see.
 */
function isAuthRefusalStatus(status: number): boolean {
  return status === 401 || status === 403;
}

async function manifestReachable(stream: Stream): Promise<boolean> {
  try {
    if (stream.type === "hls") {
      const res = await fetch(stream.playlist, {
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) {
        res.body?.cancel().catch(() => {});
        return isAuthRefusalStatus(res.status);
      }
      const text = await res.text();
      return text.trimStart().startsWith("#EXTM3U");
    }
    const first = Object.values(stream.qualities)[0];
    if (!first?.url) return false;
    const res = await fetch(first.url, {
      method: "GET",
      headers: { Range: "bytes=0-1" },
      signal: AbortSignal.timeout(4000),
    });
    res.body?.cancel().catch(() => {});
    return res.ok || res.status === 206 || isAuthRefusalStatus(res.status);
  } catch {
    return false;
  }
}

/*
 * Some CDNs issue playback tokens bound to the requesting IP, or good for a
 * single use. Our benchmark is a *separate* request from the one the player
 * later makes, so those hosts answer it with 403 even though playback itself
 * works fine.
 *
 * Measured on a real episode: every mirror refused the probe, the runner
 * spent 13.5s exhausting them, then played the very stream it started with.
 * So an auth refusal now means "cannot be measured", not "cannot be played" -
 * the stream stays a candidate, scored below anything we did manage to
 * benchmark, and startup stops paying for a measurement it never gets.
 */
const UNVERIFIABLE = "stream cannot be probed from the browser";
const UNVERIFIABLE_SCORE = 0.01;

function isAuthRefusal(status: number): boolean {
  return status === 401 || status === 403;
}

async function verifyStreamReady(stream: Stream): Promise<number> {
  try {
    // eslint-disable-next-line no-use-before-define
    return await benchmarkStream(stream);
  } catch (err) {
    if (err instanceof Error && err.message === UNVERIFIABLE)
      return UNVERIFIABLE_SCORE;
    throw err;
  }
}

async function benchmarkStream(stream: Stream): Promise<number> {
  if (stream.type === "hls") {
    const probeStarted = performance.now();
    const readManifest = async (url: string) => {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/vnd.apple.mpegurl" },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        response.body?.cancel().catch(() => {});
        if (isAuthRefusal(response.status)) throw new Error(UNVERIFIABLE);
        throw new Error(`manifest returned HTTP ${response.status}`);
      }
      const text = await response.text();
      if (!text.trimStart().startsWith("#EXTM3U"))
        throw new Error("invalid HLS manifest");
      return text;
    };

    let playlistUrl = stream.playlist;
    let manifest = await readManifest(playlistUrl);
    // A master playlist can point at another master before the media list.
    // Follow a small bounded chain, then prove the first segment is readable.
    for (let depth = 0; depth < 3; depth += 1) {
      const firstUri = manifest
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("#"));
      if (!firstUri) throw new Error("HLS manifest has no media URI");
      const nextUrl = new URL(firstUri, playlistUrl).toString();
      if (manifest.includes("#EXT-X-STREAM-INF")) {
        playlistUrl = nextUrl;
        manifest = await readManifest(playlistUrl);
        continue;
      }

      const segment = await fetch(nextUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!segment.ok) {
        segment.body?.cancel().catch(() => {});
        if (isAuthRefusal(segment.status)) throw new Error(UNVERIFIABLE);
        throw new Error(`first segment returned HTTP ${segment.status}`);
      }
      const segmentStarted = performance.now();
      const reader = segment.body?.getReader();
      let sampledBytes = 0;
      if (reader) {
        while (sampledBytes < 384 * 1024) {
          const { done, value } = await reader.read();
          if (done) break;
          sampledBytes += value.byteLength;
        }
        await reader.cancel();
      }
      const sampleMs = Math.max(performance.now() - segmentStarted, 1);
      const totalMs = Math.max(performance.now() - probeStarted, 1);
      const throughputMbps = (sampledBytes * 8) / sampleMs / 1000;
      // Effective playback speed matters more than a tiny manifest lead. The
      // startup penalty breaks close ties without allowing a slow CDN that
      // answered one byte first to win the entire episode.
      return throughputMbps - totalMs / 1000;
    }
    throw new Error("HLS playlist nesting is too deep");
  }

  const firstFile = Object.values(stream.qualities)[0];
  if (!firstFile) throw new Error("file stream has no qualities");
  const response = await fetch(firstFile.url, {
    cache: "no-store",
    headers: { Range: "bytes=0-1" },
    signal: AbortSignal.timeout(5000),
  });
  const contentType = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  response.body?.cancel().catch(() => {});
  if (!response.ok) {
    if (isAuthRefusal(response.status)) throw new Error(UNVERIFIABLE);
    throw new Error(`video returned HTTP ${response.status}`);
  }
  if (
    contentType &&
    !contentType.startsWith("video/") &&
    contentType !== "application/octet-stream" &&
    contentType !== "binary/octet-stream"
  )
    throw new Error(`unsupported video content type ${contentType}`);
  return 1;
}

type Attempt = { streams: Stream[]; found: number } | { error: string };

type FluxAudioVariant = {
  id: "dub" | "sub";
  label: string;
  language: string;
  stream: Stream;
};

async function resolveAniListId(media: ScrapeMedia): Promise<number | null> {
  const mediaType = media.type === "show" ? "tv" : "movie";
  const seasonPath =
    media.type === "show" ? `/seasons/${media.season.number}` : "";
  const mappingUrl = `https://animeapi.my.id/themoviedb/${mediaType}/${encodeURIComponent(String(media.tmdbId))}${seasonPath}`;
  try {
    const mappingRes = await fetch(proxied(mappingUrl), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2500),
    });
    if (!mappingRes.ok) return null;
    const mapping = await mappingRes.json();
    const anilistId = Number(mapping?.anilist);
    return Number.isFinite(anilistId) && anilistId > 0 ? anilistId : null;
  } catch {
    return null;
  }
}

/*
 * MegaPlay only offers its own embeddable player - the stream url inside it is
 * encrypted - so it resolves to an "embed" stream that the player drives over
 * postMessage (display/megaplay.ts). All that has to be established here is
 * that the episode exists in each language, and the embed page says so itself:
 * a missing episode serves MegaPlay's error page, with no player element.
 *
 * MegaPlay refuses any request without a Referer, which a browser fetch cannot
 * set, so both lookups go through the proxy with X-Referer.
 */
const MEGAPLAY_NOT_FOUND = "episode not on MegaPlay";

function megaplaySegment(raw: any): { start: number; end: number } | undefined {
  const start = Number(raw?.start);
  const end = Number(raw?.end);
  // MegaPlay reports a missing marker as {start: 0, end: 0}
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { start, end }
    : undefined;
}

async function resolveMegaPlayEpisode(
  base: string,
  anilistId: number,
  episodeNumber: number,
  audio: "sub" | "dub",
): Promise<Stream | null> {
  const embedUrl = `${base}/stream/ani/${anilistId}/${episodeNumber}/${audio}`;
  try {
    const page = await fetch(proxied(embedUrl), {
      headers: { "X-Referer": `${window.location.origin}/` },
      signal: AbortSignal.timeout(6000),
    });
    if (!page.ok) return null;
    const fileId = /data-id="(\d+)"/.exec(await page.text())?.[1];
    if (!fileId) return null;

    const stream: any = {
      id: `megaplay-${audio}`,
      type: "embed",
      embedUrl,
      flags: [],
      captions: [],
    };
    // intro/outro markers sit in plain fields beside the encrypted source
    try {
      const sources = await fetch(
        proxied(`${base}/stream/getSources?id=${fileId}`, undefined, {
          "X-Requested-With": "XMLHttpRequest",
        }),
        {
          headers: { Accept: "application/json", "X-Referer": embedUrl },
          signal: AbortSignal.timeout(3000),
        },
      );
      if (sources.ok) {
        const payload = await sources.json();
        const intro = megaplaySegment(payload?.intro);
        const outro = megaplaySegment(payload?.outro);
        if (intro || outro) stream.fluxSkips = { intro, outro };
      }
    } catch {
      // markers are an enhancement; the episode still plays without them
    }
    return stream as Stream;
  } catch {
    return null;
  }
}

async function attemptMegaPlay(
  p: FluxProvider,
  media: ScrapeMedia,
  detectedAniListId?: number | null,
): Promise<Attempt> {
  try {
    const anilistId =
      detectedAniListId === undefined
        ? await resolveAniListId(media)
        : detectedAniListId;
    if (!anilistId) return { error: "not identified as anime" };

    const base = p.url.replace(/\/+$/, "");
    const episodeNumber = media.type === "show" ? media.episode.number : 1;
    // one page each, checked together, so both tracks are known up front
    const [dub, sub] = await Promise.all([
      resolveMegaPlayEpisode(base, anilistId, episodeNumber, "dub"),
      resolveMegaPlayEpisode(base, anilistId, episodeNumber, "sub"),
    ]);
    const preferredAudio = getPreferredAnimeAudio();
    const primary = preferredAudio === "sub" ? (sub ?? dub) : (dub ?? sub);
    if (!primary) return { error: MEGAPLAY_NOT_FOUND };

    const variants: FluxAudioVariant[] = [];
    if (dub)
      variants.push({
        id: "dub",
        label: "English (Dub)",
        language: "en",
        stream: dub,
      });
    if (sub)
      variants.push({
        id: "sub",
        label: "Japanese (Sub)",
        language: "ja",
        stream: sub,
      });
    // a copy, never primary itself - see the same note in attemptAnivexa
    const primaryWithVariants = { ...primary } as Stream;
    (primaryWithVariants as any).fluxAudioVariants = variants;
    (primaryWithVariants as any).fluxAudioVariantId =
      primary === sub ? "sub" : "dub";
    return { streams: [primaryWithVariants], found: variants.length };
  } catch (err: any) {
    return {
      error: err?.message ? String(err.message) : "anime lookup failed",
    };
  }
}

async function attemptAnivexa(
  p: FluxProvider,
  media: ScrapeMedia,
  detectedAniListId?: number | null,
): Promise<Attempt> {
  try {
    const anilistId =
      detectedAniListId === undefined
        ? await resolveAniListId(media)
        : detectedAniListId;
    if (!anilistId) return { error: "not identified as anime" };

    const openSubtitlesPromise = fetchOpenSubtitles(media);

    const base = p.url.replace(/\/+$/, "");
    const episodeNumber = media.type === "show" ? media.episode.number : 1;
    // These are the quickest broad-library providers in the self-hosted
    // aggregator. The extra three materially improve dub coverage while the
    // combined episode lookup remains fast; slow/dead adapters stay excluded.
    const episodeRes = await fetch(
      `${base}/episodes/reanime/anikoto/animegg/anineko/mkissa/anidbapp/2dhive/${anilistId}?map=false`,
      {
        headers: { Accept: "application/json" },
        // seven adapters behind one request: a single cold one must not be
        // able to hold the entire anime path open indefinitely
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!episodeRes.ok)
      return {
        error: `anime episode lookup returned HTTP ${episodeRes.status}`,
      };
    const episodeData = await episodeRes.json();

    // adapters the ranker proved this browser cannot decode (AAC Main etc.)
    const unplayableAdapters = new Set<string>();
    const adapterOf = (route: string) =>
      /^watch\/([^/]+)\//.exec(String(route ?? ""))?.[1] ?? "";

    const candidates = (audio: "sub" | "dub") =>
      Object.values(episodeData ?? {}).flatMap((provider: any) => {
        const list = provider?.episodes?.[audio];
        if (!Array.isArray(list)) return [];
        return list.filter(
          (episode: any) =>
            Number(episode?.number) === Number(episodeNumber) &&
            !unplayableAdapters.has(adapterOf(episode?.id)),
        );
      });

    const resolveFastest = async (
      audio: "sub" | "dub",
    ): Promise<Stream | null> => {
      const options = candidates(audio).slice(0, 10);
      if (!options.length) return null;
      let unverifiedHlsFallback: Stream | null = null;
      const resolveOption = async (
        episode: any,
      ): Promise<{ stream: Stream; score: number }> => {
        const route = String(episode?.id ?? "").replace(/^\/+/, "");
        if (!route.startsWith("watch/")) throw new Error("bad watch route");
        const response = await fetch(`${base}/${route}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const { streams } = normaliseStreams(payload);
        if (!streams.length) throw new Error("no playable stream");
        const usable = streams.filter(
          (rawStream) => !isCodecBanned(refererHostOfStream(rawStream)),
        );
        if (!usable.length) throw new Error("all mirrors codec-banned");
        const playableStreams = usable
          .slice(0, 4)
          .map((rawStream) => maybeProxyStream(p, rawStream));
        playableStreams.forEach((playable) => {
          (playable as any).fluxAdapter = adapterOf(route);
        });
        // the unranked fallback path should still get skip markers
        const marker = payload?.streams?.[0];
        if (marker?.intro || marker?.outro)
          playableStreams.forEach((playable) => {
            (playable as any).fluxSkips = {
              intro: marker.intro ?? undefined,
              outro: marker.outro ?? undefined,
            };
          });
        // The browser can play some signed HLS manifests that reject our
        // separate readiness request (short-lived tokens, HEAD/range policy,
        // or host anti-bot behavior). Preserve the first genuine HLS result
        // as a last resort; embeds and HTML files were already removed.
        unverifiedHlsFallback ??=
          playableStreams.find((stream) => stream.type === "hls") ?? null;
        return Promise.any(
          playableStreams.map(async (stream) => ({
            stream,
            score: await verifyStreamReady(stream),
          })),
        );
      };

      // AniKoto and AniDB consistently expose direct HLS mirrors rather than
      // iframe-only fallbacks. Benchmark both over the same relay path the
      // player uses and choose actual segment throughput, not first response.
      const preferredOptions = options.filter((episode: any) =>
        /^watch\/(anikoto|anidbapp)\//.test(String(episode?.id ?? "")),
      );
      if (preferredOptions.length) {
        const ranked = await Promise.allSettled(
          preferredOptions.map((episode: any) =>
            Promise.race([
              resolveOption(episode),
              new Promise<never>((_resolve, reject) => {
                setTimeout(
                  () => reject(new Error("throughput probe timed out")),
                  2500,
                );
              }),
            ]),
          ),
        );
        const ready = ranked
          .filter(
            (
              result,
            ): result is PromiseFulfilledResult<{
              stream: Stream;
              score: number;
            }> => result.status === "fulfilled",
          )
          .map((result) => result.value)
          .sort((a, b) => b.score - a.score);
        if (ready.length) return ready[0].stream;
      }
      try {
        const result = await Promise.any(options.map(resolveOption));
        // eslint-disable-next-line no-console
        console.info(
          `[flux] anime ${audio}: fallback race won by ${
            (result.stream as any)?.fluxAdapter ?? "unknown adapter"
          }`,
        );
        return result.stream;
      } catch {
        if (unverifiedHlsFallback)
          // eslint-disable-next-line no-console
          console.info(`[flux] anime ${audio}: using unverified hls fallback`);
        return unverifiedHlsFallback;
      }
    };

    /*
     * Ask Anivexa for a pre-ranked mirror. It runs the same throughput probe
     * this file used to run in the browser - but once, server-side, cached for
     * minutes. That removes several 384 KB sample downloads from the client
     * before playback, which on a school connection was most of the wait.
     */
    const resolveRanked = async (
      audio: "sub" | "dub",
    ): Promise<Stream | null> => {
      try {
        const response = await fetch(
          `${base}/rank/${anilistId}/${audio}/${episodeNumber}`,
          {
            headers: { Accept: "application/json" },
            // never reuse a cached ranking: it may predate a codec verdict
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!response.ok) return null;
        const payload = await response.json();
        const ranked = Array.isArray(payload?.ranked) ? payload.ranked : [];

        // remember this before anything else: even if nothing here is usable,
        // the fallback path must not go and pick the undecodable mirror
        ranked.forEach((entry: any) => {
          if (entry?.playable === false && entry?.adapter)
            unplayableAdapters.add(String(entry.adapter));
        });

        let best: any = null;
        let stream: Stream | null = null;
        const hasVerdict = ranked.some(
          (entry: any) => typeof entry?.playable === "boolean",
        );
        for (const entry of ranked.slice(0, 3)) {
          if (!entry?.watch) continue;
          if (entry.playable === false) continue;
          // an entry with no verdict from a server that gives verdicts for
          // others, or a whole response with none, is not to be trusted
          if (!hasVerdict) continue;
          const { streams } = normaliseStreams(entry.watch);
          if (!streams.length) continue;
          // a mirror this browser already failed to decode is never a
          // candidate again, however well it ranked
          if (isCodecBanned(refererHostOfStream(streams[0]))) continue;
          const candidate = maybeProxyStream(p, streams[0]);
          // cheap liveness check through the exact url the player will use
          if (await manifestReachable(candidate)) {
            best = entry;
            stream = candidate;
            break;
          }
        }
        // everything failed its check: still better to hand back the top pick
        // than nothing, the player has its own retry
        if (!stream) {
          const usable = ranked.find(
            (entry: any) => entry?.watch && entry.playable === true,
          );
          if (usable) {
            const { streams } = normaliseStreams(usable.watch);
            if (streams.length) {
              best = usable;
              stream = maybeProxyStream(p, streams[0]);
            }
          }
        }
        if (!stream || !best) return null;
        // which adapter actually won is worth surfacing; the URL never is
        // eslint-disable-next-line no-console
        console.info(
          `[flux] anime ${audio}: adapter=${best.adapter} host=${best.host} ` +
            `mbps=${best.mbps} cached=${payload.cached === true}`,
        );
        (stream as any).fluxAdapter = best.adapter;
        // intro/outro markers ride along on the winning mirror
        const marker = best.watch?.streams?.[0];
        if (marker?.intro || marker?.outro)
          (stream as any).fluxSkips = {
            intro: marker.intro ?? undefined,
            outro: marker.outro ?? undefined,
          };
        warmedRankings.add(`${anilistId}:${episodeNumber}:${audio}`);
        return stream;
      } catch {
        return null;
      }
    };

    const preferredAudio = getPreferredAnimeAudio();
    const alternateAudio = preferredAudio === "sub" ? "dub" : "sub";

    /*
     * Both audio tracks start together.
     *
     * Only the selected one gates playback - the alternate gets a bounded
     * window, so it is normally present in the variant list without ever
     * delaying the video. This matters because the variant list is what the
     * audio switcher reads: a track missing from it cannot be selected at
     * all, which is why switching used to fail and why switching *back* was
     * even worse - each resolve advertised only whichever track it had
     * happened to await.
     */
    const resolveTrack = async (
      audio: "sub" | "dub",
    ): Promise<Stream | null> => {
      const ranked = await resolveRanked(audio);
      return ranked ?? resolveFastest(audio);
    };

    const preferredPromise = resolveTrack(preferredAudio);

    const alternateCacheKey = alternateKey(
      anilistId,
      episodeNumber,
      alternateAudio,
    );
    let alternatePromise: Promise<Stream | null> | null =
      recallAlternate(alternateCacheKey);
    if (!alternatePromise && candidates(alternateAudio).length) {
      alternatePromise = resolveTrack(alternateAudio).catch(() => null);
      rememberAlternate(alternateCacheKey, alternatePromise);
    }

    const preferredStream = await preferredPromise;

    // The alternate never blocks playback. If it misses the window it keeps
    // running in the cache, so the switch picks it up finished moments later.
    const alternateStream = alternatePromise
      ? await Promise.race([
          alternatePromise,
          new Promise<Stream | null>((resolve) => {
            setTimeout(() => resolve(null), ALTERNATE_WINDOW_MS);
          }),
        ])
      : null;

    // captions are an enhancement; a slow subtitle host must never be the
    // reason a video does not start
    const openSubtitles = await Promise.race([
      openSubtitlesPromise.catch(() => [] as Caption[]),
      new Promise<Caption[]>((resolve) => {
        setTimeout(() => resolve([]), 6000);
      }),
    ]);
    const resolvedDub =
      preferredAudio === "dub" ? preferredStream : alternateStream;
    const resolvedSub =
      preferredAudio === "sub" ? preferredStream : alternateStream;
    const dub = resolvedDub ? mergeCaptions(resolvedDub, openSubtitles) : null;
    const sub = resolvedSub ? mergeCaptions(resolvedSub, openSubtitles) : null;
    const primary = preferredAudio === "sub" ? (sub ?? dub) : (dub ?? sub);
    if (!primary) return { error: "no playable anime stream" };

    const variants: FluxAudioVariant[] = [];
    if (dub)
      variants.push({
        id: "dub",
        label: "English (Dub)",
        language: "en",
        stream: dub,
      });
    if (sub)
      variants.push({
        id: "sub",
        label: "Japanese (Sub)",
        language: "ja",
        stream: sub,
      });
    // Do not attach variants directly to `primary`: when dub is primary,
    // variants[0].stream is that exact same object. The player recursively
    // converts audio variants, so mutating it here creates a self-reference
    // and eventually throws a stack overflow during playback handoff.
    const primaryWithVariants = { ...primary } as Stream;
    (primaryWithVariants as any).fluxAudioVariants = variants;
    (primaryWithVariants as any).fluxAudioVariantId =
      primary === sub ? "sub" : "dub";
    return { streams: [primaryWithVariants], found: variants.length };
  } catch (err: any) {
    return {
      error: err?.message ? String(err.message) : "anime lookup failed",
    };
  }
}

async function attemptKdesa(
  p: FluxProvider,
  media: ScrapeMedia,
): Promise<Attempt> {
  if (!p.kdesa_source) return { error: "KDesa source is not configured" };
  try {
    const providers = await getFluxKdesaProviders();
    const output = await providers.runSourceScraper({
      id: p.kdesa_source,
      media,
      disableOpensubtitles: false,
    });
    if (output.stream?.length)
      return {
        streams: output.stream as Stream[],
        found: output.stream.length,
      };
    for (const embed of output.embeds ?? []) {
      try {
        const embedded = await providers.runEmbedScraper({
          id: embed.embedId,
          url: embed.url,
          disableOpensubtitles: false,
        });
        if (embedded.stream?.length)
          return {
            streams: embedded.stream as Stream[],
            found: embedded.stream.length,
          };
      } catch {
        // Keep trying the remaining servers returned by this source.
      }
    }
    return { error: "no playable stream" };
  } catch (err: any) {
    return {
      error: err?.message ? String(err.message) : "KDesa source failed",
    };
  }
}

let fallbackRun = 0;
let fallbackOutputs: RunOutput[] = [];

/** Return the next source that finished the same concurrent race. */
export function takeNextFluxOutput(
  currentSourceId: string | null,
): RunOutput | null {
  const index = fallbackOutputs.findIndex(
    (output) => output.sourceId !== currentSourceId,
  );
  if (index < 0) return null;
  return fallbackOutputs.splice(index, 1)[0];
}

async function attemptPstream(
  p: FluxProvider,
  media: ScrapeMedia,
): Promise<Attempt> {
  if (!p.pstream_source) return { error: "P-Stream source is not configured" };
  try {
    const providers = getFluxPstreamProviders();
    const output = await providers.runSourceScraper({
      id: p.pstream_source,
      // Both packages describe the same runtime object, but Afterstream adds
      // optional season metadata to its TypeScript declaration.
      media: media as any,
      disableOpensubtitles: false,
    });
    if (output.stream?.length)
      return {
        streams: output.stream as unknown as Stream[],
        found: output.stream.length,
      };
    for (const embed of output.embeds ?? []) {
      try {
        const embedded = await providers.runEmbedScraper({
          id: embed.embedId,
          url: embed.url,
          disableOpensubtitles: false,
        });
        if (embedded.stream?.length)
          return {
            streams: embedded.stream as unknown as Stream[],
            found: embedded.stream.length,
          };
      } catch {
        // A dead embed must not discard another one returned by the source.
      }
    }
    return { error: "no playable stream" };
  } catch (err: any) {
    return {
      error: err?.message ? String(err.message) : "P-Stream source failed",
    };
  }
}

async function attemptNative(
  p: FluxProvider,
  media: ScrapeMedia,
): Promise<Attempt> {
  if (!p.movie_web_source) return { error: "native source is not configured" };
  try {
    const providers = getFluxNativeProviders();
    const output = await providers.runSourceScraper({
      id: p.movie_web_source,
      media,
      disableOpensubtitles: false,
    });
    if (output.stream?.length)
      return { streams: output.stream, found: output.stream.length };
    for (const embed of output.embeds ?? []) {
      try {
        const embedded = await providers.runEmbedScraper({
          id: embed.embedId,
          url: embed.url,
          disableOpensubtitles: false,
        });
        if (embedded.stream?.length)
          return { streams: embedded.stream, found: embedded.stream.length };
      } catch {
        // One broken embed must not discard another discovered by the source.
      }
    }
    return { error: "no playable stream" };
  } catch (err: any) {
    return {
      error: err?.message ? String(err.message) : "native source failed",
    };
  }
}

function resolverBody(p: FluxProvider, media: ScrapeMedia) {
  const isShow = media.type === "show";
  return {
    type: isShow ? "tv" : "movie",
    tmdbId: String(media.tmdbId),
    imdbId: media.imdbId ?? "",
    title: media.title,
    releaseYear: String(media.releaseYear),
    ...(isShow ? { s: media.season.number, e: media.episode.number } : {}),
    providerIds: p.resolver_provider ? [p.resolver_provider] : [],
  };
}

async function attempt(
  p: FluxProvider,
  url: string,
  media: ScrapeMedia,
): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(p));
  const requestUrl = p.use_proxy === false ? url : proxied(url);

  try {
    const usePost = p.request_method === "POST";
    const res = await fetch(requestUrl, {
      signal: controller.signal,
      redirect: "follow",
      method: usePost ? "POST" : "GET",
      ...(usePost
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(resolverBody(p, media)),
          }
        : {}),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };

    const finalUrl = res.headers.get("X-Final-Destination") || url;
    const contentType = (res.headers.get("content-type") || "").trim();

    // Never download the media itself - only metadata is read.
    if (M3U8.test(contentType) || looksLikePlaylist(finalUrl)) {
      res.body?.cancel().catch(() => {});
      return { streams: [maybeProxyStream(p, hls(finalUrl))], found: 1 };
    }
    if (MP4.test(contentType) || looksLikeFile(finalUrl)) {
      res.body?.cancel().catch(() => {});
      return { streams: [maybeProxyStream(p, file(finalUrl))], found: 1 };
    }

    const body = await res.text();

    if (JSONISH.test(contentType) || /^\s*[[{]/.test(body)) {
      try {
        const { streams, count } = normaliseStreams(JSON.parse(body));
        if (streams.length)
          return {
            streams: streams.map((s) => maybeProxyStream(p, s)),
            found: count,
          };
        if (count === 0) return { error: "no streams in the response" };
        return { error: `${count} entries returned but none were playable` };
      } catch {
        /* not json after all */
      }
    }

    if (HTMLISH.test(contentType) || /<html/i.test(body)) {
      const found = scrapeHtml(body, finalUrl);
      if (found) return { streams: [maybeProxyStream(p, found)], found: 1 };
      return { error: "returned a web page with no stream in it" };
    }

    return {
      error: `unrecognised response (${contentType || "no content-type"})`,
    };
  } catch (err: any) {
    if (err?.name === "AbortError")
      return { error: `timed out after ${timeoutMs(p) / 1000}s` };
    return { error: err?.message ? String(err.message) : "request failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function runFluxProviders(opts: {
  media: ScrapeMedia;
  providers: FluxProvider[];
  events?: FluxEvents;
}): Promise<RunOutput | null> {
  const { media, providers, events } = opts;
  // Diagnostic only: where the wall clock actually goes. Names and durations
  // only - never a url, host or ip.
  const runStart = performance.now();
  const since = () => Math.round(performance.now() - runStart);
  fallbackRun += 1;
  const runId = fallbackRun;
  fallbackOutputs = [];
  const animeResolver = providers.find(isAnimeResolver);
  const detectedAniListId = animeResolver
    ? await resolveAniListId(media)
    : null;
  console.info(
    `[flux-timing] anime check done at ${since()}ms (anime=${
      detectedAniListId ? "yes" : "no"
    }, sources=${providers.length})`,
  );

  events?.init?.({
    sourceIds: providers.map((p) => p.id),
    sourceNames: Object.fromEntries(providers.map((p) => [p.id, p.name])),
  });

  const runOne = async (p: FluxProvider): Promise<RunOutput> => {
    events?.start?.(p.id);

    if (p.media_types && !p.media_types.includes(media.type)) {
      const reason = `${media.type} is not supported by this source`;
      events?.update?.({
        id: p.id,
        status: "notfound",
        reason,
        percentage: 100,
      });
      throw new Error(reason);
    }

    if (isAnimeResolver(p)) {
      events?.update?.({ id: p.id, status: "pending", percentage: 20 });
      const result = await Promise.race<Attempt>([
        p.megaplay
          ? attemptMegaPlay(p, media, detectedAniListId)
          : attemptAnivexa(p, media, detectedAniListId),
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ error: `timed out after ${timeoutMs(p) / 1000}s` }),
            timeoutMs(p),
          );
        }),
      ]);
      if ("streams" in result && result.streams.length) {
        events?.update?.({ id: p.id, status: "success", percentage: 100 });
        return { sourceId: p.id, stream: result.streams[0] };
      }
      const reason = "error" in result ? result.error : "no playable stream";
      events?.update?.({
        id: p.id,
        status:
          reason === "not identified as anime" || reason === MEGAPLAY_NOT_FOUND
            ? "notfound"
            : "failure",
        reason,
        percentage: 100,
      });
      throw new Error(reason);
    }

    if (p.kdesa_source) {
      events?.update?.({ id: p.id, status: "pending", percentage: 35 });
      const result = await Promise.race<Attempt>([
        attemptKdesa(p, media),
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ error: `timed out after ${timeoutMs(p) / 1000}s` }),
            timeoutMs(p),
          );
        }),
      ]);
      if ("streams" in result && result.streams.length) {
        events?.update?.({ id: p.id, status: "success", percentage: 100 });
        return {
          sourceId: p.id,
          stream: maybeProxyStream(p, result.streams[0]),
        };
      }
      const reason = "error" in result ? result.error : "no playable stream";
      events?.update?.({
        id: p.id,
        status: "failure",
        reason,
        percentage: 100,
      });
      throw new Error(reason);
    }

    if (p.pstream_source) {
      events?.update?.({ id: p.id, status: "pending", percentage: 35 });
      const pstreamResult = await Promise.race<Attempt>([
        attemptPstream(p, media),
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                error: `timed out after ${timeoutMs(p) / 1000}s`,
              }),
            timeoutMs(p),
          );
        }),
      ]);
      if ("streams" in pstreamResult && pstreamResult.streams.length) {
        events?.update?.({ id: p.id, status: "success", percentage: 100 });
        return {
          sourceId: p.id,
          stream: maybeProxyStream(p, pstreamResult.streams[0]),
        };
      }
      const reason =
        "error" in pstreamResult ? pstreamResult.error : "no playable stream";
      events?.update?.({
        id: p.id,
        status: "failure",
        reason,
        percentage: 100,
      });
      throw new Error(reason);
    }

    if (p.movie_web_source) {
      events?.update?.({ id: p.id, status: "pending", percentage: 35 });
      const nativeResult = await Promise.race<Attempt>([
        attemptNative(p, media),
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                error: `timed out after ${timeoutMs(p) / 1000}s`,
              }),
            timeoutMs(p),
          );
        }),
      ]);
      if ("streams" in nativeResult && nativeResult.streams.length) {
        events?.update?.({ id: p.id, status: "success", percentage: 100 });
        return {
          sourceId: p.id,
          stream: maybeProxyStream(p, nativeResult.streams[0]),
        };
      }
      const nativeReason =
        "error" in nativeResult ? nativeResult.error : "no playable stream";
      events?.update?.({
        id: p.id,
        status: "failure",
        reason: nativeReason,
        percentage: 100,
      });
      throw new Error(nativeReason);
    }

    const gaps = missingFields(p, media);
    if (gaps.length) {
      events?.update?.({
        id: p.id,
        status: "notfound",
        reason: `this title has no ${gaps.join(" or ")}`,
        percentage: 100,
      });
      throw new Error(`this title has no ${gaps.join(" or ")}`);
    }

    const primary = buildUrl(p, media);
    if (!primary) {
      events?.update?.({
        id: p.id,
        status: "notfound",
        reason: `no ${media.type === "show" ? "tv" : "movie"} pattern configured`,
        percentage: 100,
      });
      throw new Error("media type is not supported");
    }

    events?.update?.({ id: p.id, status: "pending", percentage: 35 });

    let result = await attempt(p, primary, media);

    if ("error" in result) {
      const alias = buildUrl(p, media, true);
      if (alias) {
        events?.update?.({ id: p.id, status: "pending", percentage: 70 });
        const second = await attempt(p, alias, media);
        if (!("error" in second)) result = second;
      }
    }

    if ("streams" in result && result.streams.length) {
      events?.update?.({ id: p.id, status: "success", percentage: 100 });
      // count only, never a url
      console.info(
        `[flux] ${p.name}: playing 1 of ${result.found} stream(s) returned`,
      );
      return { sourceId: p.id, stream: result.streams[0] };
    }

    const reason = "error" in result ? result.error : "no playable stream";
    // name only, never the url
    console.warn(`[flux] ${p.name}: ${reason}`);
    events?.update?.({
      id: p.id,
      status: "failure",
      reason,
      percentage: 100,
    });
    throw new Error(reason);
  };

  const recordOutput = (provider: FluxProvider) => {
    const started = performance.now();
    const took = () => Math.round(performance.now() - started);
    return runOne(provider)
      .then((output) => {
        console.info(
          `[flux-timing] ${provider.name}: ok in ${took()}ms (at ${since()}ms)`,
        );
        if (
          runId === fallbackRun &&
          !fallbackOutputs.some((item) => item.sourceId === output.sourceId)
        )
          fallbackOutputs.push(output);
        return output;
      })
      .catch((err) => {
        console.info(
          `[flux-timing] ${provider.name}: failed in ${took()}ms (at ${since()}ms)`,
        );
        throw err;
      });
  };

  const standardProviders = providers.filter(
    (provider) => !isAnimeResolver(provider),
  );

  /*
   * Anivexa is *preferred* for anime - it is the only source carrying dub/sub
   * variants and skip markers - but preference must not mean exclusivity.
   *
   * It used to be an exclusive first stage: every other source sat idle until
   * Anivexa either won or its window elapsed. Measured on a real title, that
   * cost 10s of dead air before the generic race was even allowed to begin,
   * and the source that ultimately played needed only 2.9s.
   *
   * So: everything starts at once, and Anivexa gets a short head start rather
   * than a monopoly. If it resolves inside that window we use it. If it does
   * not, whichever source finishes first wins - Anivexa included, since it is
   * still running.
   */
  const ANIME_HEAD_START_MS = 3_000;

  const raceSet = detectedAniListId ? standardProviders : providers;
  const standardRace = raceSet.length
    ? Promise.any(raceSet.map(recordOutput))
    : null;
  // an unhandled rejection here would be noise; the value is read below
  standardRace?.catch(() => {});

  const settle = async (
    entries: (Promise<RunOutput> | null)[],
  ): Promise<RunOutput | null> => {
    const live = entries.filter(Boolean) as Promise<RunOutput>[];
    if (!live.length) return null;
    try {
      const winner = await Promise.any(live);
      console.info(
        `[flux-timing] RESOLVED by ${winner.sourceId} at ${since()}ms total`,
      );
      return winner;
    } catch {
      console.info(`[flux-timing] ALL SOURCES FAILED at ${since()}ms`);
      return null;
    }
  };

  if (detectedAniListId && animeResolver) {
    const animeAttempt = recordOutput(animeResolver);
    animeAttempt.catch(() => {});
    try {
      const animeOutput = await Promise.race([
        animeAttempt,
        new Promise<RunOutput>((_resolve, reject) => {
          window.setTimeout(
            () => reject(new Error("anime head start elapsed")),
            ANIME_HEAD_START_MS,
          );
        }),
      ]);
      console.info(
        `[flux-timing] RESOLVED by ${animeOutput.sourceId} at ${since()}ms total (anime preferred)`,
      );
      return animeOutput;
    } catch {
      console.info(
        `[flux-timing] anime head start over at ${since()}ms; first source to finish now wins`,
      );
      // Anivexa is still in flight and can still win on merit.
      return settle([animeAttempt, standardRace]);
    }
  }

  return settle([standardRace]);
}
