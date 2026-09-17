import { iso6393To1 } from "iso-639-3";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";

import {
  getFluxProviders,
  isAnimeResolver,
} from "@/backend/providers/fluxProviders";
import { runFluxProviders } from "@/backend/providers/fluxRunner";
import { FlagIcon } from "@/components/FlagIcon";
import { Loading } from "@/components/layout/Loading";
import { Menu } from "@/components/player/internals/ContextMenu";
import { convertProviderCaption } from "@/components/player/utils/captions";
import { convertRunoutputToSource } from "@/components/player/utils/convertRunoutputToSource";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { AudioTrack, metaToScrapeMedia } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import {
  getPreferredAnimeAudio,
  setPreferredAnimeAudio,
} from "@/utils/animeAudio";
import { getPrettyLanguageNameFromLocale } from "@/utils/language";

import { SelectableLink } from "../../internals/ContextMenu/Links";

export function AudioOption(props: {
  langCode?: string;
  children: React.ReactNode;
  selected?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <SelectableLink
      selected={props.selected}
      loading={props.loading}
      disabled={props.disabled}
      onClick={props.disabled ? undefined : props.onClick}
    >
      <span className="flex items-center">
        <span data-code={props.langCode} className="mr-3 inline-flex">
          <FlagIcon langCode={props.langCode} />
        </span>
        <span>{props.children}</span>
      </span>
    </SelectableLink>
  );
}

