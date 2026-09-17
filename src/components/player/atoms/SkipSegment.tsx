import classNames from "classnames";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Icon, Icons } from "@/components/Icon";
import { Transition } from "@/components/utils/Transition";
import { usePlayerStore } from "@/stores/player/store";

/*
 * Skip intro.
 *
 * Outro is deliberately not handled here any more: the end of an episode is
 * the next-episode button's job, which counts down and moves on by itself.
 * Two competing controls in the same corner was the wrong answer.
 *
 * Shaped to match that button exactly - same height, same weight, one line -
 * so the two never read as different species of control.
 */

interface Segment {
  start: number;
  end: number;
}

const MIN_SEGMENT_SECONDS = 3;
const HIDE_BEFORE_END = 0.5;

function isInside(segment: Segment | undefined, time: number): boolean {
  if (!segment) return false;
  const { start, end } = segment;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (end - start < MIN_SEGMENT_SECONDS) return false;
  return time >= start && time < end - HIDE_BEFORE_END;
}

export function SkipSegment(props: { controlsShown?: boolean }) {
  const { t } = useTranslation();
  const display = usePlayerStore((s) => s.display);
  const time = usePlayerStore((s) => s.progress.time);
  const skips = usePlayerStore((s) => s.source?.skips);

  const intro = useMemo(
    () => (isInside(skips?.intro, time) ? skips!.intro! : null),
    [skips, time],
  );

  const skip = useCallback(() => {
    if (intro) display?.setTime(intro.end);
  }, [intro, display]);

  return (
    <Transition
      animation="slide-up"
      show={!!intro}
      className="pointer-events-none absolute bottom-0 right-[calc(3rem+env(safe-area-inset-right))] z-10"
    >
      <div
        className={classNames(
          "absolute right-0 transition-[bottom] duration-200",
          props.controlsShown
            ? "bottom-[calc(6rem+env(safe-area-inset-bottom))]"
            : "bottom-[calc(3rem+env(safe-area-inset-bottom))]",
        )}
      >
        <button
          type="button"
          onClick={skip}
          className="pointer-events-auto flex h-10 scale-95 items-center justify-center whitespace-nowrap rounded bg-buttons-primary px-6 font-bold text-buttons-primaryText transition-all duration-200 hover:scale-100 hover:bg-buttons-primaryHover"
        >
          <Icon className="mr-1 text-xl" icon={Icons.SKIP_FORWARD} />
          {t("player.skipIntro", { defaultValue: "Skip intro" })}
        </button>
      </div>
    </Transition>
  );
}
