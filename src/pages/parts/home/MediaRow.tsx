import classNames from "classnames";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  TMDBIdToUrlId,
  mediaItemTypeToMediaType,
} from "@/backend/metadata/tmdb";
import { Icon, Icons } from "@/components/Icon";
import {
  CardAnchor,
  HoverPreviewCard,
} from "@/pages/parts/home/HoverPreviewCard";
import { MediaInfoDialog } from "@/pages/parts/home/MediaInfoDialog";
import { RankNumeral } from "@/pages/parts/home/RankNumeral";
import { FeedItem } from "@/utils/algorithm";

/*
 * A horizontal shelf of posters.
 *
 * Rows scroll with native overflow so touch and trackpad behave normally;
 * the arrows just nudge that same scroller by a page. Everything is keyboard
 * reachable, and the whole thing collapses to nothing while loading rather
 * than showing an empty heading.
 */

export function mediaHref(item: FeedItem): string {
  return `/media/${TMDBIdToUrlId(
    mediaItemTypeToMediaType(item.type),
    String(item.id),
    item.title,
  )}`;
}

/** Underlined label that opens a small menu - used for provider and genre. */
const PROVIDER_LOGOS: Record<number, string> = {
  8: "https://image.tmdb.org/t/p/w92/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg",
  9: "https://image.tmdb.org/t/p/w92/pvske1MyAoymrs5bguRfVqYiM9a.jpg",
  15: "https://image.tmdb.org/t/p/w92/bxBlRPEPpMVDc4jMhSrTf2339DW.jpg",
  337: "https://image.tmdb.org/t/p/w92/97yvRBw1GzX7fXprcF80er19ot.jpg",
  350: "https://image.tmdb.org/t/p/w92/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg",
  386: "https://image.tmdb.org/t/p/w92/2aGrp1xw3qhwCYvNGAJZPdjfeeX.jpg",
  531: "https://image.tmdb.org/t/p/w92/h5DcR0J2EESLitnhR8xLG1QymTE.jpg",
  1899: "https://image.tmdb.org/t/p/w92/jbe4gVSfRlbPTdESXhEKpornsfu.jpg",
};

// One coherent outline family, with a distinct glyph for every TMDB genre.
const GENRE_PATHS: Record<number, string> = {
  12: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm4-14-3 5-5 3 3-5 5-3Z",
  14: "m15 4 5 5L8 21l-5-5L15 4Zm-9-2v4M4 4h4M18 16v5M15.5 18.5h5",
  16: "m12 3 2.3 4.7 5.2.8-3.8 3.7.9 5.3-4.6-2.5-4.6 2.5.9-5.3-3.8-3.7 5.2-.8L12 3Z",
  18: "M4 5c4-2 7-2 8 1v10c-1-3-4-3-8-1V5Zm16 0c-4-2-7-2-8 1v10c1-3 4-3 8-1V5ZM7 9h.01M17 9h.01",
  27: "M12 3c-5 0-8 4-8 9v8l3-2 2 2 3-2 3 2 2-2 3 2v-8c0-5-3-9-8-9ZM9 11h.01M15 11h.01",
  28: "m13 2-2 7h6l-7 13 2-8H6l7-12Z",
  35: "M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
  36: "M3 21h18M5 18h14M6 10v8m4-8v8m4-8v8m4-8v8M4 7l8-4 8 4H4Z",
  37: "M3 16c3-1 4-4 5-8 3 4 5 6 8 8 2-2 3-3 5-3v7H3v-4Zm5 0h8",
  53: "M3 12h4l2-5 4 10 2-5h6",
  80: "M7 8a4 4 0 1 0 4 4V8a4 4 0 1 0-4 4m4 0h2",
  99: "M6 2h9l4 4v16H6V2Zm8 0v5h5M9 12h7M9 16h7",
  878: "M14 4c3-2 5-2 7-2 0 2 0 4-2 7l-6 6-4-4 5-7ZM9 11l-4 1-3 3 6 1m5-1 1 6 3-3 1-4M7 19l-2 2",
  9648: "m21 21-4.4-4.4M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z",
  10402:
    "M9 18V5l11-2v13M9 9l11-2M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm11-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  10749:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  10751:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  10752: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-4-6 8-8m-8 0 8 8",
  10770: "M4 6h16v12H4V6Zm5-4 3 4 3-4",
};

