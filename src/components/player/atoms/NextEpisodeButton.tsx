import classNames from "classnames";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsync } from "react-use";

import { getMetaFromId } from "@/backend/metadata/getmeta";
import { MWMediaType, MWSeasonMeta } from "@/backend/metadata/types/mw";
import { Icon, Icons } from "@/components/Icon";
import { usePlayerMeta } from "@/components/player/hooks/usePlayerMeta";
import { Transition } from "@/components/utils/Transition";
import { PlayerMeta } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";
import { useProgressStore } from "@/stores/progress";
import { isAutoplayAllowed } from "@/utils/autoplay";

import { hasAired } from "../utils/aired";

function shouldShowNextEpisodeButton(
  time: number,
  duration: number,
): "always" | "hover" | "none" {
  const percentage = time / duration;
  const secondsFromEnd = duration - time;
  if (secondsFromEnd <= 30) return "always";
  if (percentage >= 0.93) return "hover";
  return "none";
}

function Button(props: {
  className: string;
  onClick?: () => void;
  children: React.ReactNode;
  /** 0-1; paints a fill behind the label as the outro runs out */
  fill?: number;
}) {
  return (
    <button
      className={classNames(
        "font-bold rounded h-10 w-40 scale-95 hover:scale-100 transition-all duration-200 relative overflow-hidden",
        props.className,
      )}
      type="button"
      onClick={props.onClick}
    >
      {props.fill !== undefined ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-white/25"
          style={{
            width: `${Math.min(100, Math.max(0, props.fill * 100))}%`,
            // driven by playback time, so it pauses when the video does
            transition: "width 250ms linear",
          }}
        />
      ) : null}
      <span className="relative flex items-center justify-center">
        {props.children}
      </span>
    </button>
  );
}

function useSeasons(
  mediaId: string | undefined,
  isLastEpisode: boolean = false,
) {
  const state = useAsync(async () => {
    if (isLastEpisode) {
      if (!mediaId) return null;
      const data = await getMetaFromId(MWMediaType.SERIES, mediaId);
      if (data?.meta.type !== MWMediaType.SERIES) return null;
      return data.meta.seasons;
    }
  }, [mediaId, isLastEpisode]);

  return state;
}

function useNextSeasonEpisode(
  nextSeason: MWSeasonMeta | undefined,
  mediaId: string | undefined,
) {
  const state = useAsync(async () => {
    if (nextSeason) {
      if (!mediaId) return null;
      const data = await getMetaFromId(
        MWMediaType.SERIES,
        mediaId,
        nextSeason?.id,
      );
      if (data?.meta.type !== MWMediaType.SERIES) return null;

      const nextSeasonEpisodes = data?.meta?.seasonData?.episodes
        .filter((episode) => hasAired(episode.air_date))
        .map((episode) => ({
          number: episode.number,
          title: episode.title,
          tmdbId: episode.id,
        }));

      if (nextSeasonEpisodes.length > 0) return nextSeasonEpisodes[0];
    }
  }, [mediaId, nextSeason?.id]);
  return state;
}

