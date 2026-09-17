import { get } from "@/backend/metadata/tmdb";
import { conf } from "@/setup/config";
import { FeedItem } from "@/utils/algorithm";

/*
 * Extra material the hero needs beyond the basic feed item.
 *
 * All three lookups are best-effort: a failure returns null and the hero
 * simply falls back to type, a still image, or a neutral accent. Nothing here
 * is allowed to break the page.
 */

function params(extra?: Record<string, string>) {
  return {
    api_key: conf().TMDB_READ_API_KEY,
    language: "en-US",
    ...(extra ?? {}),
  };
}

/**
 * The film's own title artwork. This is the single biggest difference between
 * a page that looks like a website and one that looks like cinema - it is the
 * lettering from the actual campaign rather than our UI font.
 */
export async function fetchTitleLogo(item: FeedItem): Promise<string | null> {
  const path = item.type === "show" ? "tv" : "movie";
  try {
    const data = await get<any>(
      `/${path}/${item.id}/images`,
      // language must be blank here or TMDB filters the logo list to nothing
      { api_key: conf().TMDB_READ_API_KEY, include_image_language: "en,null" },
    );
    const logos = (data?.logos ?? []).filter(
      (l: any) => l.file_path && l.iso_639_1 === "en",
    );
    if (!logos.length) return null;
    // PNGs carry transparency; SVGs sometimes render inconsistently in <img>
    const png = logos.filter((l: any) => !l.file_path.endsWith(".svg"));
    const pool = png.length ? png : logos;
    pool.sort((a: any, b: any) => (b.width ?? 0) - (a.width ?? 0));
    return `https://image.tmdb.org/t/p/w500${pool[0].file_path}`;
  } catch {
    return null;
  }
}

/** YouTube key for a muted background trailer, if there is an official one. */
export async function fetchTrailerKey(item: FeedItem): Promise<string | null> {
  const path = item.type === "show" ? "tv" : "movie";
  try {
    const data = await get<any>(`/${path}/${item.id}/videos`, params());
    const vids = (data?.results ?? [])
      .filter(
        (v: any) =>
          v.site === "YouTube" &&
          v.key &&
          (v.type === "Trailer" || v.type === "Teaser"),
      )
      .sort((a: any, b: any) => {
        const score = (video: any) =>
          (video.official ? 100 : 0) +
          (video.type === "Trailer" ? 30 : 0) +
          (video.iso_639_1 === "en" ? 10 : 0) +
          Math.min(Number(video.size) || 0, 1080) / 1080;
        return score(b) - score(a);
      });
    const pick = vids[0];
    return pick?.key ?? null;
  } catch {
    return null;
  }
}

export interface Accent {
  /** "r, g, b" so it can be dropped straight into rgb()/rgba() */
  rgb: string;
}

const accentCache = new Map<string, Accent | null>();

/**
 * Pull a dominant, reasonably saturated colour out of a backdrop so the rest
 * of the page can take on the film's temperature. Falls back to null if the
 * canvas ends up tainted, which just means the hero keeps its neutral wash.
 */
export function extractAccent(src: string): Promise<Accent | null> {
  const cached = accentCache.get(src);
  if (cached !== undefined) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const done = (a: Accent | null) => {
      accentCache.set(src, a);
      resolve(a);
    };
    const img = new Image();
    // image.tmdb.org does not answer CORS requests, so a crossOrigin load just
    // hangs and the canvas would be tainted anyway. Going through our own
    // same-origin /proxy makes the pixels readable, and a w300 copy is plenty
    // for averaging a colour.
    img.onerror = () => done(null);
    img.onload = () => {
      try {
        const w = 40;
        const h = Math.max(1, Math.round((img.height / img.width) * w));
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        if (!ctx) return done(null);
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);

        let r = 0;
        let g = 0;
        let b = 0;
        let weight = 0;
        for (let i = 0; i < data.length; i += 4) {
          const cr = data[i];
          const cg = data[i + 1];
          const cb = data[i + 2];
          const max = Math.max(cr, cg, cb);
          const min = Math.min(cr, cg, cb);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = (max + min) / 2;
          // ignore near-black and near-white, and favour saturated pixels:
          // averaging everything equally just yields mud
          if (lum < 26 || lum > 236) continue;
          const wgt = sat * sat + 0.06;
          r += cr * wgt;
          g += cg * wgt;
          b += cb * wgt;
          weight += wgt;
        }
        if (weight === 0) return done(null);
        let out = [r / weight, g / weight, b / weight];

        // push it somewhere usable as a light source: lift dull colours,
        // rein in anything blinding
        const mx = Math.max(...out);
        if (mx < 90 && mx > 0) out = out.map((c) => (c * 90) / mx);
        if (mx > 210) out = out.map((c) => (c * 210) / mx);

        return done({ rgb: out.map((c) => Math.round(c)).join(", ") });
      } catch {
        // tainted canvas - not fatal, the hero just stays neutral
        return done(null);
      }
    };
    img.src = `/proxy?destination=${encodeURIComponent(
      src.replace(/\/t\/p\/w\d+\//, "/t/p/w300/"),
    )}`;
  });
}

/** Decode before swapping so a slide never appears half-painted. */
export function preloadBackdrop(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const anyImg = img as any;
      if (typeof anyImg.decode === "function") {
        anyImg.decode().then(
          () => resolve(),
          () => resolve(),
        );
      } else resolve();
    };
    img.onerror = () => resolve();
    img.src = src;
  });
}
