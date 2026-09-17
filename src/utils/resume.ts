import { useMemo } from "react";

import {
  TMDBIdToUrlId,
  mediaItemTypeToMediaType,
} from "@/backend/metadata/tmdb";
import { useProgressStore } from "@/stores/progress";
import { shouldShowProgress } from "@/stores/progress/utils";

/*
 * "Continue watching" state for a title.
 *
 * The decision of whether something counts as partially watched already lives
 * in shouldShowProgress - it knows that a few seconds in is not really started
 * and that the last two minutes are effectively finished, and it picks the
 * right episode for a show. Reusing it keeps this card honest with the
 * Continue Watching row rather than inventing a second set of rules.
 */

export interface ResumeState {
  /** 0-100, for the bar */
  percent: number;
  /** "S1 E3 · 18m left", or just "18m left" for a film */
  detail: string;
  /** deep link straight back to the episode that was in progress */
  href: string;
}

function remainingLabel(duration: number, watched: number): string {
  const left = Math.max(Math.round(duration - watched), 0);
  if (left < 60) return "less than a minute left";
  const minutes = Math.round(left / 60);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m left` : `${hours}h left`;
}

export function useResume(item: {
  id: number | string;
  type: "movie" | "show";
  title: string;
}): ResumeState | null {
  const entry = useProgressStore((s) => s.items[String(item.id)]);

  return useMemo(() => {
    if (!entry) return null;
    const result = shouldShowProgress(entry);
    if (!result.show) return null;

    const { progress, episode, season } = result;
    if (!progress?.duration) return null;

    const base = `/media/${encodeURIComponent(
      TMDBIdToUrlId(
        mediaItemTypeToMediaType(item.type),
        String(item.id),
        item.title,
      ),
    )}`;
    // shows resume on the exact episode, films just reopen
    const href =
      episode && season
        ? `${base}/${encodeURIComponent(season.id)}/${encodeURIComponent(
            episode.id,
          )}`
        : base;

    const remaining = remainingLabel(progress.duration, progress.watched);
    const detail =
      episode && season
        ? `S${season.number} E${episode.number} · ${remaining}`
        : remaining;

    return {
      percent: Math.min(
        100,
        Math.max(0, (progress.watched / progress.duration) * 100),
      ),
      detail,
      href,
    };
  }, [entry, item.id, item.type, item.title]);
}
