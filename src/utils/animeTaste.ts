import { RatedTitle, TasteFeature, ratedKey } from "@/stores/tasteProfile";
import {
  ANIME_GENRES,
  ANIME_TAGS,
  AnimeTitle,
  searchAnime,
} from "@/utils/anilist";
import { buildModel, predict, strongest, weakest } from "@/utils/tasteModel";

/*
 * The taste finder's anime mode.
 *
 * Same model as films and series (utils/tasteModel), different vocabulary:
 * AniList genres and tags instead of TMDB's, so a taste can come out as
 * "Iyashikei, Slice of Life, not Mecha" rather than just "Animation".
 */

export interface AnimeCandidate {
  anime: AnimeTitle;
  keys: string[];
  score: number;
}

// how many tags of a title count; the rest are usually incidental
const TAGS_PER_TITLE = 12;

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function formatLabel(format: string): string {
  if (format === "MOVIE") return "Anime films";
  if (format === "ONA") return "Web anime";
  return "Anime series";
}

export function animeFeatures(anime: AnimeTitle): TasteFeature[] {
  const features: TasteFeature[] = anime.genres.map((genre) => ({
    key: `ag:${genre}`,
    label: genre,
  }));
  anime.tags.slice(0, TAGS_PER_TITLE).forEach((tag) => {
    features.push({ key: `at:${tag}`, label: tag });
  });
  if (anime.format)
    features.push({
      key: `af:${anime.format}`,
      label: formatLabel(anime.format),
    });
  if (anime.year) {
    const decade = Math.floor(anime.year / 10) * 10;
    features.push({ key: `ae:${decade}`, label: `${decade}s anime` });
  }
  return features;
}

function valueOf(key: string): string {
  return key.slice(key.indexOf(":") + 1);
}

function animeKey(anime: AnimeTitle): string {
  return ratedKey({ id: anime.anilistId, type: "anime" });
}

function avoided(ratings: RatedTitle[]) {
  const model = buildModel(ratings);
  return {
    model,
    genres: weakest(model, "ag:", -0.5)
      .map((stat) => valueOf(stat.key))
      .filter((genre) => ANIME_GENRES.includes(genre)),
    tags: weakest(model, "at:", -0.6).map((stat) => valueOf(stat.key)),
  };
}

function rank(
  results: AnimeTitle[],
  ratings: RatedTitle[],
  model: ReturnType<typeof buildModel>,
  noise: number,
): AnimeCandidate[] {
  const rated = new Set(ratings.map(ratedKey));
  const seen = new Set<number>();
  const out: AnimeCandidate[] = [];
  results.forEach((anime) => {
    if (!anime.cover || rated.has(animeKey(anime)) || seen.has(anime.anilistId))
      return;
    seen.add(anime.anilistId);
    const keys = animeFeatures(anime).map((feature) => feature.key);
    out.push({
      anime,
      keys,
      score: predict(model, keys) + (Math.random() - 0.5) * noise,
    });
  });
  return out.sort((a, b) => b.score - a.score);
}

/** A batch of anime to show next, best guess first. */
export async function nextAnimeCandidates(
  ratings: RatedTitle[],
): Promise<AnimeCandidate[]> {
  const { model, genres: avoidGenres, tags: avoidTags } = avoided(ratings);
  const signal = ratings.filter((rating) => rating.reaction !== "skip").length;
  const page = 1 + Math.floor(Math.random() * 3);

  let results: AnimeTitle[];
  if (signal >= 6 && Math.random() < 0.75) {
    const genre = strongest(model, "ag:", 0.5)
      .map((stat) => valueOf(stat.key))
      .find((name) => ANIME_GENRES.includes(name));
    const likedTags = strongest(model, "at:", 0.5).slice(0, 4);
    const tag =
      likedTags.length && Math.random() < 0.7
        ? valueOf(randomItem(likedTags).key)
        : undefined;
    results = await searchAnime({
      genre,
      tag,
      excludeGenres: avoidGenres.filter((name) => name !== genre),
      excludeTags: avoidTags.filter((name) => name !== tag),
      page,
    });
    // genre plus tag can be too narrow; drop the tag before giving up
    if (results.length < 5 && tag)
      results = await searchAnime({
        genre,
        excludeGenres: avoidGenres.filter((name) => name !== genre),
        excludeTags: avoidTags,
      });
  } else if (Math.random() < 0.5) {
    // exploring: a tag it has not asked about much yet
    const fresh = ANIME_TAGS.filter(
      (tag) => (model.get(`at:${tag}`)?.count ?? 0) < 2,
    );
    results = await searchAnime({
      tag: randomItem(fresh.length ? fresh : ANIME_TAGS),
      excludeGenres: avoidGenres,
      page,
    });
  } else {
    const fresh = ANIME_GENRES.filter(
      (genre) => (model.get(`ag:${genre}`)?.count ?? 0) < 2,
    );
    results = await searchAnime({
      genre: randomItem(fresh.length ? fresh : ANIME_GENRES),
      excludeTags: avoidTags,
      page,
    });
  }

  return rank(results, ratings, model, 1.2 / Math.sqrt(signal + 1));
}

/** The best anime for the taste so far. */
export async function topAnimeMatches(
  ratings: RatedTitle[],
): Promise<AnimeTitle[]> {
  const { model, genres: avoidGenres, tags: avoidTags } = avoided(ratings);
  const genre = strongest(model, "ag:", 0.5)
    .map((stat) => valueOf(stat.key))
    .find((name) => ANIME_GENRES.includes(name));
  const tag = strongest(model, "at:", 0.6).map((stat) => valueOf(stat.key))[0];

  // the favourite genre, the favourite tag, and the two together
  const queries: { genre?: string; tag?: string }[] = [];
  if (genre) queries.push({ genre });
  if (tag) queries.push({ tag });
  if (genre && tag) queries.push({ genre, tag });

  const lists = await Promise.all(
    queries.map((query) =>
      searchAnime({
        ...query,
        excludeGenres: avoidGenres.filter((name) => name !== query.genre),
        excludeTags: avoidTags.filter((name) => name !== query.tag),
        sort: ["SCORE_DESC"],
      }).catch(() => [] as AnimeTitle[]),
    ),
  );

  return rank(lists.flat(), ratings, model, 0)
    .map((candidate) => ({
      ...candidate,
      // among close predictions, the better-reviewed show goes first
      score: candidate.score + (candidate.anime.score ?? 0) / 40,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((candidate) => candidate.anime);
}
