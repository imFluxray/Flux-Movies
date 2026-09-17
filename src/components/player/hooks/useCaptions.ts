import { iso6393To1 } from "iso-639-3";
import { useCallback, useMemo } from "react";
import subsrt from "subsrt-ts";

import { downloadCaption, downloadWebVTT } from "@/backend/helpers/subs";
import { useLanguageStore } from "@/stores/language";
import { Caption, CaptionListItem } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { useSubtitleStore } from "@/stores/subtitles";

import {
  filterDuplicateCaptionCues,
  parseVttSubtitles,
} from "../utils/captions";

function baseLanguageCode(language: string): string {
  const base = language.trim().toLowerCase().replace(/_/g, "-").split("-")[0];
  return base.length === 3 ? (iso6393To1[base] ?? base) : base;
}

export function findCaptionForLanguage(
  captions: CaptionListItem[],
  preferredLanguage: string,
): CaptionListItem | undefined {
  const exact = captions.find(
    (caption) =>
      caption.language.toLowerCase() === preferredLanguage.toLowerCase(),
  );
  if (exact) return exact;
  const preferredBase = baseLanguageCode(preferredLanguage);
  return captions.find(
    (caption) => baseLanguageCode(caption.language) === preferredBase,
  );
}

export function useCaptions() {
  const setLanguage = useSubtitleStore((s) => s.setLanguage);
  const enabled = useSubtitleStore((s) => s.enabled);
  const resetSubtitleSpecificSettings = useSubtitleStore(
    (s) => s.resetSubtitleSpecificSettings,
  );
  const setCaption = usePlayerStore((s) => s.setCaption);
  const lastSelectedLanguage = useSubtitleStore((s) => s.lastSelectedLanguage);
  const setIsOpenSubtitles = useSubtitleStore((s) => s.setIsOpenSubtitles);

  const appLanguage = useLanguageStore((s) => s.language);
  const captionList = usePlayerStore((s) => s.captionList);
  const getHlsCaptionList = usePlayerStore((s) => s.display?.getCaptionList);

  const getSubtitleTracks = usePlayerStore((s) => s.display?.getSubtitleTracks);
  const setSubtitlePreference = usePlayerStore(
    (s) => s.display?.setSubtitlePreference,
  );

  const captions = useMemo(
    () =>
      captionList.length !== 0 ? captionList : (getHlsCaptionList?.() ?? []),
    [captionList, getHlsCaptionList],
  );

  const selectCaptionById = useCallback(
    async (captionId: string) => {
      const caption = captions.find((v) => v.id === captionId);
      if (!caption) return;

      const captionToSet: Caption = {
        id: caption.id,
        language: caption.language,
        url: caption.url,
        srtData: "",
      };

      if (!caption.hls) {
        const srtData = await downloadCaption(caption);
        captionToSet.srtData = srtData;
      } else {
        // request a language change to hls, so it can load the subtitles
        await setSubtitlePreference?.(caption.language);
        const track = getSubtitleTracks?.().find(
          (t) => t.id.toString() === caption.id && t.details !== undefined,
        );
        if (!track) return;

        const fragments =
          track.details?.fragments?.filter(
            (frag) => frag !== null && frag.url !== null,
          ) ?? [];

        const vttCaptions = (
          await Promise.all(
            fragments.map(async (frag) => {
              const vtt = await downloadWebVTT(frag.url);
              return parseVttSubtitles(vtt);
            }),
          )
        ).flat();

        const filtered = filterDuplicateCaptionCues(vttCaptions);

        const srtData = subsrt.build(filtered, { format: "srt" });
        captionToSet.srtData = srtData;
      }

      setIsOpenSubtitles(!!caption.opensubtitles);
      setCaption(captionToSet);
      resetSubtitleSpecificSettings();
      setLanguage(caption.language);
    },
    [
      setIsOpenSubtitles,
      setLanguage,
      captions,
      setCaption,
      resetSubtitleSpecificSettings,
      getSubtitleTracks,
      setSubtitlePreference,
    ],
  );

  const selectLanguage = useCallback(
    async (language: string) => {
      const caption = findCaptionForLanguage(captions, language);
      if (!caption) return;
      return selectCaptionById(caption.id);
    },
    [captions, selectCaptionById],
  );

  const disable = useCallback(async () => {
    setIsOpenSubtitles(false);
    setCaption(null);
    setLanguage(null);
  }, [setCaption, setLanguage, setIsOpenSubtitles]);

  const selectLastUsedLanguage = useCallback(async () => {
    // Prefer what was last chosen, then the language the app itself is set to
    // in Settings, and only then English. A first-time viewer should not have
    // to go and pick their own language by hand.
    const language = lastSelectedLanguage ?? appLanguage ?? "en";
    await selectLanguage(language);
    return true;
  }, [lastSelectedLanguage, appLanguage, selectLanguage]);

  const toggleLastUsed = useCallback(async () => {
    if (enabled) disable();
    else await selectLastUsedLanguage();
  }, [selectLastUsedLanguage, disable, enabled]);

  const selectLastUsedLanguageIfEnabled = useCallback(async () => {
    if (enabled) await selectLastUsedLanguage();
  }, [selectLastUsedLanguage, enabled]);

  return {
    selectLanguage,
    disable,
    selectLastUsedLanguage,
    toggleLastUsed,
    selectLastUsedLanguageIfEnabled,
    selectCaptionById,
  };
}