export function NextEpisodeButton(props: {
  controlsShowing: boolean;
  onChange?: (meta: PlayerMeta) => void;
}) {
  const { t } = useTranslation();
  const duration = usePlayerStore((s) => s.progress.duration);
  const isHidden = usePlayerStore((s) => s.interface.hideNextEpisodeBtn);
  const meta = usePlayerStore((s) => s.meta);
  const { setDirectMeta } = usePlayerMeta();
  const metaType = usePlayerStore((s) => s.meta?.type);
  const time = usePlayerStore((s) => s.progress.time);
  const showingState = shouldShowNextEpisodeButton(time, duration);
  const status = usePlayerStore((s) => s.status);
  const setShouldStartFromBeginning = usePlayerStore(
    (s) => s.setShouldStartFromBeginning,
  );
  const updateItem = useProgressStore((s) => s.updateItem);
  const enableAutoplay = usePreferencesStore((s) => s.enableAutoplay);

  const isLastEpisode =
    !meta?.episode?.number || !meta?.episodes?.at(-1)?.number
      ? false
      : meta.episode.number === meta.episodes.at(-1)!.number;

  const seasons = useSeasons(meta?.tmdbId, isLastEpisode);

  const nextSeason = seasons.value?.find(
    (season) => season.number === (meta?.season?.number ?? 0) + 1,
  );

  const nextSeasonEpisode = useNextSeasonEpisode(nextSeason, meta?.tmdbId);
  const hasAutoplayed = useRef(true);
  const awaitingFreshPlayback = useRef(true);
  const [watchingCredits, setWatchingCredits] = useState(false);

  /*
   * A new episode starts disarmed. Until its source loads, the store still
   * holds the previous episode's position - already past the outro - so
   * re-arming here fired auto-next again at once, and again, until it ran out
   * of episodes. It re-arms below, once playback is seen before the outro.
   */
  useEffect(() => {
    setWatchingCredits(false);
    hasAutoplayed.current = true;
    awaitingFreshPlayback.current = true;
  }, [meta?.episode?.tmdbId]);

  const skips = usePlayerStore((s) => s.source?.skips);
  // Once the outro starts this button takes over the end of the episode: it
  // counts down and moves on by itself, unless the viewer says they want to
  // watch the credits.
  const outro = skips?.outro;

  useEffect(() => {
    if (!awaitingFreshPlayback.current || duration <= 0) return;
    const endingAt = duration - duration / 100;
    if (time < Math.min(outro?.start ?? endingAt, endingAt)) {
      awaitingFreshPlayback.current = false;
      hasAutoplayed.current = false;
    }
  }, [time, duration, outro]);
  const inOutro =
    !!outro &&
    Number.isFinite(outro.start) &&
    Number.isFinite(outro.end) &&
    outro.end - outro.start >= 3 &&
    time >= outro.start;
  const outroProgress =
    inOutro && outro ? (time - outro.start) / (outro.end - outro.start) : 0;

  let show = false;
  if (inOutro && !watchingCredits) show = true;
  else if (showingState === "always") show = true;
  else if (showingState === "hover" && props.controlsShowing) show = true;
  if (isHidden || status !== "playing" || duration === 0) show = false;

  const animation = showingState === "hover" ? "slide-up" : "fade";
  let bottom = "bottom-[calc(6rem+env(safe-area-inset-bottom))]";
  if (showingState === "always")
    bottom = props.controlsShowing
      ? bottom
      : "bottom-[calc(3rem+env(safe-area-inset-bottom))]";

  const nextEp = isLastEpisode
    ? nextSeasonEpisode.value
    : meta?.episodes?.find(
        (v) => v.number === (meta?.episode?.number ?? 0) + 1,
      );

  const loadNextEpisode = useCallback(() => {
    if (!meta || !nextEp) return;
    const metaCopy = { ...meta };
    metaCopy.episode = nextEp;
    metaCopy.season =
      isLastEpisode && nextSeason
        ? {
            ...nextSeason,
            tmdbId: nextSeason.id,
          }
        : metaCopy.season;
    setShouldStartFromBeginning(true);
    setDirectMeta(metaCopy);
    props.onChange?.(metaCopy);
    const defaultProgress = { duration: 0, watched: 0 };
    updateItem({
      meta: metaCopy,
      progress: defaultProgress,
    });
  }, [
    setDirectMeta,
    nextEp,
    meta,
    props,
    setShouldStartFromBeginning,
    updateItem,
    isLastEpisode,
    nextSeason,
  ]);

  const startCurrentEpisodeFromBeginning = useCallback(() => {
    if (!meta || !meta.episode) return;
    const metaCopy = { ...meta };
    setShouldStartFromBeginning(true);
    setDirectMeta(metaCopy);
    props.onChange?.(metaCopy);
    const defaultProgress = { duration: 0, watched: 0 };
    updateItem({
      meta: metaCopy,
      progress: defaultProgress,
    });
  }, [setDirectMeta, meta, props, setShouldStartFromBeginning, updateItem]);

  // The outro countdown. Deliberately keyed on playback time rather than a
  // timer, so pausing pauses it and scrubbing back cancels it.
  useEffect(() => {
    if (!enableAutoplay || metaType !== "show") return;
    if (!inOutro || watchingCredits) return;
    if (outroProgress < 1 || hasAutoplayed.current) return;
    hasAutoplayed.current = true;
    loadNextEpisode();
  }, [
    enableAutoplay,
    metaType,
    inOutro,
    watchingCredits,
    outroProgress,
    loadNextEpisode,
  ]);

  useEffect(() => {
    if (!enableAutoplay || metaType !== "show") return;
    const onePercent = duration / 100;
    const isEnding = time >= duration - onePercent && duration !== 0;

    // no re-arming on a reset here: that happens once fresh playback is seen
    if (isEnding && isAutoplayAllowed() && !hasAutoplayed.current) {
      hasAutoplayed.current = true;
      loadNextEpisode();
    }
  }, [duration, enableAutoplay, loadNextEpisode, metaType, time]);

  if (!meta?.episode || !nextEp) return null;
  if (metaType !== "show") return null;

  return (
    <Transition
      animation={animation}
      show={show}
      className="absolute right-[calc(3rem+env(safe-area-inset-right))] bottom-0"
    >
      <div
        className={classNames([
          "absolute bottom-0 right-0 transition-[bottom] duration-200 flex items-center space-x-3",
          bottom,
        ])}
      >
        <Button
          className="py-px box-content bg-buttons-secondary hover:bg-buttons-secondaryHover bg-opacity-90 text-buttons-secondaryText justify-center items-center"
          onClick={() =>
            inOutro
              ? setWatchingCredits(true)
              : startCurrentEpisodeFromBeginning()
          }
        >
          {inOutro
            ? t("player.nextEpisode.credits", { defaultValue: "View credits" })
            : t("player.nextEpisode.replay")}
        </Button>
        <Button
          onClick={() => loadNextEpisode()}
          fill={inOutro && enableAutoplay ? outroProgress : undefined}
          className="bg-buttons-primary hover:bg-buttons-primaryHover text-buttons-primaryText flex justify-center items-center"
        >
          <Icon className="text-xl mr-1" icon={Icons.SKIP_EPISODE} />
          {isLastEpisode && nextEp
            ? t("player.nextEpisode.nextSeason")
            : t("player.nextEpisode.next")}
        </Button>
      </div>
    </Transition>
  );
}