export function AudioView({ id }: { id: string }) {
  const { t } = useTranslation();
  const unknownChoice = t("player.menus.subtitles.unknownLanguage");
  const [switchingTrack, setSwitchingTrack] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const router = useOverlayRouter(id);
  const audioTracks = usePlayerStore((s) => s.audioTracks);
  const currentAudioTrack = usePlayerStore((s) => s.currentAudioTrack);
  const currentSource = usePlayerStore((s) => s.source);
  const meta = usePlayerStore((s) => s.meta);
  const progress = usePlayerStore((s) => s.progress.time);
  const setCaption = usePlayerStore((s) => s.setCaption);
  const setSource = usePlayerStore((s) => s.setSource);
  const setSourceId = usePlayerStore((s) => s.setSourceId);
  const changeAudioTrack = usePlayerStore((s) => s.display?.changeAudioTrack);
  const switchExternalAudioTrack = usePlayerStore(
    (s) => s.switchExternalAudioTrack,
  );

  const [animeAudioRequest, loadAnimeAudio] = useAsyncFn(async () => {
    if (!meta) return null;
    const providers = await getFluxProviders();
    const animeResolver = providers.find(isAnimeResolver);
    if (!animeResolver) return null;
    return runFluxProviders({
      media: metaToScrapeMedia(meta),
      providers: [animeResolver],
    });
  }, [meta]);

  const currentVariants = useMemo(
    () => currentSource?.audioVariants ?? [],
    [currentSource?.audioVariants],
  );
  useEffect(() => {
    const hasDub = currentVariants.some((variant) => variant.id === "dub");
    const hasSub = currentVariants.some((variant) => variant.id === "sub");
    if (!meta || (hasDub && hasSub)) return;
    loadAnimeAudio().catch(() => {});
  }, [currentVariants, loadAnimeAudio, meta]);

  const resolvedRawVariants = useMemo(
    () =>
      ((animeAudioRequest.value?.stream as any)?.fluxAudioVariants ??
        []) as Array<{
        id: "dub" | "sub";
        label: string;
        language: string;
        stream: any;
      }>,
    [animeAudioRequest.value],
  );
  const displayedTracks = useMemo<AudioTrack[]>(() => {
    const tracks = new Map(audioTracks.map((track) => [track.id, track]));
    resolvedRawVariants.forEach((variant) => {
      tracks.set(variant.id, {
        id: variant.id,
        label: variant.label,
        language: variant.language,
        external: true,
      });
    });

    // Once an anime source identifies a title, keep both choices stable in
    // the menu. A provider race can resolve one track a little earlier than
    // the other; that must not make Dub or Sub disappear from the UI.
    const isAnime =
      currentVariants.some(
        (variant) => variant.id === "dub" || variant.id === "sub",
      ) || resolvedRawVariants.length > 0;
    if (isAnime) {
      if (!tracks.has("dub"))
        tracks.set("dub", {
          id: "dub",
          label: "English (Dub)",
          language: "en",
          external: true,
        });
      if (!tracks.has("sub"))
        tracks.set("sub", {
          id: "sub",
          label: "Japanese (Sub)",
          language: "ja",
          external: true,
        });
    }
    return [...tracks.values()];
  }, [audioTracks, currentVariants, resolvedRawVariants]);

  const change = useCallback(
    async (track: AudioTrack) => {
      if (switchingTrack) return;
      setSwitchingTrack(track.id);
      setSwitchError(null);
      try {
        const alreadyAvailable = currentVariants.some(
          (variant) => variant.id === track.id,
        );
        if (track.external && alreadyAvailable) {
          switchExternalAudioTrack(track);
        } else if (track.id === "dub" || track.id === "sub") {
          let output = animeAudioRequest.value;
          let variants = ((output?.stream as any)?.fluxAudioVariants ??
            []) as Array<{
            id: "dub" | "sub";
            stream: any;
          }>;
          let selected = variants.find((variant) => variant.id === track.id);

          /*
           * Record the choice BEFORE re-resolving.
           *
           * The resolver reads this preference to decide which track it waits
           * for. Setting it afterwards meant every retry asked for dub while
           * still being told the viewer wanted sub, so the resolver kept
           * awaiting the wrong one and the track we needed never appeared in
           * the variant list - two attempts, then a spurious "could not be
           * resolved". Reverted below if the switch genuinely fails.
           */
          const previousAudio = getPreferredAnimeAudio();
          setPreferredAnimeAudio(track.id);

          try {
            for (let attempt = 0; !selected && attempt < 2; attempt += 1) {
              output = await loadAnimeAudio();
              variants = ((output?.stream as any)?.fluxAudioVariants ??
                []) as Array<{
                id: "dub" | "sub";
                stream: any;
              }>;
              selected = variants.find((variant) => variant.id === track.id);
            }
          } catch (err) {
            setPreferredAnimeAudio(previousAudio);
            throw err;
          }
          if (!output || !selected) {
            setPreferredAnimeAudio(previousAudio);
            throw new Error(
              track.id === "dub"
                ? "No English dub is available for this episode."
                : "No subtitled version is available for this episode.",
            );
          }
          const selectedStream = {
            ...selected.stream,
            fluxAudioVariantId: track.id,
            fluxAudioVariants: variants,
          };
          setCaption(null);
          setSource(
            convertRunoutputToSource({ stream: selectedStream }),
            convertProviderCaption(selected.stream.captions ?? []),
            progress,
          );
          setSourceId(output.sourceId);
        } else {
          changeAudioTrack?.(track);
        }
        router.close();
      } catch (error) {
        setSwitchError(
          error instanceof Error ? error.message : "Audio switch failed",
        );
      } finally {
        setSwitchingTrack(null);
      }
    },
    [
      animeAudioRequest.value,
      changeAudioTrack,
      currentVariants,
      loadAnimeAudio,
      progress,
      router,
      setCaption,
      setSource,
      setSourceId,
      switchingTrack,
      switchExternalAudioTrack,
    ],
  );

  return (
    <>
      <Menu.BackLink onClick={() => router.navigate("/")}>Audio</Menu.BackLink>
      <Menu.Section className="flex flex-col pb-4">
        {animeAudioRequest.loading && !displayedTracks.length ? (
          <Menu.TextDisplay noIcon>
            <Loading />
          </Menu.TextDisplay>
        ) : null}
        {displayedTracks.map((v) => (
          <AudioOption
            key={v.id}
            selected={v.id === currentAudioTrack?.id}
            loading={v.id === switchingTrack}
            disabled={switchingTrack !== null}
            langCode={
              v.language.length === 3
                ? (iso6393To1[v.language] ?? v.language)
                : v.language
            }
            onClick={() => change(v)}
          >
            {v.label ??
              getPrettyLanguageNameFromLocale(v.language) ??
              unknownChoice}
          </AudioOption>
        ))}
        {switchError ? (
          <Menu.TextDisplay noIcon>{switchError}</Menu.TextDisplay>
        ) : null}
      </Menu.Section>
    </>
  );
}
