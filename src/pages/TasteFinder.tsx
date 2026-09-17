import classNames from "classnames";
import {
  CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Helmet } from "react-helmet-async";

import { Icon, Icons } from "@/components/Icon";
import { ThiccContainer } from "@/components/layout/ThinContainer";
import { Flare } from "@/components/utils/Flare";
import { SubPageLayout } from "@/pages/layouts/SubPageLayout";
import { MediaInfoDialog } from "@/pages/parts/home/MediaInfoDialog";
import { useProfileStore } from "@/stores/profiles";
import { tasteKey, useTasteStore } from "@/stores/taste";
import {
  RatedTitle,
  RatedType,
  Reaction,
  TasteFeature,
  ratedKey,
  useTasteProfileStore,
} from "@/stores/tasteProfile";
import { FeedItem } from "@/utils/algorithm";
import { AnimeTitle, animeToFeedItem } from "@/utils/anilist";
import {
  AnimeCandidate,
  animeFeatures,
  nextAnimeCandidates,
  topAnimeMatches,
} from "@/utils/animeTaste";
import { extractAccent } from "@/utils/heroMedia";
import {
  Candidate,
  GenreIndex,
  SIGNAL_TO_EXPLOIT,
  buildModel,
  displayTags,
  fallbackFeatures,
  loadGenreIndex,
  nextCandidates,
  tasteSummary,
  titleFeatures,
  topMatches,
} from "@/utils/tasteModel";

/*
 * Two tastes, one page: films and series come from TMDB, anime from AniList,
 * and each learns separately - liking Iyashikei anime says nothing about
 * which heist films someone wants.
 */
type Mode = "screen" | "anime";

/** One title on the card, whichever catalogue it came from. */
interface Card {
  key: string;
  id: number;
  type: RatedType;
  title: string;
  overview: string;
  backdrop: string | null;
  poster: string | null;
  year: number | null;
  rating: number | null;
  kindLabel: string;
  keys: string[];
  score: number;
  tmdb?: FeedItem;
  anime?: AnimeTitle;
}

const REACTIONS: {
  reaction: Reaction;
  label: string;
  icon: Icons;
  className: string;
}[] = [
  {
    reaction: "dislike",
    label: "Not for me",
    icon: Icons.X,
    className: "bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/20",
  },
  {
    reaction: "skip",
    label: "Never seen it",
    icon: Icons.EYE_SLASH,
    className: "bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/20",
  },
  {
    reaction: "like",
    label: "Like it",
    icon: Icons.CHECKMARK,
    className: "bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/20",
  },
  // the one answer worth emphasising, the same way the hero marks Play
  {
    reaction: "love",
    label: "Love it",
    icon: Icons.RISING_STAR,
    className: "bg-white text-black hover:bg-white/90",
  },
];

const KEY_REACTIONS: Record<string, Reaction> = {
  ArrowLeft: "dislike",
  ArrowDown: "skip",
  ArrowRight: "like",
  ArrowUp: "love",
};

const MODES: { mode: Mode; label: string }[] = [
  { mode: "screen", label: "Movies and shows" },
  { mode: "anime", label: "Anime" },
];

// answers until it reads as fully dialled in
const FULL_SIGNAL = 20;
// consecutive empty batches before it stops asking for more
const MAX_EMPTY_BATCHES = 4;
const MODE_KEY = "__FLUX::taste-mode";
const NO_RATINGS: Record<string, RatedTitle> = {};

function stageLine(signal: number): string {
  if (signal === 0) return "Let's find out what you like";
  if (signal < SIGNAL_TO_EXPLOIT) return "Getting to know you";
  if (signal < FULL_SIGNAL) return "Narrowing it down";
  return "This is your taste";
}

function fromCandidate(candidate: Candidate): Card {
  const { item } = candidate;
  return {
    key: ratedKey(item),
    id: item.id,
    type: item.type,
    title: item.title,
    overview: item.overview,
    backdrop: item.backdrop,
    poster: item.poster,
    year: item.year,
    rating: item.rating,
    kindLabel: item.type === "show" ? "Series" : "Film",
    keys: candidate.keys,
    score: candidate.score,
    tmdb: item,
  };
}

function animeKindLabel(format: string | null): string {
  if (format === "MOVIE") return "Anime film";
  if (format === "ONA") return "Web anime";
  return "Anime series";
}

