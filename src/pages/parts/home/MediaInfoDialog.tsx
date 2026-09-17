import classNames from "classnames";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import {
  TMDBIdToUrlId,
  get,
  mediaItemTypeToMediaType,
} from "@/backend/metadata/tmdb";
import { Icon, Icons } from "@/components/Icon";
import { TrailerPreview } from "@/components/media/TrailerPreview";
import { conf } from "@/setup/config";
import { useBookmarkStore } from "@/stores/bookmarks";
import { tasteKey, useTasteStore } from "@/stores/taste";
import { FeedItem, toFeedItem } from "@/utils/algorithm";
import { fetchTitleLogo, fetchTrailerKey } from "@/utils/heroMedia";

interface OriginRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface SeasonSummary {
  air_date?: string;
  episode_count: number;
  id: number;
  name: string;
  poster_path?: string | null;
  season_number: number;
}

interface EpisodeSummary {
  air_date?: string;
  episode_number: number;
  id: number;
  name: string;
  overview?: string;
  runtime?: number | null;
  still_path?: string | null;
}

interface CastMember {
  id: number;
  name: string;
  /** who they play - a series joins its most frequent characters */
  role: string | null;
  photo: string | null;
}

interface TitleVideo {
  key: string;
  name: string;
  type: string;
}

interface Details {
  cast: string[];
  castMembers: CastMember[];
  certification: string | null;
  genres: string[];
  runtime: number | null;
  seasons: SeasonSummary[];
  similar: FeedItem[];
  tagline: string | null;
  videos: TitleVideo[];
}

const CAST_LIMIT = 24;
const VIDEO_LIMIT = 12;
const SIMILAR_LIMIT = 12;
// most wanted first: a trailer beats a teaser beats a clip
const VIDEO_TYPES = ["Trailer", "Teaser", "Clip", "Featurette"];

function href(item: FeedItem): string {
  return `/media/${TMDBIdToUrlId(
    mediaItemTypeToMediaType(item.type),
    String(item.id),
    item.title,
  )}`;
}

function minutesToLabel(minutes?: number | null): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest ? `${rest}m` : ""}`.trim() : `${rest}m`;
}

/*
 * A series' aggregate credits list every character someone played across the
 * run, with an episode count each; a film's credits carry a single character.
 */
function toCastMembers(data: any, isShow: boolean): CastMember[] {
  const people: any[] = isShow
    ? (data?.aggregate_credits?.cast ?? data?.credits?.cast ?? [])
    : (data?.credits?.cast ?? []);
  return people.slice(0, CAST_LIMIT).map((person) => {
    const roles: any[] = Array.isArray(person.roles)
      ? [...person.roles].sort(
          (a, b) => (b.episode_count ?? 0) - (a.episode_count ?? 0),
        )
      : [];
    const characters: string[] = (
      roles.length ? roles.map((role) => role.character) : [person.character]
    ).filter(Boolean);
    return {
      id: person.id,
      name: person.name,
      role: characters.length ? characters.slice(0, 2).join(" / ") : null,
      photo: person.profile_path
        ? `https://image.tmdb.org/t/p/w185${person.profile_path}`
        : null,
    };
  });
}

function toVideos(data: any): TitleVideo[] {
  const score = (video: any) =>
    (VIDEO_TYPES.length - VIDEO_TYPES.indexOf(video.type)) * 10 +
    (video.official ? 5 : 0);
  const seen = new Set<string>();
  return (data?.videos?.results ?? [])
    .filter(
      (video: any) =>
        video.site === "YouTube" &&
        video.key &&
        VIDEO_TYPES.includes(video.type),
    )
    .sort(
      (a: any, b: any) =>
        score(b) - score(a) ||
        String(b.published_at ?? "").localeCompare(
          String(a.published_at ?? ""),
        ),
    )
    .filter((video: any) => {
      if (seen.has(video.key)) return false;
      seen.add(video.key);
      return true;
    })
    .slice(0, VIDEO_LIMIT)
    .map((video: any) => ({
      key: video.key,
      name: video.name,
      type: video.type,
    }));
}

