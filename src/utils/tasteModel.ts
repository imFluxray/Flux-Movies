import { get } from "@/backend/metadata/tmdb";
import { conf } from "@/setup/config";
import {
  RatedTitle,
  Reaction,
  TasteFeature,
  ratedKey,
} from "@/stores/tasteProfile";
import { FeedItem, toFeedItem } from "@/utils/algorithm";
import { SUBGENRES, SUBGENRE_BY_ID } from "@/utils/subgenres";

/*
 * The taste finder's model.
 *
 * Each rated title is broken into features - its genres, TMDB keywords,
 * original language, decade, film or series, and whether it is anime - and
 * the answer adds its weight to every one of them. A feature's affinity is
 * that running total shrunk towards zero until it has been seen a few times,
 * so one loved title cannot define a taste by itself.
 *
 * Choosing what to show is explore-then-exploit. The first answers range over
 * random genres and named subgenres (utils/subgenres) to find where the taste
 * lies; after that most picks come from TMDB queries built out of the
 * strongest likes and dislikes, with enough randomness left in that it keeps
 * probing rather than settling into one groove.
 *
 * The functions from buildModel down are not TMDB-specific: they work on any
 * feature keys, which is how the anime model (utils/animeTaste) reuses them.
 */

type Kind = FeedItem["type"];
type Query = Record<string, string>;

export interface GenreIndex {
  movie: number[];
  show: number[];
  names: Record<number, string>;
}

export interface FeatureStat {
  key: string;
  label: string;
  affinity: number;
  count: number;
}

export type Model = Map<string, FeatureStat>;

export interface Candidate {
  item: FeedItem;
  /** the features readable straight off a discover result */
  keys: string[];
  score: number;
}

/** real answers needed before picks lean on the model rather than on chance */
export const SIGNAL_TO_EXPLOIT = 6;

const REACTION_VALUE: Record<Reaction, number> = {
  love: 2,
  like: 1,
  dislike: -1.5,
  skip: 0,
};
const ANIMATION_GENRE = 16;
// News, Soap, Talk and TV Movie say little about anyone's taste
const EXPLORE_SKIP = new Set([10763, 10766, 10767, 10770]);
// how often an exploring pick comes from a named subgenre rather than a genre
const SUBGENRE_EXPLORE_SHARE = 0.45;

function tmdbKind(kind: Kind) {
  return kind === "show" ? "tv" : "movie";
}

function randomInt(max: number) {
  return Math.floor(Math.random() * max);
}

function withKey(query: Query): Query {
  return {
    api_key: conf().TMDB_READ_API_KEY ?? "",
    include_adult: "false",
    language: "en-US",
    ...query,
  };
}

