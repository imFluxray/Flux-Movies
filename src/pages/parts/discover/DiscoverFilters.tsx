import classNames from "classnames";
import { useCallback, useEffect, useRef, useState } from "react";

import { get } from "@/backend/metadata/tmdb";
import { MediaInfoDialog } from "@/pages/parts/home/MediaInfoDialog";
import { conf } from "@/setup/config";
import { FeedItem, toFeedItem } from "@/utils/algorithm";
import {
  SUBGENRES,
  SUBGENRE_BY_ID,
  SUBGENRE_GROUPS,
  Subgenre,
} from "@/utils/subgenres";

/*
 * Filtered browsing over TMDB's discover endpoint. Every control maps onto a
 * discover parameter, so each page is exactly what TMDB matched - nothing is
 * filtered again on this side, which would leave pages half empty.
 *
 * Genres and keywords are three-way chips: click once to require, again to
 * exclude, a third time to clear.
 */

type MediaKind = "movie" | "tv";
type ChipState = "include" | "exclude";

interface Named {
  id: number;
  name: string;
}

interface Filters {
  kind: MediaKind;
  sort: string;
  genres: Record<number, ChipState>;
  keywords: Record<number, { name: string; state: ChipState }>;
  yearFrom: string;
  yearTo: string;
  minRating: number;
  runtime: string;
  language: string;
  country: string;
}

const DEFAULT_FILTERS: Filters = {
  kind: "movie",
  sort: "popularity.desc",
  genres: {},
  keywords: {},
  yearFrom: "",
  yearTo: "",
  minRating: 0,
  runtime: "any",
  language: "",
  country: "",
};

const SORTS = [
  { value: "popularity.desc", label: "Most popular" },
  { value: "vote_average.desc", label: "Highest rated" },
  { value: "date.desc", label: "Newest" },
  { value: "date.asc", label: "Oldest" },
  { value: "vote_count.desc", label: "Most voted" },
];

// a series is filtered by episode length, so its brackets are shorter
const RUNTIMES: Record<
  MediaKind,
  { value: string; label: string; gte?: number; lte?: number }[]
> = {
  movie: [
    { value: "any", label: "Any length" },
    { value: "short", label: "Under 90 min", lte: 89 },
    { value: "medium", label: "90 – 150 min", gte: 90, lte: 150 },
    { value: "long", label: "Over 150 min", gte: 151 },
  ],
  tv: [
    { value: "any", label: "Any episode length" },
    { value: "short", label: "Under 30 min", lte: 29 },
    { value: "medium", label: "30 – 60 min", gte: 30, lte: 60 },
    { value: "long", label: "Over 60 min", gte: 61 },
  ],
};

