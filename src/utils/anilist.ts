import { FeedItem } from "@/utils/algorithm";

/*
 * AniList, for anime.
 *
 * TMDB files every anime under Animation and a couple of broad genres, which
 * is why "anime" cannot be narrowed down there. AniList is built for it: real
 * genres (Mecha, Mahou Shoujo, Slice of Life) and hundreds of ranked tags
 * (Isekai, Iyashikei, Seinen, Death Game). Its API is public and CORS-open.
 *
 * Adult titles, the Ecchi and Hentai genres, and spoiler tags are always
 * excluded - this feeds a recommendation card anyone might be looking at.
 */

const ENDPOINT = "https://graphql.anilist.co";
// a tag this far down a title's list is incidental, not what the show is about
const MIN_TAG_RANK = 60;

export const BLOCKED_GENRES = ["Ecchi", "Hentai"];

export const ANIME_GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Horror",
  "Mahou Shoujo",
  "Mecha",
  "Music",
  "Mystery",
  "Psychological",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
];

/** Tags worth exploring and filtering by: specific, common, and not spoilers. */
export const ANIME_TAGS = [
  "Isekai",
  "Shounen",
  "Seinen",
  "Shoujo",
  "Josei",
  "Iyashikei",
  "Cute Girls Doing Cute Things",
  "Found Family",
  "Coming of Age",
  "Super Power",
  "Martial Arts",
  "Swordplay",
  "Military",
  "Death Game",
  "Battle Royale",
  "Survival",
  "Revenge",
  "Anti-Hero",
  "Detective",
  "Crime",
  "Yakuza",
  "Cyberpunk",
  "Space Opera",
  "Time Loop",
  "Post-Apocalyptic",
  "Virtual World",
  "Video Games",
  "Dungeon",
  "Magic",
  "Cultivation",
  "Mythology",
  "Youkai",
  "Demons",
  "Vampire",
  "Kaiju",
  "Real Robot",
  "Super Robot",
  "Idol",
  "Band",
  "Food",
  "Workplace",
  "School",
  "School Club",
  "Historical",
  "Urban Fantasy",
  "Tragedy",
  "Love Triangle",
  "Primarily Adult Cast",
  "Female Protagonist",
  "Ensemble Cast",
  "Episodic",
  "Parody",
  "Surreal Comedy",
];

export interface AnimeTitle {
  anilistId: number;
  title: string;
  description: string;
  cover: string | null;
  banner: string | null;
  year: number | null;
  /** 0-10, converted from AniList's 0-100 */
  score: number | null;
  format: string | null;
  genres: string[];
  tags: string[];
}

const MEDIA_FIELDS = `
  id
  isAdult
  title { english romaji }
  description(asHtml: false)
  coverImage { extraLarge large }
  bannerImage
  seasonYear
  startDate { year }
  averageScore
  format
  genres
  tags { name rank isGeneralSpoiler isMediaSpoiler isAdult }
`;

const SEARCH_QUERY = `
  query ($page: Int, $genre: String, $tag: String, $genreNotIn: [String], $tagNotIn: [String], $sort: [MediaSort]) {
    Page(page: $page, perPage: 25) {
      media(
        type: ANIME
        isAdult: false
        genre: $genre
        tag: $tag
        genre_not_in: $genreNotIn
        tag_not_in: $tagNotIn
        format_in: [TV, MOVIE, ONA]
        sort: $sort
      ) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

/** AniList descriptions carry <br> and <i>; a card wants plain sentences. */
function plainText(html: string | null | undefined): string {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\(Source:[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toAnime(media: any): AnimeTitle | null {
  if (!media || media.isAdult) return null;
  const genres: string[] = (media.genres ?? []).filter(
    (genre: string) => !BLOCKED_GENRES.includes(genre),
  );
  if (genres.length !== (media.genres ?? []).length) return null;
  const tags: string[] = (media.tags ?? [])
    .filter(
      (tag: any) =>
        !tag.isAdult &&
        !tag.isGeneralSpoiler &&
        !tag.isMediaSpoiler &&
        (tag.rank ?? 0) >= MIN_TAG_RANK,
    )
    .map((tag: any) => tag.name);
  return {
    anilistId: media.id,
    title: media.title?.english || media.title?.romaji || "Untitled",
    description: plainText(media.description),
    cover: media.coverImage?.extraLarge || media.coverImage?.large || null,
    banner: media.bannerImage || null,
    year: media.seasonYear ?? media.startDate?.year ?? null,
    score:
      typeof media.averageScore === "number" ? media.averageScore / 10 : null,
    format: media.format ?? null,
    genres,
    tags,
  };
}

export async function searchAnime(options: {
  genre?: string;
  tag?: string;
  excludeGenres?: string[];
  excludeTags?: string[];
  page?: number;
  sort?: string[];
}): Promise<AnimeTitle[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: SEARCH_QUERY,
      variables: {
        page: options.page ?? 1,
        genre: options.genre ?? null,
        tag: options.tag ?? null,
        genreNotIn: [...BLOCKED_GENRES, ...(options.excludeGenres ?? [])],
        tagNotIn: options.excludeTags?.length ? options.excludeTags : null,
        sort: options.sort ?? ["POPULARITY_DESC"],
      },
    }),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const body = await res.json();
  return ((body?.data?.Page?.media ?? []) as any[])
    .map(toAnime)
    .filter((anime): anime is AnimeTitle => anime !== null);
}

const tmdbCache = new Map<number, Promise<FeedItem | null>>();

/**
 * The TMDB title an AniList entry corresponds to, so the details dialog and
 * the player - both TMDB-based - can open it. Null when nobody has mapped it.
 */
export function animeToFeedItem(anime: AnimeTitle): Promise<FeedItem | null> {
  const cached = tmdbCache.get(anime.anilistId);
  if (cached) return cached;
  const lookup = fetch(
    `/proxy?destination=${encodeURIComponent(
      `https://animeapi.my.id/anilist/${anime.anilistId}`,
    )}`,
  )
    .then((res) => (res.ok ? res.json() : null))
    .then((mapping): FeedItem | null => {
      const tmdbId = Number(mapping?.themoviedb);
      if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;
      return {
        id: tmdbId,
        type: mapping?.themoviedb_type === "movie" ? "movie" : "show",
        title: anime.title,
        overview: anime.description,
        backdrop: anime.banner,
        poster: anime.cover,
        year: anime.year,
        rating: anime.score,
      };
    })
    .catch(() => null);
  tmdbCache.set(anime.anilistId, lookup);
  return lookup;
}