let languageNames: Intl.DisplayNames | null = null;
function languageLabel(code: string): string {
  try {
    languageNames ??= new Intl.DisplayNames(["en"], { type: "language" });
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function yearOf(raw: any): number | null {
  const year = Number(
    String(raw?.release_date ?? raw?.first_air_date ?? "").slice(0, 4),
  );
  return year > 1800 ? year : null;
}

function isSubgenreKey(key: string): boolean {
  return key.startsWith("k:") && SUBGENRE_BY_ID.has(Number(key.slice(2)));
}

/** Features available without another request: works on discover results and details. */
export function quickFeatures(raw: any, kind: Kind): string[] {
  const genreIds: number[] =
    raw?.genre_ids ?? (raw?.genres ?? []).map((genre: any) => genre.id);
  const keys = [`t:${kind}`, ...genreIds.map((id) => `g:${id}`)];
  if (raw?.original_language) keys.push(`l:${raw.original_language}`);
  const year = yearOf(raw);
  if (year) keys.push(`e:${Math.floor(year / 10) * 10}`);
  if (genreIds.includes(ANIMATION_GENRE) && raw?.original_language === "ja")
    keys.push("a:anime");
  return keys;
}

function labelFor(key: string, genres: GenreIndex): string {
  const value = key.slice(2);
  switch (key[0]) {
    case "t":
      return value === "show" ? "Series" : "Movies";
    case "g":
      return genres.names[Number(value)] ?? "Genre";
    case "l":
      return languageLabel(value);
    case "e":
      return `${value}s`;
    case "a":
      return "Anime";
    case "k":
      return SUBGENRE_BY_ID.get(Number(value))?.name ?? "Keyword";
    default:
      return value;
  }
}

export function fallbackFeatures(
  keys: string[],
  genres: GenreIndex,
): TasteFeature[] {
  return keys.map((key) => ({ key, label: labelFor(key, genres) }));
}

/** Everything about one title, keywords included, for the card being rated. */
export async function titleFeatures(
  item: FeedItem,
  genres: GenreIndex,
): Promise<TasteFeature[]> {
  const data = await get<any>(
    `/${tmdbKind(item.type)}/${item.id}`,
    withKey({ append_to_response: "keywords" }),
  );
  const features = fallbackFeatures(quickFeatures(data, item.type), genres);
  // films list their keywords under "keywords", series under "results"
  const keywords: any[] =
    data?.keywords?.keywords ?? data?.keywords?.results ?? [];
  keywords.slice(0, 15).forEach((keyword) => {
    features.push({
      key: `k:${keyword.id}`,
      // a named subgenre reads better than TMDB's lower-case keyword
      label: SUBGENRE_BY_ID.get(keyword.id)?.name ?? keyword.name,
    });
  });
  return features;
}

/** Only the chips worth showing on a card: genres and named subgenres. */
export function displayTags(features: TasteFeature[]): TasteFeature[] {
  const named = features.filter(
    (feature) => feature.key.startsWith("g:") || isSubgenreKey(feature.key),
  );
  const rest = features.filter(
    (feature) => feature.key.startsWith("k:") && !isSubgenreKey(feature.key),
  );
  return [...named, ...rest];
}

export async function loadGenreIndex(): Promise<GenreIndex> {
  const [movie, tv] = await Promise.all([
    get<any>("/genre/movie/list", withKey({})),
    get<any>("/genre/tv/list", withKey({})),
  ]);
  const names: Record<number, string> = {};
  [...(movie?.genres ?? []), ...(tv?.genres ?? [])].forEach((genre: any) => {
    names[genre.id] = genre.name;
  });
  return {
    movie: (movie?.genres ?? []).map((genre: any) => genre.id),
    show: (tv?.genres ?? []).map((genre: any) => genre.id),
    names,
  };
}

export function buildModel(ratings: RatedTitle[]): Model {
  const totals = new Map<
    string,
    { label: string; sum: number; count: number }
  >();
  ratings.forEach((rating) => {
    const value = REACTION_VALUE[rating.reaction];
    if (!value) return;
    rating.features.forEach((feature) => {
      const entry = totals.get(feature.key) ?? {
        label: feature.label,
        sum: 0,
        count: 0,
      };
      entry.sum += value;
      entry.count += 1;
      totals.set(feature.key, entry);
    });
  });
  const model: Model = new Map();
  totals.forEach((entry, key) => {
    model.set(key, {
      key,
      label: entry.label,
      count: entry.count,
      // one imaginary neutral answer: anything seen once stays tentative
      affinity: entry.sum / (entry.count + 1),
    });
  });
  return model;
}

export function tasteSummary(model: Model): {
  loves: FeatureStat[];
  avoids: FeatureStat[];
} {
  const stats = [...model.values()].filter((stat) => {
    if (stat.count < 2 || stat.key.startsWith("t:")) return false;
    // a stray TMDB keyword ("gold", "army") needs more evidence than a named
    // subgenre before it is presented as part of someone's taste
    if (stat.key.startsWith("k:") && !isSubgenreKey(stat.key))
      return stat.count >= 3;
    return true;
  });
  const weight = (stat: FeatureStat) =>
    stat.affinity * Math.log2(stat.count + 1);
  return {
    loves: stats
      .filter((stat) => stat.affinity >= 0.6)
      .sort((a, b) => weight(b) - weight(a))
      .slice(0, 10),
    avoids: stats
      .filter((stat) => stat.affinity <= -0.5)
      .sort((a, b) => weight(a) - weight(b))
      .slice(0, 6),
  };
}

export function predict(model: Model, keys: string[]): number {
  if (!keys.length) return 0;
  let total = 0;
  keys.forEach((key) => {
    const stat = model.get(key);
    // a feature seen only once or twice counts for less
    if (stat) total += stat.affinity * Math.min(1, stat.count / 3);
  });
  return total / Math.sqrt(keys.length);
}

export function strongest(
  model: Model,
  prefix: string,
  min: number,
): FeatureStat[] {
  return [...model.values()]
    .filter(
      (stat) =>
        stat.key.startsWith(prefix) && stat.count >= 2 && stat.affinity >= min,
    )
    .sort((a, b) => b.affinity - a.affinity);
}

export function weakest(
  model: Model,
  prefix: string,
  max: number,
): FeatureStat[] {
  return [...model.values()].filter(
    (stat) =>
      stat.key.startsWith(prefix) && stat.count >= 2 && stat.affinity <= max,
  );
}

function pickKind(model: Model): Kind {
  const lean = (key: string) =>
    Math.max(0.2, 1 + (model.get(key)?.affinity ?? 0));
  const movie = lean("t:movie");
  const show = lean("t:show");
  return Math.random() * (movie + show) < movie ? "movie" : "show";
}

function idOf(stat: FeatureStat): number {
  return Number(stat.key.slice(2));
}

/** A discover query aimed at the taste so far. */
function tasteQuery(
  model: Model,
  kind: Kind,
  genres: GenreIndex,
  randomize: boolean,
): Query {
  const valid = new Set(genres[kind]);
  const query: Query = { sort_by: "popularity.desc", "vote_count.gte": "40" };

  const liked = strongest(model, "g:", 0.5)
    .map(idOf)
    .filter((id) => valid.has(id));
  const anime = model.get("a:anime");
  if (anime && anime.count >= 2 && anime.affinity >= 0.8) {
    if (!liked.includes(ANIMATION_GENRE)) liked.unshift(ANIMATION_GENRE);
    query.with_original_language = "ja";
  }
  if (liked.length)
    query.with_genres = liked
      .slice(0, randomize ? 1 + randomInt(2) : 2)
      .join(",");
  const avoided = weakest(model, "g:", -0.5)
    .map(idOf)
    .filter((id) => valid.has(id) && !liked.includes(id));
  if (avoided.length) query.without_genres = avoided.join(",");

  // named subgenres first: they say far more than an incidental keyword
  const keywordStats = strongest(model, "k:", 0.6);
  const keywords = [
    ...keywordStats.filter((stat) => isSubgenreKey(stat.key)),
    ...keywordStats.filter((stat) => !isSubgenreKey(stat.key)),
  ]
    .slice(0, 5)
    .map(idOf);
  if (keywords.length && (!randomize || Math.random() < 0.7))
    query.with_keywords = keywords.join("|");
  const avoidedKeywords = weakest(model, "k:", -0.6).map(idOf);
  if (avoidedKeywords.length)
    query.without_keywords = avoidedKeywords.join(",");

  if (!query.with_original_language) {
    const language = strongest(model, "l:", 0.8).find(
      (stat) => stat.count >= 3,
    );
    if (language) query.with_original_language = language.key.slice(2);
  }
  const era = strongest(model, "e:", 0.8).find((stat) => stat.count >= 3);
  if (era && (!randomize || Math.random() < 0.5)) {
    const start = Number(era.key.slice(2));
    const field = kind === "show" ? "first_air_date" : "primary_release_date";
    query[`${field}.gte`] = `${start}-01-01`;
    query[`${field}.lte`] = `${start + 9}-12-31`;
  }
  return query;
}

async function discover(kind: Kind, query: Query): Promise<any[]> {
  const data = await get<any>(`/discover/${tmdbKind(kind)}`, withKey(query));
  return data?.results ?? [];
}

function without(query: Query, test: (name: string) => boolean): Query {
  return Object.fromEntries(
    Object.entries(query).filter(([name]) => !test(name)),
  );
}

// loosened in this order until a query returns a usable handful
const LOOSEN: ((query: Query) => Query)[] = [
  (query) => without(query, (name) => name === "with_keywords"),
  (query) => without(query, (name) => name.includes("_date.")),
  (query) =>
    query.with_genres
      ? { ...query, with_genres: query.with_genres.split(",")[0] }
      : query,
  (query) => without(query, (name) => name === "with_original_language"),
];

async function discoverRelaxed(
  kind: Kind,
  query: Query,
  step = 0,
): Promise<any[]> {
  const results = await discover(kind, query);
  if (results.length >= 6 || step >= LOOSEN.length) return results;
  return discoverRelaxed(kind, LOOSEN[step]({ ...query, page: "1" }), step + 1);
}

function toCandidates(
  results: any[],
  kind: Kind,
  model: Model,
  rated: Set<string>,
  noise: number,
): Candidate[] {
  return results
    .map((raw) => {
      const item = toFeedItem({ ...raw, media_type: tmdbKind(kind) });
      if (!item || !item.poster || rated.has(ratedKey(item))) return null;
      const keys = quickFeatures(raw, kind);
      return {
        item,
        keys,
        score: predict(model, keys) + (Math.random() - 0.5) * noise,
      };
    })
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort((a, b) => b.score - a.score);
}

/** An exploring query: a genre or a named subgenre it has not asked about much. */
function exploreQuery(model: Model, kind: Kind, genres: GenreIndex): Query {
  const query: Query = {
    sort_by: "popularity.desc",
    page: String(1 + randomInt(5)),
  };
  if (Math.random() < SUBGENRE_EXPLORE_SHARE) {
    const fresh = SUBGENRES.filter(
      (sub) => (model.get(`k:${sub.id}`)?.count ?? 0) < 2,
    );
    const pool = fresh.length ? fresh : SUBGENRES;
    query.with_keywords = String(pool[randomInt(pool.length)].id);
    query["vote_count.gte"] = "60";
    // subgenres are narrower than genres, so stay near the top of the list
    query.page = String(1 + randomInt(2));
    return query;
  }
  const pool = genres[kind].filter((id) => !EXPLORE_SKIP.has(id));
  const unexplored = pool.filter(
    (id) => (model.get(`g:${id}`)?.count ?? 0) < 2,
  );
  const choices = unexplored.length ? unexplored : pool;
  query["vote_count.gte"] = "200";
  if (choices.length)
    query.with_genres = String(choices[randomInt(choices.length)]);
  return query;
}

/** A batch of titles to show next, best guess first. */
export async function nextCandidates(
  ratings: RatedTitle[],
  genres: GenreIndex,
): Promise<Candidate[]> {
  const model = buildModel(ratings);
  const rated = new Set(ratings.map(ratedKey));
  const signal = ratings.filter((rating) => rating.reaction !== "skip").length;
  const kind = pickKind(model);

  let results: any[];
  if (signal >= SIGNAL_TO_EXPLOIT && Math.random() < 0.75) {
    results = await discoverRelaxed(kind, {
      ...tasteQuery(model, kind, genres, true),
      page: String(1 + randomInt(3)),
    });
  } else {
    results = await discover(kind, exploreQuery(model, kind, genres));
    // a subgenre can be thin for series; fall back to a plain genre
    if (results.length < 5)
      results = await discover(kind, {
        ...without(
          exploreQuery(model, kind, genres),
          (name) => name === "with_keywords",
        ),
        page: "1",
      });
  }

  // the noise shrinks as answers accumulate, so picks sharpen over time
  return toCandidates(results, kind, model, rated, 1.2 / Math.sqrt(signal + 1));
}

/** The best matches for the taste so far, across films and series. */
export async function topMatches(
  ratings: RatedTitle[],
  genres: GenreIndex,
): Promise<FeedItem[]> {
  const model = buildModel(ratings);
  const rated = new Set(ratings.map(ratedKey));
  const kinds: Kind[] = ["movie", "show"];
  const lists = await Promise.all(
    kinds.map(async (kind) => {
      try {
        const results = await discoverRelaxed(
          kind,
          tasteQuery(model, kind, genres, false),
        );
        return toCandidates(results, kind, model, rated, 0);
      } catch {
        return [] as Candidate[];
      }
    }),
  );
  return lists
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((candidate) => candidate.item);
}