const LANGUAGES = [
  ["", "Any language"],
  ["en", "English"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
  ["hi", "Hindi"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["ru", "Russian"],
  ["th", "Thai"],
  ["tr", "Turkish"],
  ["sv", "Swedish"],
  ["da", "Danish"],
];

const COUNTRIES = [
  ["", "Any country"],
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["JP", "Japan"],
  ["KR", "South Korea"],
  ["IN", "India"],
  ["CN", "China"],
  ["FR", "France"],
  ["DE", "Germany"],
  ["ES", "Spain"],
  ["IT", "Italy"],
  ["CA", "Canada"],
  ["AU", "Australia"],
  ["MX", "Mexico"],
  ["BR", "Brazil"],
  ["SE", "Sweden"],
  ["TR", "Turkey"],
];

const ANIMATION_GENRE = 16;
const MAX_PAGES = 500; // TMDB refuses anything past page 500

const selectClass =
  "w-full rounded-lg border border-white/15 bg-[#1c1c1c] px-3 py-2 text-sm text-white outline-none transition focus:border-white/60";

function chipIds(
  chips: Record<number, ChipState | { state: ChipState }>,
  state: ChipState,
): string[] {
  return Object.entries(chips)
    .filter(
      ([, chip]) => (typeof chip === "string" ? chip : chip.state) === state,
    )
    .map(([id]) => id);
}

function nextChipState(state?: ChipState): ChipState | undefined {
  if (!state) return "include";
  if (state === "include") return "exclude";
  return undefined;
}

function buildParams(f: Filters, page: number): Record<string, string> {
  const dateField =
    f.kind === "movie" ? "primary_release_date" : "first_air_date";
  const params: Record<string, string> = {
    api_key: conf().TMDB_READ_API_KEY ?? "",
    include_adult: "false",
    language: "en-US",
    page: String(page),
    sort_by: f.sort.startsWith("date.")
      ? `${dateField}.${f.sort.slice("date.".length)}`
      : f.sort,
  };

  const withGenres = chipIds(f.genres, "include");
  const withoutGenres = chipIds(f.genres, "exclude");
  // every required genre must match; any listed keyword may
  if (withGenres.length) params.with_genres = withGenres.join(",");
  if (withoutGenres.length) params.without_genres = withoutGenres.join(",");
  const withKeywords = chipIds(f.keywords, "include");
  const withoutKeywords = chipIds(f.keywords, "exclude");
  if (withKeywords.length) params.with_keywords = withKeywords.join("|");
  if (withoutKeywords.length)
    params.without_keywords = withoutKeywords.join(",");

  if (f.yearFrom) params[`${dateField}.gte`] = `${f.yearFrom}-01-01`;
  if (f.yearTo) params[`${dateField}.lte`] = `${f.yearTo}-12-31`;
  // "newest" would otherwise lead with titles that are only announced
  if (f.sort === "date.desc" && !params[`${dateField}.lte`])
    params[`${dateField}.lte`] = new Date().toISOString().slice(0, 10);

  if (f.minRating > 0) params["vote_average.gte"] = String(f.minRating);
  // a 10/10 from three votes is noise, not a rating
  if (f.sort === "vote_average.desc") params["vote_count.gte"] = "300";
  else if (f.minRating > 0) params["vote_count.gte"] = "50";

  const runtime = RUNTIMES[f.kind].find((option) => option.value === f.runtime);
  if (runtime?.gte) params["with_runtime.gte"] = String(runtime.gte);
  if (runtime?.lte) params["with_runtime.lte"] = String(runtime.lte);
  if (f.language) params.with_original_language = f.language;
  if (f.country) params.with_origin_country = f.country;
  return params;
}

function activeFilterCount(f: Filters): number {
  return (
    Object.keys(f.genres).length +
    Object.keys(f.keywords).length +
    (f.yearFrom ? 1 : 0) +
    (f.yearTo ? 1 : 0) +
    (f.minRating > 0 ? 1 : 0) +
    (f.runtime !== "any" ? 1 : 0) +
    (f.language ? 1 : 0) +
    (f.country ? 1 : 0)
  );
}

function Chip(props: {
  label: string;
  state?: ChipState;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  const { state } = props;
  return (
    <span
      className={classNames(
        "inline-flex items-center rounded-full border text-sm transition",
        state === "include" &&
          "border-emerald-400/70 bg-emerald-400/15 text-emerald-100",
        state === "exclude" && "border-red-400/70 bg-red-400/15 text-red-100",
        !state &&
          "border-white/15 bg-white/[0.04] text-white/70 hover:border-white/40 hover:text-white",
      )}
    >
      <button
        type="button"
        onClick={props.onToggle}
        title={
          state === "include"
            ? "Required - click to exclude"
            : state === "exclude"
              ? "Excluded - click to clear"
              : "Click to require"
        }
        className={classNames(
          "px-3 py-1.5 focus-visible:outline-none",
          state === "exclude" && "line-through decoration-red-300/80",
        )}
      >
        {state === "include" ? "+ " : state === "exclude" ? "− " : ""}
        {props.label}
      </button>
      {props.onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${props.label}`}
          onClick={props.onRemove}
          className="pr-3 text-white/50 transition hover:text-white"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-white/45">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}

export function DiscoverFilters() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [genreList, setGenreList] = useState<Named[]>([]);
  const [results, setResults] = useState<FeedItem[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [totalResults, setTotalResults] = useState(0);
  const [loading, setLoading] = useState(true);
  const [keywordQuery, setKeywordQuery] = useState("");
  const [keywordHits, setKeywordHits] = useState<Named[]>([]);
  const [opened, setOpened] = useState<FeedItem | null>(null);
  const requestRef = useRef(0);

  const update = useCallback((patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }, []);

  useEffect(() => {
    let alive = true;
    get<any>(`/genre/${filters.kind}/list`, {
      api_key: conf().TMDB_READ_API_KEY,
      language: "en-US",
    })
      .then((data) => {
        if (alive) setGenreList(data?.genres ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [filters.kind]);

  useEffect(() => {
    requestRef.current += 1;
    const request = requestRef.current;
    setLoading(true);
    // typing a year or dragging the rating should not fire a request per step
    const timer = window.setTimeout(
      () => {
        get<any>(`/discover/${filters.kind}`, buildParams(filters, page))
          .then((data) => {
            if (request !== requestRef.current) return;
            const items = ((data?.results ?? []) as any[])
              .map((raw) => toFeedItem({ ...raw, media_type: filters.kind }))
              .filter((item): item is FeedItem => item !== null);
            setResults((previous) => {
              if (page === 1) return items;
              const seen = new Set(previous.map((item) => item.id));
              return [
                ...previous,
                ...items.filter((item) => !seen.has(item.id)),
              ];
            });
            setTotalPages(Math.min(data?.total_pages ?? 0, MAX_PAGES));
            setTotalResults(data?.total_results ?? 0);
          })
          .catch(() => {
            if (request === requestRef.current && page === 1) setResults([]);
          })
          .finally(() => {
            if (request === requestRef.current) setLoading(false);
          });
      },
      page === 1 ? 350 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [filters, page]);

  useEffect(() => {
    const query = keywordQuery.trim();
    if (query.length < 2) {
      setKeywordHits([]);
      return undefined;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      get<any>("/search/keyword", {
        api_key: conf().TMDB_READ_API_KEY,
        query,
        page: "1",
      })
        .then((data) => {
          if (alive) setKeywordHits((data?.results ?? []).slice(0, 8));
        })
        .catch(() => {});
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [keywordQuery]);

  const closeDialog = useCallback(() => setOpened(null), []);

  const isAnime =
    filters.genres[ANIMATION_GENRE] === "include" && filters.language === "ja";
  const activeCount = activeFilterCount(filters);

  const toggleGenre = (id: number) => {
    const genres = { ...filters.genres };
    const next = nextChipState(genres[id]);
    if (next) genres[id] = next;
    else delete genres[id];
    update({ genres });
  };

  const toggleKeyword = (id: number) => {
    const keywords = { ...filters.keywords };
    const current = keywords[id];
    if (!current) return;
    keywords[id] = {
      ...current,
      state: current.state === "include" ? "exclude" : "include",
    };
    update({ keywords });
  };

  const addKeyword = (keyword: Named) => {
    update({
      keywords: {
        ...filters.keywords,
        [keyword.id]: { name: keyword.name, state: "include" },
      },
    });
    setKeywordQuery("");
    setKeywordHits([]);
  };

  const removeKeyword = (id: number) => {
    const keywords = { ...filters.keywords };
    delete keywords[id];
    update({ keywords });
  };

  const toggleAnime = () => {
    const genres = { ...filters.genres };
    if (isAnime) {
      delete genres[ANIMATION_GENRE];
      update({ genres, language: "" });
    } else {
      genres[ANIMATION_GENRE] = "include";
      update({ genres, language: "ja" });
    }
  };

  return (
    <section className="mb-20 mt-4" aria-labelledby="discover-filters-heading">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h2
            id="discover-filters-heading"
            className="text-2xl font-bold text-white sm:text-3xl"
          >
            Find something specific
          </h2>
          <p className="mt-1 text-sm text-white/55">
            Mix genres, keywords, years and more - click a chip twice to exclude
            it.
          </p>
        </div>
        {activeCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              setFilters({ ...DEFAULT_FILTERS, kind: filters.kind });
              setPage(1);
              setKeywordQuery("");
            }}
            className="rounded-full border border-white/20 px-4 py-1.5 text-sm text-white/80 transition hover:border-white/50 hover:text-white"
          >
            Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>

      <div className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-full bg-black/40 p-1 ring-1 ring-white/10">
            {(["movie", "tv"] as MediaKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={filters.kind === kind}
                onClick={() =>
                  filters.kind !== kind &&
                  // genre ids differ between films and series
                  update({ kind, genres: {}, runtime: "any" })
                }
                className={classNames(
                  "rounded-full px-4 py-1.5 text-sm font-semibold transition",
                  filters.kind === kind
                    ? "bg-white text-black"
                    : "text-white/70 hover:text-white",
                )}
              >
                {kind === "movie" ? "Movies" : "Shows"}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={isAnime}
            onClick={toggleAnime}
            className={classNames(
              "rounded-full border px-4 py-1.5 text-sm font-semibold transition",
              isAnime
                ? "border-fuchsia-400/70 bg-fuchsia-400/15 text-fuchsia-100"
                : "border-white/15 text-white/70 hover:border-white/40 hover:text-white",
            )}
          >
            Anime
          </button>
          <div className="ml-auto w-44">
            <select
              aria-label="Sort by"
              value={filters.sort}
              onChange={(event) => update({ sort: event.target.value })}
              className={selectClass}
            >
              {SORTS.map((sort) => (
                <option key={sort.value} value={sort.value}>
                  {sort.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {genreList.map((genre) => (
            <Chip
              key={genre.id}
              label={genre.name}
              state={filters.genres[genre.id]}
              onToggle={() => toggleGenre(genre.id)}
            />
          ))}
        </div>

        {/* TMDB's nineteen genres are too coarse; these narrow by keyword */}
        <details className="group rounded-xl border border-white/10 bg-white/[0.02]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              More genres
              {Object.keys(filters.keywords).some((id) =>
                SUBGENRE_BY_ID.has(Number(id)),
              ) ? (
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium">
                  {
                    Object.keys(filters.keywords).filter((id) =>
                      SUBGENRE_BY_ID.has(Number(id)),
                    ).length
                  }{" "}
                  selected
                </span>
              ) : null}
            </span>
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 text-type-dimmed transition-transform duration-200 group-open:rotate-180"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"
              />
            </svg>
          </summary>
          <div className="space-y-4 px-4 pb-4">
            {SUBGENRE_GROUPS.map((group) => (
              <div key={group}>
                <p className="mb-2 text-xs text-type-dimmed">{group}</p>
                <div className="flex flex-wrap gap-2">
                  {SUBGENRES.filter((sub: Subgenre) => sub.group === group).map(
                    (sub) => (
                      <Chip
                        key={sub.id}
                        label={sub.name}
                        state={filters.keywords[sub.id]?.state}
                        onToggle={() => {
                          const keywords = { ...filters.keywords };
                          const next = nextChipState(keywords[sub.id]?.state);
                          if (next)
                            keywords[sub.id] = { name: sub.name, state: next };
                          else delete keywords[sub.id];
                          update({ keywords });
                        }}
                      />
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Years">
            <span className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                placeholder="From"
                min={1900}
                max={new Date().getFullYear() + 2}
                value={filters.yearFrom}
                onChange={(event) => update({ yearFrom: event.target.value })}
                className={selectClass}
              />
              <span className="text-white/40">–</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="To"
                min={1900}
                max={new Date().getFullYear() + 2}
                value={filters.yearTo}
                onChange={(event) => update({ yearTo: event.target.value })}
                className={selectClass}
              />
            </span>
          </Field>
          <Field
            label={
              filters.minRating > 0
                ? `Rating ${filters.minRating}+`
                : "Any rating"
            }
          >
            <input
              type="range"
              min={0}
              max={9}
              step={0.5}
              value={filters.minRating}
              onChange={(event) =>
                update({ minRating: Number(event.target.value) })
              }
              className="mt-2 w-full accent-white"
            />
          </Field>
          <Field label="Length">
            <select
              value={filters.runtime}
              onChange={(event) => update({ runtime: event.target.value })}
              className={selectClass}
            >
              {RUNTIMES[filters.kind].map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Original language">
            <select
              value={filters.language}
              onChange={(event) => update({ language: event.target.value })}
              className={selectClass}
            >
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Country">
            <select
              value={filters.country}
              onChange={(event) => update({ country: event.target.value })}
              className={selectClass}
            >
              {COUNTRIES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <div className="relative max-w-md">
            <input
              type="search"
              aria-label="Add a keyword"
              placeholder="Add a keyword - aviation, time travel, heist…"
              value={keywordQuery}
              onChange={(event) => setKeywordQuery(event.target.value)}
              className={selectClass}
            />
            {keywordHits.length ? (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-white/15 bg-[#1c1c1c] shadow-2xl">
                {keywordHits.map((keyword) => (
                  <li key={keyword.id}>
                    <button
                      type="button"
                      onClick={() => addKeyword(keyword)}
                      className="block w-full px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
                    >
                      {keyword.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {/* subgenres already show in their own panel, so not twice */}
          {Object.keys(filters.keywords).some(
            (id) => !SUBGENRE_BY_ID.has(Number(id)),
          ) ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(filters.keywords)
                .filter(([id]) => !SUBGENRE_BY_ID.has(Number(id)))
                .map(([id, keyword]) => (
                  <Chip
                    key={id}
                    label={keyword.name}
                    state={keyword.state}
                    onToggle={() => toggleKeyword(Number(id))}
                    onRemove={() => removeKeyword(Number(id))}
                  />
                ))}
            </div>
          ) : null}
        </div>
      </div>

      <p className="mt-5 px-1 text-sm text-white/50" aria-live="polite">
        {loading && page === 1
          ? "Searching…"
          : `${totalResults.toLocaleString()} ${filters.kind === "movie" ? "movies" : "shows"}`}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {results.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setOpened(item)}
            className="group text-left focus-visible:outline-none"
          >
            <span className="relative block aspect-[2/3] overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10 transition group-hover:ring-white/40 group-focus-visible:ring-2 group-focus-visible:ring-white">
              {item.poster ? (
                <img
                  src={item.poster}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
              ) : (
                <span className="grid h-full place-items-center p-3 text-center text-sm text-white/50">
                  {item.title}
                </span>
              )}
              {item.rating ? (
                <span className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white">
                  ★ {item.rating.toFixed(1)}
                </span>
              ) : null}
            </span>
            <span className="mt-2 block truncate text-sm font-semibold text-white">
              {item.title}
            </span>
            <span className="text-xs text-white/50">{item.year ?? "—"}</span>
          </button>
        ))}
      </div>

      {!loading && results.length === 0 ? (
        <p className="py-16 text-center text-white/50">
          Nothing matches all of that - try removing a filter.
        </p>
      ) : null}

      {results.length > 0 && page < totalPages ? (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            disabled={loading}
            onClick={() => setPage((current) => current + 1)}
            className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-white/80 disabled:opacity-60"
          >
            {loading ? "Loading…" : "Show more"}
          </button>
        </div>
      ) : null}

      <MediaInfoDialog item={opened} onClose={closeDialog} />
    </section>
  );
}
