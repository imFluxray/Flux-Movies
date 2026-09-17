import { ScrapeMedia } from "@movie-web/providers";

import { MakeSlice } from "@/stores/player/slices/types";
import {
  SourceQuality,
  SourceSliceSource,
  selectQuality,
} from "@/stores/player/utils/qualities";
import { useQualityStore } from "@/stores/quality";
import { setPreferredAnimeAudio } from "@/utils/animeAudio";
import { ValuesOf } from "@/utils/typeguard";

export const playerStatus = {
  IDLE: "idle",
  SCRAPING: "scraping",
  PLAYING: "playing",
  SCRAPE_NOT_FOUND: "scrapeNotFound",
  PLAYBACK_ERROR: "playbackError",
} as const;

export type PlayerStatus = ValuesOf<typeof playerStatus>;

export interface PlayerMetaEpisode {
  number: number;
  tmdbId: string;
  title: string;
}

export interface PlayerMeta {
  type: "movie" | "show";
  title: string;
  tmdbId: string;
  imdbId?: string;
  releaseYear: number;
  poster?: string;
  episodes?: PlayerMetaEpisode[];
  episode?: PlayerMetaEpisode;
  season?: {
    number: number;
    tmdbId: string;
    title: string;
  };
}

export interface Caption {
  id: string;
  language: string;
  url?: string;
  srtData: string;
}

export interface CaptionListItem {
  id: string;
  language: string;
  url: string;
  needsProxy: boolean;
  hls?: boolean;
  opensubtitles?: boolean;
}

export interface AudioTrack {
  id: string;
  label: string;
  language: string;
  external?: boolean;
}

export interface SourceSlice {
  status: PlayerStatus;
  source: SourceSliceSource | null;
  sourceId: string | null;
  qualities: SourceQuality[];
  audioTracks: AudioTrack[];
  currentQuality: SourceQuality | null;
  currentAudioTrack: AudioTrack | null;
  captionList: CaptionListItem[];
  caption: {
    selected: Caption | null;
    asTrack: boolean;
  };
  meta: PlayerMeta | null;
  setStatus(status: PlayerStatus): void;
  setSource(
    stream: SourceSliceSource,
    captions: CaptionListItem[],
    startAt: number,
  ): void;
  switchQuality(quality: SourceQuality): void;
  setMeta(meta: PlayerMeta, status?: PlayerStatus): void;
  setCaption(caption: Caption | null): void;
  setSourceId(id: string | null): void;
  enableAutomaticQuality(): void;
  redisplaySource(startAt: number): void;
  switchExternalAudioTrack(track: AudioTrack): void;
}

export function metaToScrapeMedia(meta: PlayerMeta): ScrapeMedia {
  if (meta.type === "show") {
    if (!meta.episode || !meta.season) throw new Error("missing show data");
    return {
      title: meta.title,
      releaseYear: meta.releaseYear,
      tmdbId: meta.tmdbId,
      type: "show",
      imdbId: meta.imdbId,
      episode: meta.episode,
      season: meta.season,
    };
  }

  return {
    title: meta.title,
    releaseYear: meta.releaseYear,
    tmdbId: meta.tmdbId,
    type: "movie",
    imdbId: meta.imdbId,
  };
}

export const createSourceSlice: MakeSlice<SourceSlice> = (set, get) => ({
  source: null,
  sourceId: null,
  qualities: [],
  audioTracks: [],
  captionList: [],
  currentQuality: null,
  currentAudioTrack: null,
  status: playerStatus.IDLE,
  meta: null,
  caption: {
    selected: null,
    asTrack: false,
  },
  setSourceId(id) {
    set((s) => {
      s.status = playerStatus.PLAYING;
      s.sourceId = id;
    });
  },
  setStatus(status: PlayerStatus) {
    set((s) => {
      s.status = status;
    });
  },
  setMeta(meta, newStatus) {
    set((s) => {
      s.meta = meta;
      s.interface.hideNextEpisodeBtn = false;
      if (newStatus) s.status = newStatus;
    });
  },
  setCaption(caption) {
    const store = get();
    store.display?.setCaption(caption);
    set((s) => {
      s.caption.selected = caption;
    });
  },
  setSource(
    stream: SourceSliceSource,
    captions: CaptionListItem[],
    startAt: number,
  ) {
    let qualities: string[] = [];
    if (stream.type === "file") qualities = Object.keys(stream.qualities);
    const qualityPreferences = useQualityStore.getState();
    const loadableStream = selectQuality(stream, qualityPreferences.quality);

    set((s) => {
      s.source = stream;
      s.qualities = qualities as SourceQuality[];
      s.currentQuality = loadableStream.quality;
      s.captionList = captions;
      s.interface.error = undefined;
      s.status = playerStatus.PLAYING;
      const variants = stream.audioVariants ?? [];
      s.audioTracks = variants.map((variant) => ({
        id: variant.id,
        label: variant.label,
        language: variant.language,
        external: true,
      }));
      s.currentAudioTrack =
        s.audioTracks.find((track) => track.id === stream.audioVariantId) ??
        null;
    });
    const store = get();
    store.redisplaySource(startAt);
  },
  switchExternalAudioTrack(track) {
    const store = get();
    const variants = store.source?.audioVariants ?? [];
    const selected = variants.find((variant) => variant.id === track.id);
    if (!selected || selected.id === store.source?.audioVariantId) return;
    if (selected.id === "dub" || selected.id === "sub")
      setPreferredAnimeAudio(selected.id);
    const nextSource = {
      ...selected.source,
      audioVariantId: selected.id,
      audioVariants: variants,
    } as SourceSliceSource;
    store.setCaption(null);
    store.setSource(nextSource, selected.captions, store.progress.time);
  },
  redisplaySource(startAt: number) {
    const store = get();
    const quality = store.currentQuality;
    if (!store.source) return;
    const qualityPreferences = useQualityStore.getState();
    const loadableStream = selectQuality(store.source, {
      automaticQuality: qualityPreferences.quality.automaticQuality,
      lastChosenQuality: quality,
    });
    set((s) => {
      s.interface.error = undefined;
      s.status = playerStatus.PLAYING;
    });
    store.display?.load({
      source: loadableStream.stream,
      startAt,
      automaticQuality: qualityPreferences.quality.automaticQuality,
      preferredQuality: qualityPreferences.quality.lastChosenQuality,
    });
  },
  switchQuality(quality) {
    const store = get();
    if (!store.source) return;
    if (store.source.type === "file") {
      const selectedQuality = store.source.qualities[quality];
      if (!selectedQuality) return;
      set((s) => {
        s.currentQuality = quality;
        s.status = playerStatus.PLAYING;
        s.interface.error = undefined;
      });
      store.display?.load({
        source: selectedQuality,
        startAt: store.progress.time,
        automaticQuality: false,
        preferredQuality: quality,
      });
    } else if (store.source.type === "hls") {
      store.display?.changeQuality(false, quality);
    }
  },
  enableAutomaticQuality() {
    const store = get();
    store.display?.changeQuality(true, null);
  },
});