function fromAnime(candidate: AnimeCandidate): Card {
  const { anime } = candidate;
  return {
    key: ratedKey({ id: anime.anilistId, type: "anime" }),
    id: anime.anilistId,
    type: "anime",
    title: anime.title,
    overview: anime.description,
    backdrop: anime.banner ?? anime.cover,
    poster: anime.cover,
    year: anime.year,
    rating: anime.score,
    kindLabel: animeKindLabel(anime.format),
    keys: candidate.keys,
    score: candidate.score,
    anime,
  };
}

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "anime" ? "anime" : "screen";
  } catch {
    return "screen";
  }
}

export function TasteFinderPage() {
  const profileId = useProfileStore((state) => state.activeId) ?? "default";
  const ratingsMap =
    useTasteProfileStore((state) => state.byProfile[profileId]?.ratings) ??
    NO_RATINGS;
  const rate = useTasteProfileStore((state) => state.rate);
  const unrate = useTasteProfileStore((state) => state.unrate);

  const [mode, setMode] = useState<Mode>(readMode);
  const allRatings = useMemo(() => Object.values(ratingsMap), [ratingsMap]);
  const ratings = useMemo(
    () =>
      allRatings.filter((rating) =>
        mode === "anime" ? rating.type === "anime" : rating.type !== "anime",
      ),
    [allRatings, mode],
  );
  const model = useMemo(() => buildModel(ratings), [ratings]);
  const summary = useMemo(() => tasteSummary(model), [model]);
  const signal = ratings.filter((rating) => rating.reaction !== "skip").length;

  const [genres, setGenres] = useState<GenreIndex | null>(null);
  const [queues, setQueues] = useState<Record<Mode, Card[]>>({
    screen: [],
    anime: [],
  });
  const [exhausted, setExhausted] = useState<Record<Mode, boolean>>({
    screen: false,
    anime: false,
  });
  const [fetchTick, setFetchTick] = useState(0);
  const [features, setFeatures] = useState<TasteFeature[] | null>(null);
  const [accent, setAccent] = useState("255, 255, 255");
  const [lastRated, setLastRated] = useState<{ mode: Mode; card: Card } | null>(
    null,
  );
  const [matches, setMatches] = useState<Card[]>([]);
  const [opened, setOpened] = useState<FeedItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ratingsRef = useRef(ratings);
  const allRatingsRef = useRef(allRatings);
  const queuesRef = useRef(queues);
  const fetchingRef = useRef<Record<Mode, boolean>>({
    screen: false,
    anime: false,
  });
  const emptyBatchesRef = useRef<Record<Mode, number>>({ screen: 0, anime: 0 });
  const current = queues[mode][0] ?? null;

  useEffect(() => {
    ratingsRef.current = ratings;
    allRatingsRef.current = allRatings;
  }, [ratings, allRatings]);

  useEffect(() => {
    queuesRef.current = queues;
  }, [queues]);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // storage blocked: the mode just resets next visit
    }
    setNotice(null);
  }, [mode]);

  useEffect(() => {
    loadGenreIndex()
      .then(setGenres)
      .catch(() => setExhausted((state) => ({ ...state, screen: true })));
  }, []);

  // keep a few titles queued so answering never waits on the network
  useEffect(() => {
    const forMode = mode;
    if (
      exhausted[forMode] ||
      fetchingRef.current[forMode] ||
      queues[forMode].length >= 3
    )
      return;
    if (forMode === "screen" && !genres) return;

    fetchingRef.current[forMode] = true;
    const request: Promise<Card[]> =
      forMode === "anime"
        ? nextAnimeCandidates(ratingsRef.current).then((found) =>
            found.map(fromAnime),
          )
        : nextCandidates(ratingsRef.current, genres as GenreIndex).then(
            (found) => found.map(fromCandidate),
          );

    request
      .then((found) => {
        // decide what is new here, not inside the state updater - React may
        // run that later, and the empty-batch count must see the real result
        const seen = new Set([
          ...queuesRef.current[forMode].map((card) => card.key),
          ...allRatingsRef.current.map(ratedKey),
        ]);
        const fresh = found.filter((card) => !seen.has(card.key));
        const rest = fresh.slice(3);
        const wildcard = rest.length
          ? rest[Math.floor(Math.random() * rest.length)]
          : null;
        const picked = [...fresh.slice(0, 3), ...(wildcard ? [wildcard] : [])];

        if (picked.length) {
          emptyBatchesRef.current[forMode] = 0;
          setQueues((state) => {
            const have = new Set(state[forMode].map((card) => card.key));
            return {
              ...state,
              [forMode]: [
                ...state[forMode],
                ...picked.filter((card) => !have.has(card.key)),
              ],
            };
          });
        } else {
          emptyBatchesRef.current[forMode] += 1;
        }
      })
      .catch(() => {
        emptyBatchesRef.current[forMode] += 1;
      })
      .finally(() => {
        fetchingRef.current[forMode] = false;
        if (emptyBatchesRef.current[forMode] >= MAX_EMPTY_BATCHES)
          setExhausted((state) => ({ ...state, [forMode]: true }));
        setFetchTick((tick) => tick + 1);
      });
  }, [mode, genres, queues, exhausted, fetchTick]);

  useEffect(() => {
    setFeatures(null);
    if (!current) return undefined;
    if (current.anime) {
      setFeatures(animeFeatures(current.anime));
      return undefined;
    }
    if (!current.tmdb || !genres) return undefined;
    let alive = true;
    titleFeatures(current.tmdb, genres)
      .then((found) => {
        if (alive) setFeatures(found);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [current, genres]);

  // the title on screen lights the whole page in its own colour
  useEffect(() => {
    const art = current?.backdrop;
    if (!art) return undefined;
    let alive = true;
    extractAccent(art)
      .then((found) => {
        if (alive && found) setAccent(found.rgb);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [current]);

  // rebuild matches every few answers rather than on every single one
  const matchStep = signal >= SIGNAL_TO_EXPLOIT ? Math.floor(signal / 3) : 0;
  useEffect(() => {
    setMatches([]);
    if (matchStep === 0) return undefined;
    let alive = true;
    const request: Promise<Card[]> =
      mode === "anime"
        ? topAnimeMatches(ratingsRef.current).then((list) =>
            list.map((anime) => fromAnime({ anime, keys: [], score: 0 })),
          )
        : genres
          ? topMatches(ratingsRef.current, genres).then((list) =>
              list.map((item) => fromCandidate({ item, keys: [], score: 0 })),
            )
          : Promise.resolve([]);
    request
      .then((found) => {
        if (alive) setMatches(found);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode, genres, matchStep]);

  const openDetails = useCallback(async (card: Card) => {
    setNotice(null);
    if (card.tmdb) {
      setOpened(card.tmdb);
      return;
    }
    if (!card.anime) return;
    const item = await animeToFeedItem(card.anime);
    if (item) setOpened(item);
    else setNotice(`${card.title} is not available to watch here yet.`);
  }, []);

  const onRate = useCallback(
    (reaction: Reaction) => {
      if (!current) return;
      const known =
        features ??
        (current.anime
          ? animeFeatures(current.anime)
          : genres
            ? fallbackFeatures(current.keys, genres)
            : []);
      rate(profileId, {
        id: current.id,
        type: current.type,
        title: current.title,
        poster: current.poster,
        reaction,
        features: known,
        ratedAt: Date.now(),
      });

      // a like here is a thumbs-up for the home page recommendations too
      if (reaction !== "skip") {
        const positive = reaction === "love" || reaction === "like";
        const syncLike = (item: FeedItem | null) => {
          if (!item) return;
          const taste = useTasteStore.getState();
          const liked = !!taste.likes[tasteKey(item)];
          if (positive !== liked)
            taste.toggleLike({
              id: item.id,
              title: item.title,
              type: item.type,
            });
        };
        if (current.tmdb) syncLike(current.tmdb);
        else if (current.anime)
          animeToFeedItem(current.anime)
            .then(syncLike)
            .catch(() => {});
      }

      setNotice(null);
      setLastRated({ mode, card: current });
      setQueues((state) => ({ ...state, [mode]: state[mode].slice(1) }));
    },
    [current, features, genres, mode, profileId, rate],
  );

  const undo = () => {
    if (!lastRated) return;
    unrate(profileId, lastRated.card.key);
    setQueues((state) => ({
      ...state,
      [lastRated.mode]: [lastRated.card, ...state[lastRated.mode]],
    }));
    setLastRated(null);
  };

  const startOver = () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm("Forget every answer in this mode and start over?"))
      return;
    ratings.forEach((rating) => unrate(profileId, ratedKey(rating)));
    setQueues((state) => ({ ...state, [mode]: [] }));
    setMatches([]);
    setLastRated(null);
    emptyBatchesRef.current[mode] = 0;
    setExhausted((state) => ({ ...state, [mode]: false }));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (opened || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const reaction = KEY_REACTIONS[event.key];
      if (!reaction) return;
      event.preventDefault();
      onRate(reaction);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRate, opened]);

  const closeDialog = useCallback(() => setOpened(null), []);
  const progress = Math.min(1, signal / FULL_SIGNAL);
  const tags = (features ?? []).filter((feature) =>
    current?.anime
      ? feature.key.startsWith("ag:") || feature.key.startsWith("at:")
      : true,
  );
  const shownTags = current?.anime ? tags : displayTags(tags);

  return (
    <SubPageLayout>
      <Helmet>
        <title>Taste Finder</title>
      </Helmet>

      <section
        className="relative flex min-h-[100svh] w-full items-end overflow-hidden"
        style={{ "--accent": accent } as CSSProperties}
      >
        <div className="absolute inset-0">
          {current?.backdrop ? (
            <img
              key={current.backdrop}
              src={current.backdrop}
              alt=""
              className="flux-kenburns h-full w-full object-cover object-center"
            />
          ) : null}
        </div>

        {/* the title's own colour, then the scrims that keep text readable */}
        <div
          className="pointer-events-none absolute inset-0 transition-colors duration-1000"
          style={{
            background:
              "radial-gradient(120% 80% at 18% 90%, rgba(var(--accent), 0.26) 0%, rgba(var(--accent), 0.08) 38%, transparent 68%)",
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background-main via-background-main/45 to-background-main/10" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background-main/95 via-background-main/45 to-transparent" />
        <div className="flux-vignette pointer-events-none absolute inset-0" />
        <div className="flux-grain pointer-events-none" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background-main via-background-main/70 to-transparent sm:h-56" />

        <div className="relative z-10 mx-auto w-full max-w-[1400px] px-5 pb-14 pt-32 sm:px-10 sm:pb-20 sm:pt-40">
          <div className="flex flex-wrap items-center gap-2">
            {MODES.map((option) => (
              <button
                key={option.mode}
                type="button"
                aria-pressed={mode === option.mode}
                onClick={() => setMode(option.mode)}
                className={classNames(
                  "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors duration-200",
                  mode === option.mode
                    ? "bg-white text-black"
                    : "bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/20",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-6 max-w-2xl">
            <p
              className="flux-rise text-sm font-semibold text-white/60"
              style={{ animationDelay: "60ms" }}
            >
              {stageLine(signal)}
            </p>
            <h1
              key={current?.key ?? "empty"}
              className="flux-rise mt-2 text-4xl font-semibold leading-[1.04] tracking-[-0.035em] text-white sm:text-6xl"
              style={{
                animationDelay: "110ms",
                textShadow: "0 6px 30px rgba(0,0,0,0.5)",
              }}
            >
              {current ? current.title : "Finding something for you"}
            </h1>
          </div>

          <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)] lg:items-end">
            <div className="hidden lg:block">
              <div className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl bg-white/5 shadow-[0_30px_80px_rgba(0,0,0,0.7)] ring-1 ring-white/10">
                {current?.poster ? (
                  <img
                    key={current.poster}
                    src={current.poster.replace("/w342/", "/w500/")}
                    alt=""
                    className="flux-rise h-full w-full object-cover"
                  />
                ) : null}
              </div>
            </div>

            <div>
              {current ? (
                <>
                  <div
                    className="flux-rise flex flex-wrap items-center gap-3 text-sm text-white/70"
                    style={{ animationDelay: "170ms" }}
                  >
                    <span className="rounded-full border border-white/20 px-2.5 py-0.5">
                      {current.kindLabel}
                    </span>
                    {current.year ? <span>{current.year}</span> : null}
                    {current.rating ? (
                      <span>★ {current.rating.toFixed(1)}</span>
                    ) : null}
                    {signal >= SIGNAL_TO_EXPLOIT && current.score > 0.3 ? (
                      <span className="font-semibold text-white">
                        Picked for your taste
                      </span>
                    ) : null}
                  </div>

                  <p
                    className="flux-rise mt-4 max-w-2xl text-base leading-relaxed text-white/75 line-clamp-3"
                    style={{ animationDelay: "210ms" }}
                  >
                    {current.overview || "No synopsis is available yet."}
                  </p>

                  <div
                    className="flux-rise mt-4 flex min-h-[1.9rem] flex-wrap gap-2"
                    style={{ animationDelay: "240ms" }}
                  >
                    {shownTags.slice(0, 8).map((feature) => (
                      <span
                        key={feature.key}
                        className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/75 backdrop-blur-sm"
                      >
                        {feature.label}
                      </span>
                    ))}
                  </div>

                  <div
                    className="flux-rise mt-7 flex flex-wrap items-center gap-2.5"
                    style={{ animationDelay: "300ms" }}
                  >
                    {REACTIONS.map((option) => (
                      <button
                        key={option.reaction}
                        type="button"
                        onClick={() => onRate(option.reaction)}
                        className={classNames(
                          // no text colour here: each answer sets its own
                          "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                          option.className,
                        )}
                      >
                        <Icon icon={option.icon} className="text-sm" />
                        {option.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => openDetails(current)}
                      className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition-colors duration-200 hover:bg-white/20"
                    >
                      <Icon icon={Icons.FILM} className="text-sm" />
                      Details
                    </button>
                  </div>

                  {notice ? (
                    <p className="mt-3 text-sm text-white/60">{notice}</p>
                  ) : null}

                  <div
                    className="flux-rise mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/45"
                    style={{ animationDelay: "340ms" }}
                  >
                    <span>Arrow keys work too</span>
                    <span>
                      {signal} answered, {Math.round(progress * 100)}% dialled
                      in
                    </span>
                    {lastRated ? (
                      <button
                        type="button"
                        onClick={undo}
                        className="transition-colors hover:text-white"
                      >
                        Undo last answer
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="py-10">
                  {exhausted[mode] ? (
                    <div>
                      <p className="text-lg text-white/70">
                        Could not find anything new to show right now.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          emptyBatchesRef.current[mode] = 0;
                          setExhausted((state) => ({
                            ...state,
                            [mode]: false,
                          }));
                        }}
                        className="mt-5 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
                      >
                        Try again
                      </button>
                    </div>
                  ) : (
                    <p className="animate-pulse text-lg text-white/50">
                      Loading something worth asking about…
                    </p>
                  )}
                </div>
              )}

              {summary.loves.length || summary.avoids.length ? (
                <div className="mt-6 flex max-w-2xl flex-wrap items-center gap-2">
                  {summary.loves.map((stat) => (
                    <span
                      key={stat.key}
                      className="rounded-full bg-white/15 px-3 py-1 text-xs text-white"
                    >
                      {stat.label}
                    </span>
                  ))}
                  {summary.avoids.map((stat) => (
                    <span
                      key={stat.key}
                      className="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-white/45 line-through"
                    >
                      {stat.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {matches.length ? (
        <ThiccContainer>
          <section
            className="pb-24 pt-14 text-white"
            aria-labelledby="taste-matches-heading"
          >
            <h2
              id="taste-matches-heading"
              className="text-2xl font-bold sm:text-3xl"
            >
              {mode === "anime" ? "Anime for you" : "Your matches"}
            </h2>
            <p className="mt-1 text-sm text-type-dimmed">
              Rebuilt from your answers every few rounds.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {matches.map((match) => (
                <button
                  key={match.key}
                  type="button"
                  onClick={() => openDetails(match)}
                  className="group tabbable rounded-xl text-left"
                >
                  <Flare.Base className="group cursor-pointer rounded-xl relative p-[0.4em] bg-background-main transition-colors duration-300 bg-transparent">
                    <Flare.Light
                      flareSize={300}
                      cssColorVar="--colors-mediaCard-hoverAccent"
                      backgroundClass="bg-mediaCard-hoverBackground duration-200"
                      className="rounded-xl bg-background-main group-hover:opacity-100"
                    />
                    <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-mediaCard-hoverBackground">
                      {match.poster ? (
                        <img
                          src={match.poster}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : null}
                    </div>
                    <p className="relative mt-2 truncate px-1 text-xs font-semibold text-white">
                      {match.title}
                    </p>
                  </Flare.Base>
                </button>
              ))}
            </div>
            {ratings.length ? (
              <div className="mt-14 text-center">
                <button
                  type="button"
                  onClick={startOver}
                  className="text-sm text-type-dimmed transition-colors hover:text-type-danger"
                >
                  Start over
                </button>
              </div>
            ) : null}
          </section>
        </ThiccContainer>
      ) : null}

      <MediaInfoDialog item={opened} onClose={closeDialog} />
    </SubPageLayout>
  );
}