/** TMDB's recommendations first, then its plainer "similar" list as filler. */
function toSimilar(data: any, self: FeedItem): FeedItem[] {
  const pool: any[] = [
    ...(data?.recommendations?.results ?? []),
    ...(data?.similar?.results ?? []),
  ];
  const seen = new Set<string>([`${self.type}:${self.id}`]);
  const out: FeedItem[] = [];
  pool.forEach((raw) => {
    if (out.length >= SIMILAR_LIMIT) return;
    // appended lists can omit media_type; they are always the same kind
    const match = toFeedItem({
      ...raw,
      media_type: raw?.media_type ?? (self.type === "show" ? "tv" : "movie"),
    });
    if (!match || !(match.backdrop || match.poster)) return;
    const key = `${match.type}:${match.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(match);
  });
  return out;
}

function RoundAction(props: {
  active?: boolean;
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.active}
      onClick={props.onClick}
      className={classNames(
        "flex h-11 w-11 items-center justify-center rounded-full border text-white transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
        props.active
          ? "border-[#FF2A32] bg-[#FF2A32]"
          : "border-white/50 bg-black/35 hover:border-white hover:bg-white/10",
      )}
    >
      {props.children}
    </button>
  );
}

function SectionHeading(props: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={props.id} className="text-2xl font-bold tracking-tight sm:text-3xl">
      {props.children}
    </h3>
  );
}

/*
 * A sideways row the mouse wheel scrolls while the pointer is over it. Once
 * the row reaches either end the wheel goes back to scrolling the dialog, so
 * it never feels stuck on a row.
 */
function ScrollRow(props: { children: React.ReactNode; label: string }) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const onWheel = (event: WheelEvent) => {
      // trackpads and tilt wheels already scroll sideways by themselves
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const max = row.scrollWidth - row.clientWidth;
      if (max <= 0) return;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      if (delta < 0 && row.scrollLeft <= 0) return;
      if (delta > 0 && row.scrollLeft >= max - 1) return;
      event.preventDefault();
      row.scrollLeft = Math.max(0, Math.min(max, row.scrollLeft + delta));
    };
    // passive: false, or preventDefault cannot stop the page scrolling too
    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      ref={rowRef}
      role="list"
      aria-label={props.label}
      className="-mx-5 flex gap-5 overflow-x-auto px-5 pb-4 pt-1 [scrollbar-width:none] sm:-mx-12 sm:px-12 [&::-webkit-scrollbar]:hidden"
    >
      {props.children}
    </div>
  );
}

function TrailerPlayer(props: { video: TitleVideo; onClose: () => void }) {
  const { onClose, video } = props;

  useEffect(() => {
    // Escape closes just the trailer: the dialog listens on document, and a
    // capturing window listener runs before it
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 sm:p-10"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={video.name}
        className="relative w-full max-w-5xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close trailer"
          className="absolute -top-12 right-0 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <Icon icon={Icons.X} />
        </button>
        <div className="aspect-video overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/10">
          <iframe
            title={video.name}
            src={`https://www.youtube.com/embed/${video.key}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="h-full w-full border-0"
          />
        </div>
        <p className="mt-3 text-sm text-white/70">{video.name}</p>
      </div>
    </div>
  );
}

export function MediaInfoDialog(props: {
  item: FeedItem | null;
  onClose: () => void;
  originRect?: OriginRect | null;
  playHref?: string;
}) {
  const { onClose, originRect } = props;
  // a title picked from "More Like This" takes over the open dialog
  const [picked, setPicked] = useState<FeedItem | null>(null);
  const item = picked ?? props.item;
  const navigate = useNavigate();
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [logo, setLogo] = useState<string | null>(null);
  const [artwork, setArtwork] = useState<string | null>(null);
  const [trailer, setTrailer] = useState<string | null>(null);
  const [trailerFailed, setTrailerFailed] = useState(false);
  const [playingVideo, setPlayingVideo] = useState<TitleVideo | null>(null);
  const bookmarks = useBookmarkStore((state) => state.bookmarks);
  const addBookmark = useBookmarkStore((state) => state.addBookmark);
  const removeBookmark = useBookmarkStore((state) => state.removeBookmark);
  const likes = useTasteStore((state) => state.likes);
  const toggleLike = useTasteStore((state) => state.toggleLike);

  const listed = !!item && !!bookmarks[String(item.id)];
  const liked = !!item && !!likes[tasteKey(item)];

  useEffect(() => {
    setPicked(null);
  }, [props.item]);

  // the zoom-from-card entrance belongs to the title the dialog opened on
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!props.item || !panel || !originRect) return;
    const destination = panel.getBoundingClientRect();
    const x =
      originRect.left +
      originRect.width / 2 -
      (destination.left + destination.width / 2);
    const y =
      originRect.top +
      originRect.height / 2 -
      (destination.top + destination.height / 2);
    const sx = Math.max(0.18, originRect.width / destination.width);
    const sy = Math.max(0.18, originRect.height / destination.height);
    panel.style.transform = `translate(${x}px, ${y}px) scale(${sx}, ${sy})`;
    panel.style.opacity = "0.35";
    panel.getBoundingClientRect();
    panel.style.transition =
      "transform 620ms cubic-bezier(0.16, 1, 0.3, 1), opacity 360ms ease";
    panel.style.transform = "translate(0, 0) scale(1)";
    panel.style.opacity = "1";
  }, [props.item, originRect]);

  useEffect(() => {
    if (!item) return undefined;
    let alive = true;
    const isShow = item.type === "show";
    const path = isShow ? "tv" : "movie";
    setDetails(null);
    setEpisodes([]);
    setSelectedSeason(null);
    setLogo(null);
    setArtwork(item.backdrop);
    setTrailer(null);
    setTrailerFailed(false);
    setPlayingVideo(null);
    setLoading(true);

    Promise.all([
      get<any>(`/${path}/${item.id}`, {
        api_key: conf().TMDB_READ_API_KEY,
        append_to_response: isShow
          ? "aggregate_credits,credits,content_ratings,videos,recommendations,similar"
          : "credits,release_dates,videos,recommendations,similar",
        // without this, language=en-US hides trailers that exist only in
        // Japanese - most of them, for anime
        include_video_language: "en,ja,null",
        language: "en-US",
      }),
      fetchTitleLogo(item),
      fetchTrailerKey(item),
    ])
      .then(([data, titleLogo, trailerKey]) => {
        if (!alive) return;
        const seasons = ((data?.seasons ?? []) as SeasonSummary[]).filter(
          (season) => season.season_number > 0,
        );
        const tvRating = data?.content_ratings?.results?.find(
          (rating: any) => rating.iso_3166_1 === "US",
        )?.rating;
        const movieRating = data?.release_dates?.results
          ?.find((release: any) => release.iso_3166_1 === "US")
          ?.release_dates?.find(
            (release: any) => release.certification,
          )?.certification;
        setDetails({
          cast: (data?.credits?.cast ?? [])
            .slice(0, 6)
            .map((actor: any) => actor.name),
          castMembers: toCastMembers(data, isShow),
          certification: tvRating || movieRating || null,
          genres: (data?.genres ?? [])
            .slice(0, 4)
            .map((genre: any) => genre.name),
          runtime: data?.runtime ?? data?.episode_run_time?.[0] ?? null,
          seasons,
          similar: toSimilar(data, item),
          tagline: data?.tagline || null,
          videos: toVideos(data),
        });
        setArtwork(
          data?.backdrop_path
            ? `https://image.tmdb.org/t/p/original${data.backdrop_path}`
            : item.backdrop,
        );
        setSelectedSeason(seasons[0]?.season_number ?? null);
        setLogo(titleLogo);
        setTrailer(trailerKey);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [item]);

  useEffect(() => {
    if (!item || item.type !== "show" || selectedSeason === null)
      return undefined;
    let alive = true;
    setEpisodes([]);
    setEpisodesLoading(true);
    get<any>(`/tv/${item.id}/season/${selectedSeason}`, {
      api_key: conf().TMDB_READ_API_KEY,
      language: "en-US",
    })
      .then((data) => {
        if (alive) setEpisodes(data?.episodes ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setEpisodesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [item, selectedSeason]);

  useEffect(() => {
    if (!item) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [item, onClose]);

  const trailerUnavailable = useCallback(() => setTrailerFailed(true), []);
  const closeTrailer = useCallback(() => setPlayingVideo(null), []);

  if (!item) return null;

  const selectedSeasonData = details?.seasons.find(
    (season) => season.season_number === selectedSeason,
  );
  const firstEpisode = episodes[0];
  const playPath =
    (picked ? undefined : props.playHref) ??
    (item.type === "show" && selectedSeasonData && firstEpisode
      ? `${href(item)}/${selectedSeasonData.id}/${firstEpisode.id}`
      : href(item));

  const play = () => navigate(playPath);
  const toggleList = () => {
    if (listed) removeBookmark(String(item.id));
    else
      addBookmark({
        tmdbId: String(item.id),
        title: item.title,
        type: item.type,
        releaseYear: item.year ?? 0,
        poster: item.poster ?? undefined,
      });
  };
  const openSimilar = (match: FeedItem) => {
    setPicked(match);
    overlayRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const castSection =
    loading || details?.castMembers.length ? (
      <section className="mt-12" aria-labelledby="cast-heading">
        <SectionHeading id="cast-heading">Cast</SectionHeading>
        <div className="mt-5">
          <ScrollRow label={`${item.title} cast`}>
            {!details
              ? [0, 1, 2, 3, 4, 5].map((key) => (
                  <div key={key} aria-hidden="true" className="w-28 shrink-0">
                    <div className="mx-auto h-24 w-24 animate-pulse rounded-full bg-white/10" />
                    <div className="mx-auto mt-3 h-3 w-20 animate-pulse rounded bg-white/10" />
                  </div>
                ))
              : details.castMembers.map((person) => (
                  <div
                    key={person.id}
                    role="listitem"
                    className="w-28 shrink-0 text-center"
                  >
                    <div className="mx-auto h-24 w-24 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10">
                      {person.photo ? (
                        <img
                          src={person.photo}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-2xl font-bold text-white/40">
                          {person.name.charAt(0)}
                        </div>
                      )}
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm font-semibold leading-5">
                      {person.name}
                    </p>
                    {person.role ? (
                      <p className="mt-1 line-clamp-2 text-xs leading-4 text-white/55">
                        {person.role}
                      </p>
                    ) : null}
                  </div>
                ))}
          </ScrollRow>
        </div>
      </section>
    ) : null;

  const trailersSection = details?.videos.length ? (
    <section className="mt-12" aria-labelledby="trailers-heading">
      <SectionHeading id="trailers-heading">Trailers & More</SectionHeading>
      <div className="mt-5">
        <ScrollRow label={`${item.title} trailers`}>
          {details.videos.map((video) => (
            <button
              key={video.key}
              type="button"
              role="listitem"
              onClick={() => setPlayingVideo(video)}
              className="group w-64 shrink-0 text-left focus-visible:outline-none sm:w-72"
            >
              <span className="relative block aspect-video overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10 group-focus-visible:ring-2 group-focus-visible:ring-white">
                <img
                  src={`https://i.ytimg.com/vi/${video.key}/mqdefault.jpg`}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
                <span className="absolute inset-0 grid place-items-center bg-black/20 transition group-hover:bg-black/40">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-white/90 text-black transition group-hover:scale-110">
                    <Icon icon={Icons.PLAY} className="text-sm" />
                  </span>
                </span>
              </span>
              <span className="mt-2 block line-clamp-2 text-sm font-semibold leading-5">
                {video.name}
              </span>
              <span className="text-xs text-white/50">{video.type}</span>
            </button>
          ))}
        </ScrollRow>
      </div>
    </section>
  ) : null;

  const similarSection = details?.similar.length ? (
    <section className="mt-12" aria-labelledby="similar-heading">
      <SectionHeading id="similar-heading">More Like This</SectionHeading>
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {details.similar.map((match) => (
          <button
            key={`${match.type}:${match.id}`}
            type="button"
            onClick={() => openSimilar(match)}
            className="group overflow-hidden rounded-lg bg-[#242424] text-left ring-1 ring-white/5 transition hover:ring-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <span className="relative block aspect-video overflow-hidden bg-white/5">
              <img
                src={(match.backdrop ?? match.poster ?? "").replace(
                  "/w1280/",
                  "/w500/",
                )}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-8 text-sm font-bold leading-5">
                {match.title}
              </span>
            </span>
            <span className="block p-3">
              <span className="flex flex-wrap items-center gap-2 text-xs text-white/60">
                {match.rating ? (
                  <span className="font-semibold text-emerald-400">
                    {Math.round(match.rating * 10)}% match
                  </span>
                ) : null}
                {match.year ? <span>{match.year}</span> : null}
                <span className="rounded border border-white/25 px-1 text-[0.6rem] uppercase">
                  {match.type === "show" ? "Series" : "Film"}
                </span>
              </span>
              <span className="mt-2 line-clamp-3 text-xs leading-5 text-white/55">
                {match.overview || "No synopsis is available yet."}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  ) : null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[90] overflow-y-auto bg-black/75 px-0 py-0 backdrop-blur-sm sm:px-6 sm:py-10"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${item.title} details`}
        className="relative mx-auto min-h-full w-full max-w-5xl overflow-hidden bg-[#151515] text-white shadow-[0_30px_120px_rgba(0,0,0,0.85)] ring-1 ring-white/10 sm:min-h-0 sm:rounded-2xl"
      >
        <section className="relative min-h-[430px] overflow-hidden sm:min-h-[560px]">
          {artwork ? (
            <img
              src={artwork}
              alt=""
              className="absolute inset-0 h-full w-full object-cover object-center"
            />
          ) : (
            <div className="absolute inset-0 bg-neutral-900" />
          )}
          {trailer && !trailerFailed ? (
            <TrailerPreview
              active
              videoKey={trailer}
              onUnavailable={trailerUnavailable}
            />
          ) : null}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/25 to-transparent" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#151515] via-transparent to-black/15" />

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close title details"
            className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/65 text-white ring-1 ring-white/10 transition hover:rotate-90 hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Icon icon={Icons.X} />
          </button>

          <div className="absolute inset-x-0 bottom-0 z-10 px-5 pb-12 sm:px-12 sm:pb-16">
            {logo ? (
              <img
                src={logo}
                alt={item.title}
                className="mb-7 max-h-28 max-w-[70%] object-contain object-left drop-shadow-2xl sm:max-w-[45%]"
              />
            ) : (
              <h2 className="mb-7 max-w-2xl text-4xl font-black tracking-[-0.05em] drop-shadow-xl sm:text-6xl">
                {item.title}
              </h2>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={play}
                className="inline-flex h-11 items-center gap-3 rounded bg-white px-6 font-bold text-black transition hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <Icon icon={Icons.PLAY} />
                Play
              </button>
              <RoundAction
                active={listed}
                label={
                  listed
                    ? `Remove ${item.title} from My List`
                    : `Add ${item.title} to My List`
                }
                onClick={toggleList}
              >
                <span className="text-2xl leading-none">
                  {listed ? "✓" : "+"}
                </span>
              </RoundAction>
              <RoundAction
                active={liked}
                label={liked ? `Unlike ${item.title}` : `I like ${item.title}`}
                onClick={() =>
                  toggleLike({
                    id: item.id,
                    title: item.title,
                    type: item.type,
                  })
                }
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M2 10h4v11H2V10Zm20 1.4c0-.8-.6-1.4-1.4-1.4h-5.1l.8-4.1v-.7c0-.4-.2-.8-.5-1.1L14.7 3 8.2 9.5C8.1 9.7 8 10 8 10.3V19c0 1.1.9 2 2 2h7.7c.8 0 1.5-.5 1.8-1.2l2.3-5.4c.1-.2.2-.5.2-.8v-2.2Z"
                  />
                </svg>
              </RoundAction>
            </div>
          </div>
        </section>

        <div className="px-5 pb-12 sm:px-12">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(240px,0.8fr)]">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-white/70">
                <span className="font-semibold text-emerald-400">
                  {item.rating
                    ? `${Math.round(item.rating * 10)}% match`
                    : "Recommended"}
                </span>
                {item.year ? <span>{item.year}</span> : null}
                {details?.certification ? (
                  <span className="border border-white/40 px-1.5 py-0.5 text-xs">
                    {details.certification}
                  </span>
                ) : null}
                <span>
                  {item.type === "show"
                    ? `${details?.seasons.length || ""} Season${details?.seasons.length === 1 ? "" : "s"}`
                    : minutesToLabel(details?.runtime)}
                </span>
                <span className="rounded border border-white/30 px-1 text-[0.65rem] font-bold">
                  HD
                </span>
              </div>
              {details?.tagline ? (
                <p className="mt-4 text-sm italic text-white/60">
                  {details.tagline}
                </p>
              ) : null}
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/85 sm:text-base">
                {item.overview ||
                  "No synopsis is available for this title yet."}
              </p>
            </div>
            <div className="space-y-3 text-xs leading-5 text-white/50 sm:text-sm">
              {details?.cast.length ? (
                <p>
                  <span className="text-white/35">Cast: </span>
                  <span className="text-white/75">
                    {details.cast.join(", ")}
                  </span>
                </p>
              ) : null}
              {details?.genres.length ? (
                <p>
                  <span className="text-white/35">Genres: </span>
                  <span className="text-white/75">
                    {details.genres.join(", ")}
                  </span>
                </p>
              ) : null}
              <p>
                <span className="text-white/35">This title is: </span>
                <span className="text-white/75">
                  Cinematic, immersive, worth watching
                </span>
              </p>
            </div>
          </div>

          {castSection}

          {item.type === "show" ? (
            <section className="mt-12" aria-labelledby="episodes-heading">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h3
                  id="episodes-heading"
                  className="text-2xl font-bold tracking-tight sm:text-3xl"
                >
                  Episodes
                </h3>
                {details?.seasons.length ? (
                  <select
                    aria-label="Choose season"
                    value={selectedSeason ?? ""}
                    onChange={(event) =>
                      setSelectedSeason(Number(event.target.value))
                    }
                    className="min-w-44 rounded border border-white/25 bg-[#242424] px-4 py-2.5 text-sm font-semibold text-white outline-none focus:border-white"
                  >
                    {details.seasons.map((season) => (
                      <option key={season.id} value={season.season_number}>
                        {season.name} · {season.episode_count} episodes
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>

              <div className="mt-5 divide-y divide-white/10 border-y border-white/10">
                {episodesLoading || loading
                  ? [0, 1, 2].map((key) => (
                      <div key={key} className="flex gap-4 py-5">
                        <div className="h-20 w-36 animate-pulse rounded bg-white/10 sm:h-24 sm:w-44" />
                        <div className="flex-1 space-y-3 py-2">
                          <div className="h-4 w-1/3 animate-pulse rounded bg-white/10" />
                          <div className="h-3 w-4/5 animate-pulse rounded bg-white/10" />
                        </div>
                      </div>
                    ))
                  : episodes.map((episode) => (
                      <button
                        key={episode.id}
                        type="button"
                        onClick={() =>
                          navigate(
                            `${href(item)}/${selectedSeasonData?.id}/${episode.id}`,
                          )
                        }
                        className="group grid w-full grid-cols-[2rem_7rem_minmax(0,1fr)] items-center gap-3 py-5 text-left transition hover:bg-white/[0.045] focus-visible:bg-white/[0.06] focus-visible:outline-none sm:grid-cols-[3rem_13.75rem_minmax(0,1fr)] sm:gap-5 sm:px-3"
                      >
                        <span className="text-center text-lg text-white/50 sm:text-2xl">
                          {episode.episode_number}
                        </span>
                        <span className="relative aspect-video overflow-hidden rounded bg-white/5">
                          {episode.still_path ? (
                            <img
                              src={`https://image.tmdb.org/t/p/w500${episode.still_path}`}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                            />
                          ) : null}
                          <span className="absolute inset-0 grid place-items-center bg-black/0 transition group-hover:bg-black/35">
                            <span className="grid h-9 w-9 scale-75 place-items-center rounded-full bg-white text-black opacity-0 transition group-hover:scale-100 group-hover:opacity-100">
                              <Icon icon={Icons.PLAY} className="text-xs" />
                            </span>
                          </span>
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-start justify-between gap-3 text-sm font-semibold sm:text-base">
                            <span>{episode.name}</span>
                            <span className="shrink-0 text-xs text-white/65 sm:text-sm">
                              {minutesToLabel(episode.runtime)}
                            </span>
                          </span>
                          <span className="mt-2 hidden line-clamp-2 text-xs leading-5 text-white/55 sm:block sm:text-sm">
                            {episode.overview || "Episode details coming soon."}
                          </span>
                        </span>
                      </button>
                    ))}
                {!episodesLoading && !loading && episodes.length === 0 ? (
                  <p className="py-10 text-center text-sm text-white/50">
                    Episode details are not available yet.
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          {trailersSection}
          {similarSection}
        </div>
      </div>
      {playingVideo ? (
        <TrailerPlayer video={playingVideo} onClose={closeTrailer} />
      ) : null}
    </div>
  );
}
