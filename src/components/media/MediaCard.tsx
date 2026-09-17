import classNames from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { mediaItemToId } from "@/backend/metadata/tmdb";
import { DotList } from "@/components/text/DotList";
import { Flare } from "@/components/utils/Flare";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSearchQuery } from "@/hooks/useSearchQuery";
import {
  CardAnchor,
  HoverPreviewCard,
} from "@/pages/parts/home/HoverPreviewCard";
import { MediaInfoDialog } from "@/pages/parts/home/MediaInfoDialog";
import { FeedItem } from "@/utils/algorithm";
import { MediaItem } from "@/utils/mediaTypes";

import { MediaBookmarkButton } from "./MediaBookmark";
import { IconPatch } from "../buttons/IconPatch";
import { Icons } from "../Icon";

export interface MediaCardProps {
  media: MediaItem;
  linkable?: boolean;
  series?: {
    episode: number;
    season?: number;
    episodeId: string;
    seasonId: string;
  };
  percentage?: number;
  closable?: boolean;
  onClose?: () => void;
}

function checkReleased(media: MediaItem): boolean {
  const isReleasedYear = Boolean(
    media.year && media.year <= new Date().getFullYear(),
  );
  const isReleasedDate = Boolean(
    media.release_date && media.release_date <= new Date(),
  );

  // If the media has a release date, use that, otherwise use the year
  const isReleased = media.release_date ? isReleasedDate : isReleasedYear;

  return isReleased;
}