function SwitcherGlyph(props: { id: number; kind: "provider" | "genre" }) {
  if (props.kind === "provider") {
    return (
      <span className="h-5 w-5 shrink-0 overflow-hidden rounded-lg bg-white/10 ring-1 ring-white/20 shadow-sm">
        <img
          src={PROVIDER_LOGOS[props.id]}
          alt=""
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  const path = GENRE_PATHS[props.id] ?? "M4 5h16v14H4zM8 2v3M16 2v3";
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RowSwitcher<T extends { id: number; name: string }>(props: {
  options: T[];
  value: number;
  onChange: (id: number) => void;
  kind: "provider" | "genre";
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const current = props.options.find((o) => o.id === props.value);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="group relative inline-flex items-center gap-2 pb-1 text-white"
      >
        {current ? <SwitcherGlyph {...current} kind={props.kind} /> : null}
        <span>{current?.name ?? "Select"}</span>
        <Icon
          icon={Icons.CHEVRON_DOWN}
          className={classNames(
            "text-base transition-transform duration-200",
            open && "rotate-180",
          )}
        />
        <span className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 rounded-full bg-[#FF2A32] transition-transform duration-300 ease-out group-hover:scale-x-100 group-focus-visible:scale-x-100" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full z-30 mt-2 max-h-72 w-52 overflow-y-auto rounded-xl border border-video-context-border bg-video-context-background p-1.5 shadow-2xl"
        >
          {props.options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === props.value}
              onClick={() => {
                props.onChange(o.id);
                setOpen(false);
              }}
              className={classNames(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                o.id === props.value
                  ? "bg-video-context-hoverColor text-white"
                  : "text-type-secondary hover:bg-video-context-hoverColor hover:text-white",
              )}
            >
              <SwitcherGlyph {...o} kind={props.kind} />
              <span>{o.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PosterCard(props: {
  item: FeedItem;
  onExpand: (item: FeedItem, anchor: CardAnchor) => void;
  rank?: number;
}) {
  const { item, rank } = props;
  const cardRef = useRef<HTMLAnchorElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<CardAnchor | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };

  const open = () => {
    cancelClose();
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      const rect = cardRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
      });
    }, 420);
  };

  const close = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => setAnchor(null), 180);
  };

  useEffect(
    () => () => {
      if (openTimer.current) window.clearTimeout(openTimer.current);
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  return (
    <>
      <Link
        ref={cardRef}
        to={mediaHref(item)}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={(event) => {
          event.preventDefault();
          const rect = cardRef.current?.getBoundingClientRect();
          if (!rect) return;
          props.onExpand(item, {
            bottom: rect.bottom,
            height: rect.height,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            width: rect.width,
          });
        }}
        className={classNames(
          "group relative flex-shrink-0 snap-start rounded-lg outline-none",
          rank
            ? "pl-[4.8rem] sm:pl-[5.8rem]"
            : "w-[8.5rem] sm:w-[10rem] md:w-[11.5rem]",
        )}
      >
        {rank ? (
          <RankNumeral
            rank={rank}
            className="pointer-events-none absolute bottom-0 left-0 h-full select-none"
          />
        ) : null}
        <div
          className={classNames(
            "relative overflow-hidden rounded-lg bg-mediaCard-hoverBackground transition-transform duration-300 ease-out group-hover:scale-[1.04] group-focus-visible:scale-[1.04]",
            rank ? "z-10 w-[7.5rem] sm:w-[9rem]" : "w-full",
          )}
        >
          <div className="aspect-[2/3] w-full">
            {item.poster ? (
              <img
                src={item.poster}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-type-dimmed">
                {item.title}
              </div>
            )}
          </div>
          <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-white/10 transition-colors group-hover:ring-[#FF2A32]/70" />
        </div>
        {!rank ? (
          <p className="mt-2 line-clamp-2 text-sm text-type-secondary transition-colors group-hover:text-white">
            {item.title}
          </p>
        ) : null}
      </Link>

      {anchor ? (
        <HoverPreviewCard
          item={item}
          anchor={anchor}
          onEnter={cancelClose}
          onLeave={close}
          onExpand={(origin) => {
            setAnchor(null);
            props.onExpand(item, origin);
          }}
        />
      ) : null}
    </>
  );
}

export function MediaRow(props: {
  title: string;
  items: FeedItem[];
  loading?: boolean;
  ranked?: boolean;
  /** rendered next to the title, e.g. the provider or genre switcher */
  control?: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [info, setInfo] = useState<{
    anchor: CardAnchor;
    item: FeedItem;
  } | null>(null);

  const sync = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    sync();
  }, [sync, props.items]);

  const page = (dir: -1 | 1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  // an empty row is worse than no row - drop it entirely once loaded
  if (!props.loading && props.items.length === 0) return null;

  return (
    <section className="relative">
      <div className="mb-3 flex items-baseline gap-2.5">
        {props.title ? (
          <h2 className="text-lg font-semibold tracking-tight text-white sm:text-xl">
            {props.title}
          </h2>
        ) : null}
        {props.control}
      </div>

      <div className="group/row relative">
        {[-1, 1].map((dir) => {
          const hidden = dir === -1 ? atStart : atEnd;
          return (
            <button
              key={dir}
              type="button"
              aria-label={dir === -1 ? "Scroll left" : "Scroll right"}
              onClick={() => page(dir as -1 | 1)}
              className={classNames(
                "absolute top-0 bottom-0 z-20 hidden w-12 items-center justify-center bg-gradient-to-r from-background-main/90 to-transparent opacity-0 transition-opacity duration-200 md:flex",
                "group-hover/row:opacity-100 focus-visible:opacity-100",
                dir === -1 ? "left-0" : "right-0 rotate-180",
                hidden && "pointer-events-none !opacity-0",
              )}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/70 ring-1 ring-white/15 backdrop-blur">
                <Icon
                  icon={Icons.CHEVRON_LEFT}
                  className="text-lg text-white"
                />
              </span>
            </button>
          );
        })}

        <div
          ref={scroller}
          onScroll={sync}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto scrollbar-none sm:gap-4"
          style={{ scrollbarWidth: "none" }}
        >
          {props.loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div
                  // eslint-disable-next-line react/no-array-index-key
                  key={i}
                  className="w-[8.5rem] flex-shrink-0 sm:w-[10rem] md:w-[11.5rem]"
                >
                  <div className="aspect-[2/3] w-full animate-pulse rounded-lg bg-mediaCard-hoverBackground" />
                </div>
              ))
            : props.items.map((item, i) => (
                <PosterCard
                  key={`${item.type}-${item.id}`}
                  item={item}
                  onExpand={(selected, anchor) =>
                    setInfo({ item: selected, anchor })
                  }
                  rank={props.ranked ? i + 1 : undefined}
                />
              ))}
        </div>
      </div>
      <MediaInfoDialog
        item={info?.item ?? null}
        originRect={info?.anchor}
        onClose={() => setInfo(null)}
      />
    </section>
  );
}
