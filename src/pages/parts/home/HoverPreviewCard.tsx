import classNames from "classnames";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

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
import { FeedItem } from "@/utils/algorithm";
import { fetchTitleLogo, fetchTrailerKey } from "@/utils/heroMedia";
import { useResume } from "@/utils/resume";

function href(item: FeedItem): string {
  return `/media/${TMDBIdToUrlId(
    mediaItemTypeToMediaType(item.type),
    String(item.id),
    item.title,
  )}`;
}

export interface CardAnchor {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

function CircleButton(props: {
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
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onClick();
      }}
      className={classNames(
        "flex h-9 w-9 items-center justify-center rounded-full border text-white transition duration-150 hover:scale-110 focus-visible:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
        props.active
          ? "border-[#FF2A32] bg-[#FF2A32]"
          : "border-white/45 bg-black/35 hover:border-white hover:bg-white/10",
      )}
    >
      {props.children}
    </button>
  );
}

export function HoverPreviewCard(props: {
  anchor: CardAnchor;
  item: FeedItem;
  onEnter: () => void;
  onExpand: (anchor: CardAnchor) => void;
  onLeave: () => void;
  playHref?: string;
}) {
  const { anchor, item } = props;
  const [resolved, setResolved] = useState(item);
  const [logo, setLogo] = useState<string | null>(null);
  const [trailer, setTrailer] = useState<string | null>(null);
  const [trailerFailed, setTrailerFailed] = useState(false);
  const [closing, setClosing] = useState(false);
  const bookmarks = useBookmarkStore((state) => state.bookmarks);
  const addBookmark = useBookmarkStore((state) => state.addBookmark);
  const removeBookmark = useBookmarkStore((state) => state.removeBookmark);
  const resume = useResume(item);
  const likes = useTasteStore((state) => state.likes);
  const toggleLike = useTasteStore((state) => state.toggleLike);

  const listed = !!bookmarks[String(item.id)];
  const liked = !!likes[tasteKey(item)];

  useEffect(() => {
    let alive = true;
    const path = item.type === "show" ? "tv" : "movie";
    get<any>(`/${path}/${item.id}`, {
      api_key: conf().TMDB_READ_API_KEY,
      language: "en-US",
    })
      .then((data) => {
        if (!alive) return;
        setResolved({
          ...item,
          backdrop: data?.backdrop_path
            ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`
            : item.backdrop,
          overview: data?.overview || item.overview,
          rating:
            typeof data?.vote_average === "number"
              ? data.vote_average
              : item.rating,
        });
      })
      .catch(() => {});
    fetchTitleLogo(item).then((value) => {
      if (alive) setLogo(value);
    });
    fetchTrailerKey(item).then((value) => {
      if (alive) setTrailer(value);
    });
    return () => {
      alive = false;
    };
  }, [item]);

  const unavailable = useCallback(() => setTrailerFailed(true), []);

  const position = useMemo(() => {
    const width = Math.min(520, Math.max(320, window.innerWidth - 24));
    const mediaHeight = width * 0.5625;
    const height = mediaHeight + 154;
    const left = Math.min(
      window.innerWidth - width - 12,
      Math.max(12, anchor.left + anchor.width / 2 - width / 2),
    );
    const top = Math.min(
      window.innerHeight - height - 12,
      Math.max(72, anchor.top + anchor.height / 2 - height / 2),
    );
    const dx = anchor.left + anchor.width / 2 - (left + width / 2);
    const dy = anchor.top + anchor.height / 2 - (top + height / 2);
    return {
      dx,
      dy,
      height,
      left,
      sx: anchor.width / width,
      sy: anchor.height / height,
      top,
      width,
    };
  }, [anchor]);

  const poster = resolved.backdrop ?? resolved.poster;

  return createPortal(
    <article
      role="dialog"
      aria-label={`${item.title} preview`}
      onClick={() => props.onExpand(anchor)}
      onMouseEnter={() => {
        setClosing(false);
        props.onEnter();
      }}
      onMouseLeave={() => {
        setClosing(true);
        window.setTimeout(props.onLeave, 300);
      }}
      className={classNames(
        "flux-hover-card fixed z-[78] cursor-pointer overflow-hidden rounded-xl bg-[#171717] text-white shadow-[0_28px_80px_rgba(0,0,0,0.75)] ring-1 ring-white/15",
        closing && "is-closing",
      )}
      style={
        {
          "--card-dx": `${position.dx}px`,
          "--card-dy": `${position.dy}px`,
          "--card-sx": position.sx,
          "--card-sy": position.sy,
          left: position.left,
          top: position.top,
          width: position.width,
        } as React.CSSProperties
      }
    >
      <div className="relative aspect-video overflow-hidden bg-black">
        {poster ? (
          <img src={poster} alt="" className="h-full w-full object-cover" />
        ) : null}
        {trailer && !trailerFailed ? (
          <TrailerPreview
            active
            videoKey={trailer}
            onUnavailable={unavailable}
          />
        ) : null}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#171717] via-transparent to-black/10" />
        <div className="absolute inset-x-4 bottom-3">
          {logo ? (
            <img
              src={logo}
              alt={item.title}
              className="max-h-14 max-w-[70%] object-contain object-left drop-shadow-xl"
            />
          ) : (
            <h3 className="text-2xl font-bold tracking-[-0.03em] drop-shadow-xl">
              {item.title}
            </h3>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 pt-3">
        <div className="flex items-center gap-2">
          <Link
            to={resume?.href ?? props.playHref ?? href(item)}
            aria-label={
              resume ? `Continue ${item.title}` : `Play ${item.title}`
            }
            onClick={(event) => event.stopPropagation()}
            className={classNames(
              "flex h-9 items-center justify-center rounded-full bg-white text-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF2A32]",
              resume
                ? "gap-2 px-4 text-sm font-semibold hover:scale-105 focus-visible:scale-105"
                : "w-9 hover:scale-110 focus-visible:scale-110",
            )}
          >
            <Icon icon={Icons.PLAY} className="text-xs" />
            {resume ? <span>Continue</span> : null}
          </Link>
          <CircleButton
            active={listed}
            label={
              listed
                ? `Remove ${item.title} from My List`
                : `Add ${item.title} to My List`
            }
            onClick={() => {
              if (listed) removeBookmark(String(item.id));
              else
                addBookmark({
                  tmdbId: String(item.id),
                  title: item.title,
                  type: item.type,
                  releaseYear: item.year ?? 0,
                  poster: item.poster ?? undefined,
                });
            }}
          >
            <span className="text-xl leading-none">{listed ? "✓" : "+"}</span>
          </CircleButton>
          <CircleButton
            active={liked}
            label={liked ? `Unlike ${item.title}` : `I like ${item.title}`}
            onClick={() =>
              toggleLike({ id: item.id, title: item.title, type: item.type })
            }
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path
                fill="currentColor"
                d="M2 10h4v11H2V10Zm20 1.4c0-.8-.6-1.4-1.4-1.4h-5.1l.8-4.1v-.7c0-.4-.2-.8-.5-1.1L14.7 3 8.2 9.5C8.1 9.7 8 10 8 10.3V19c0 1.1.9 2 2 2h7.7c.8 0 1.5-.5 1.8-1.2l2.3-5.4c.1-.2.2-.5.2-.8v-2.2Z"
              />
            </svg>
          </CircleButton>
          <button
            type="button"
            aria-label={`More information about ${item.title}`}
            onClick={(event) => {
              event.stopPropagation();
              props.onExpand(anchor);
            }}
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/45 bg-black/35 text-white transition hover:scale-110 hover:border-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Icon icon={Icons.CHEVRON_DOWN} className="text-base" />
          </button>
        </div>

        {resume ? (
          <div className="mt-3">
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-[#FF2A32] transition-[width] duration-300"
                style={{ width: `${resume.percent}%` }}
              />
            </div>
            <p className="mt-1.5 text-[0.7rem] tracking-wide text-white/60">
              {resume.detail}
            </p>
          </div>
        ) : null}

        <div className="mt-3 flex items-center gap-2 text-xs text-white/65">
          <span className="font-semibold text-emerald-400">
            {resolved.rating
              ? `${Math.round(resolved.rating * 10)}% match`
              : "Recommended"}
          </span>
          {item.year ? <span>{item.year}</span> : null}
          <span className="rounded border border-white/25 px-1 py-0.5">
            {item.type === "show" ? "Series" : "Film"}
          </span>
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-white/60">
          {resolved.overview || "Open this title to see more details."}
        </p>
      </div>
    </article>,
    document.body,
  );
}
