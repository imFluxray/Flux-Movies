import classNames from "classnames";
import { useEffect, useMemo, useRef, useState } from "react";

import { Icon, Icons } from "@/components/Icon";
import { Transition } from "@/components/utils/Transition";
import { usePlayerStore } from "@/stores/player/store";
import { getPreferredAnimeAudio } from "@/utils/animeAudio";

/*
 * Explains what an episode is missing, rather than leaving it a mystery.
 *
 * Skip markers and English dubs are contributed upstream, so a simulcast that
 * aired this week usually has neither yet. Without a word from us that reads
 * as the app being broken - the skip button "not working" - so it says so
 * once, briefly, and gets out of the way.
 */

const AUTO_DISMISS_MS = 9000;

export function PlaybackNotice(props: { controlsShown?: boolean }) {
  const source = usePlayerStore((s) => s.source);
  const sourceId = usePlayerStore((s) => s.sourceId);
  const status = usePlayerStore((s) => s.status);
  const time = usePlayerStore((s) => s.progress.time);

  const [dismissed, setDismissed] = useState<string | null>(null);
  const shownFor = useRef<string | null>(null);

  const messages = useMemo(() => {
    const variants = source?.audioVariants ?? [];
    // audio variants are only attached by the anime path, so they are how we
    // know these expectations apply at all
    if (!variants.length) return [];

    const out: string[] = [];
    const preferred = getPreferredAnimeAudio();
    const hasPreferred = variants.some((v) => v.id === preferred);
    if (preferred === "dub" && !hasPreferred) {
      out.push(
        "There's no English dub for this episode yet, so it's playing subtitled.",
      );
    }

    const skips = source?.skips;
    if (!skips?.intro && !skips?.outro) {
      out.push("Skip intro isn't available for this episode yet.");
    }
    return out;
  }, [source]);

  const key = `${sourceId ?? "none"}`;
  const show =
    messages.length > 0 &&
    status === "playing" &&
    // let playback settle first; a notice over a black screen is noise
    time > 2 &&
    dismissed !== key;

  useEffect(() => {
    if (!show) return;
    if (shownFor.current === key) return;
    shownFor.current = key;
    const timer = window.setTimeout(() => setDismissed(key), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [show, key]);

  return (
    <Transition
      animation="slide-up"
      show={show}
      className="pointer-events-none absolute bottom-0 left-[calc(3rem+env(safe-area-inset-left))] z-10"
    >
      <div
        className={classNames(
          "absolute left-0 transition-[bottom] duration-200",
          props.controlsShown
            ? "bottom-[calc(6rem+env(safe-area-inset-bottom))]"
            : "bottom-[calc(3rem+env(safe-area-inset-bottom))]",
        )}
      >
        <div className="pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl border border-white/15 bg-black/70 px-4 py-3 text-sm text-white/80 shadow-lg backdrop-blur-md">
          <Icon
            icon={Icons.CIRCLE_EXCLAMATION}
            className="mt-0.5 flex-shrink-0 text-base text-[#FF2A32]"
          />
          <div className="min-w-0">
            {messages.map((message) => (
              <p key={message} className="leading-snug">
                {message}
              </p>
            ))}
            <p className="mt-1 text-xs text-white/45">
              Newly released episodes can take a few days to get these.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(key)}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-white/40 transition-colors hover:text-white"
          >
            <Icon icon={Icons.X} className="text-[0.6rem]" />
          </button>
        </div>
      </div>
    </Transition>
  );
}