function MediaCardContent({
  media,
  linkable,
  series,
  percentage,
  closable,
  onClose,
}: MediaCardProps) {
  const { t } = useTranslation();
  const percentageString = `${Math.round(percentage ?? 0).toFixed(0)}%`;

  const isReleased = useCallback(() => checkReleased(media), [media]);

  const canLink = linkable && !closable && isReleased();

  const dotListContent = [t(`media.types.${media.type}`)];

  const [searchQuery] = useSearchQuery();

  const { isMobile } = useIsMobile();

  if (media.year) {
    dotListContent.push(media.year.toFixed());
  }

  if (!isReleased()) {
    dotListContent.push(t("media.unreleased"));
  }

  return (
    <Flare.Base
      className={`group -m-[0.705em] rounded-xl bg-background-main transition-colors duration-300 focus:relative focus:z-10 ${
        canLink ? "hover:bg-mediaCard-hoverBackground tabbable" : ""
      }`}
      tabIndex={canLink ? 0 : -1}
      onKeyUp={(e) => e.key === "Enter" && e.currentTarget.click()}
    >
      <Flare.Light
        flareSize={300}
        cssColorVar="--colors-mediaCard-hoverAccent"
        backgroundClass="bg-mediaCard-hoverBackground duration-100"
        className={classNames({
          "rounded-xl bg-background-main group-hover:opacity-100": canLink,
        })}
      />
      <Flare.Child
        className={`pointer-events-auto relative mb-2 p-[0.4em] transition-transform duration-300 ${
          canLink ? "group-hover:scale-95" : "opacity-60"
        }`}
      >
        <div
          className={classNames(
            "relative mb-4 pb-[150%] w-full overflow-hidden rounded-xl bg-mediaCard-hoverBackground bg-cover bg-center transition-[border-radius] duration-300",
            {
              "group-hover:rounded-lg": canLink,
            },
          )}
          style={{
            backgroundImage: media.poster ? `url(${media.poster})` : undefined,
          }}
        >
          {series ? (
            <div
              className={[
                "absolute right-2 top-2 rounded-md bg-mediaCard-badge px-2 py-1 transition-colors",
              ].join(" ")}
            >
              <p
                className={[
                  "text-center text-xs font-bold text-mediaCard-badgeText transition-colors",
                  closable ? "" : "group-hover:text-white",
                ].join(" ")}
              >
                {t("media.episodeDisplay", {
                  season: series.season || 1,
                  episode: series.episode,
                })}
              </p>
            </div>
          ) : null}

          {percentage !== undefined ? (
            <>
              <div
                className={`absolute inset-x-0 -bottom-px pb-1 h-12 bg-gradient-to-t from-mediaCard-shadow to-transparent transition-colors ${
                  canLink ? "group-hover:from-mediaCard-hoverShadow" : ""
                }`}
              />
              <div
                className={`absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-mediaCard-shadow to-transparent transition-colors ${
                  canLink ? "group-hover:from-mediaCard-hoverShadow" : ""
                }`}
              />
              <div className="absolute inset-x-0 bottom-0 p-3">
                <div className="relative h-1 overflow-hidden rounded-full bg-mediaCard-barColor">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-mediaCard-barFillColor"
                    style={{
                      width: percentageString,
                    }}
                  />
                </div>
              </div>
            </>
          ) : null}

          <div
            className={classNames("absolute", {
              "bookmark-button": !isMobile,
            })}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <MediaBookmarkButton media={media} />
          </div>

          {searchQuery.length > 0 && !closable ? (
            <div
              className="absolute"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <MediaBookmarkButton media={media} />
            </div>
          ) : null}

          <div
            className={`absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${
              closable ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            <IconPatch
              clickable
              className="text-2xl text-white transition-transform hover:scale-110 duration-300"
              onClick={() => closable && onClose?.()}
              icon={Icons.X}
            />
            <span className="text-xs font-medium text-white/70">
              {t("media.removeFromList", { defaultValue: "Remove" })}
            </span>
          </div>
        </div>
        <h1
          className={`mb-1 line-clamp-3 max-h-[4.5rem] text-ellipsis break-words font-bold text-white transition-opacity duration-300 ${
            closable ? "opacity-40" : ""
          }`}
        >
          <span>{media.title}</span>
        </h1>
        <DotList
          className={`text-xs transition-opacity duration-300 ${
            closable ? "opacity-40" : ""
          }`}
          content={dotListContent}
        />
      </Flare.Child>
    </Flare.Base>
  );
}

export function MediaCard(props: MediaCardProps) {
  const content = <MediaCardContent {...props} />;
  const rootRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<CardAnchor | null>(null);
  const [info, setInfo] = useState(false);

  const isReleased = useCallback(
    () => checkReleased(props.media),
    [props.media],
  );

  const canLink = props.linkable && !props.closable && isReleased();

  let link = canLink
    ? `/media/${encodeURIComponent(mediaItemToId(props.media))}`
    : "#";
  if (canLink && props.series) {
    if (props.series.season === 0 && !props.series.episodeId) {
      link += `/${encodeURIComponent(props.series.seasonId)}`;
    } else {
      link += `/${encodeURIComponent(
        props.series.seasonId,
      )}/${encodeURIComponent(props.series.episodeId)}`;
    }
  }

  const feed = useMemo<FeedItem>(
    () => ({
      backdrop: null,
      id: Number(props.media.id),
      overview: "",
      poster: props.media.poster ?? null,
      rating: null,
      title: props.media.title,
      type: props.media.type,
      year: props.media.year ?? null,
    }),
    [props.media],
  );

  const readAnchor = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
    };
  }, []);

  const open = useCallback(() => {
    if (!canLink) return;
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      const next = readAnchor();
      if (next) setAnchor(next);
    }, 420);
  }, [canLink, readAnchor]);

  const close = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => setAnchor(null), 330);
  }, []);

  useEffect(
    () => () => {
      if (openTimer.current) window.clearTimeout(openTimer.current);
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  if (!canLink) return <span>{content}</span>;
  return (
    <>
      <div
        ref={rootRef}
        role="button"
        tabIndex={0}
        aria-label={`More information about ${props.media.title}`}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={() => setInfo(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setInfo(true);
          }
        }}
        className="tabbable cursor-pointer rounded-xl"
      >
        {content}
      </div>
      {anchor ? (
        <HoverPreviewCard
          anchor={anchor}
          item={feed}
          playHref={link}
          onEnter={() => {
            if (closeTimer.current) window.clearTimeout(closeTimer.current);
          }}
          onLeave={() => setAnchor(null)}
          onExpand={() => {
            setAnchor(null);
            setInfo(true);
          }}
        />
      ) : null}
      <MediaInfoDialog
        item={info ? feed : null}
        playHref={link}
        originRect={readAnchor()}
        onClose={() => setInfo(false)}
      />
    </>
  );
}
