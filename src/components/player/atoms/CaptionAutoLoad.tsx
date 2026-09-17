import { useEffect, useRef } from "react";

import { useCaptions } from "@/components/player/hooks/useCaptions";
import { usePlayerStore } from "@/stores/player/store";
import { useSubtitleStore } from "@/stores/subtitles";

/*
 * Turn subtitles on by themselves.
 *
 * useCaptions already exposed selectLastUsedLanguageIfEnabled(), but nothing
 * ever called it, so captions only appeared if you opened the menu and picked
 * one every single time.
 *
 * `enabled` in the subtitle store is the memory: setLanguage(null) - which is
 * what the disable button does - sets it false, and the store is persisted.
 * So turning subtitles off really does stay off, including across reloads,
 * and this component does nothing until they are turned back on.
 *
 * Renders nothing; it is only here for the effect.
 */
export function CaptionAutoLoad() {
  const { selectLastUsedLanguageIfEnabled } = useCaptions();
  const enabled = useSubtitleStore((s) => s.enabled);
  const currentCaption = usePlayerStore((s) => s.caption.selected);
  const captionList = usePlayerStore((s) => s.captionList);
  const sourceId = usePlayerStore((s) => s.sourceId);
  const attemptedFor = useRef<string | null>(null);

  useEffect(() => {
    // the user explicitly turned them off - respect that and stay out of it
    if (!enabled) return;
    // never fight a caption the user already chose
    if (currentCaption) return;
    if (!captionList.length) return;
    // one attempt per source, or a failed match would retry on every tick
    const key = sourceId ?? "unknown";
    if (attemptedFor.current === key) return;
    attemptedFor.current = key;
    selectLastUsedLanguageIfEnabled().catch(() => {});
  }, [
    enabled,
    currentCaption,
    captionList,
    sourceId,
    selectLastUsedLanguageIfEnabled,
  ]);

  // a new episode deserves a fresh attempt
  useEffect(() => {
    if (!currentCaption) return;
    attemptedFor.current = sourceId ?? "unknown";
  }, [currentCaption, sourceId]);

  return null;
}
