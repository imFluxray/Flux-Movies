import { useCallback, useEffect, useMemo, useRef } from "react";

import { usePlayerStore } from "@/stores/player/store";
import { useVolumeStore } from "@/stores/volume";

import { useCaptions } from "./useCaptions";

export function useInitializePlayer() {
  const display = usePlayerStore((s) => s.display);
  const volume = useVolumeStore((s) => s.volume);

  const init = useCallback(() => {
    display?.setVolume(volume);
  }, [display, volume]);

  return {
    init,
  };
}

export function useInitializeSource() {
  const source = usePlayerStore((s) => s.source);
  const sourceIdentifier = useMemo(
    () => (source ? JSON.stringify(source) : null),
    [source],
  );
  const { selectLastUsedLanguage } = useCaptions();

  const funRef = useRef(selectLastUsedLanguage);
  useEffect(() => {
    funRef.current = selectLastUsedLanguage;
  }, [selectLastUsedLanguage]);

  useEffect(() => {
    if (sourceIdentifier) funRef.current().catch(() => {});
  }, [sourceIdentifier]);
}
