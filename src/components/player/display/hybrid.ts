import { makeVideoElementDisplayInterface } from "@/components/player/display/base";
import {
  DisplayInterface,
  DisplayInterfaceEvents,
} from "@/components/player/display/displayInterface";
import { makeMegaPlayDisplayInterface } from "@/components/player/display/megaplay";
import { makeEmitter } from "@/utils/events";

/*
 * The web display: a <video> element for streams we can reach, MegaPlay's
 * embedded player for the ones we cannot. `load` decides which of the two a
 * source goes to, so the rest of the player keeps talking to one display and
 * every control - the resume position included - carries over unchanged.
 */

const EVENTS: (keyof DisplayInterfaceEvents)[] = [
  "play",
  "pause",
  "fullscreen",
  "volumechange",
  "time",
  "duration",
  "buffered",
  "loading",
  "qualities",
  "changedquality",
  "audiotracks",
  "changedaudiotrack",
  "needstrack",
  "canairplay",
  "playbackrate",
  "error",
];

export function makeHybridDisplayInterface(): DisplayInterface {
  const { emit, on, off } = makeEmitter<DisplayInterfaceEvents>();
  const video = makeVideoElementDisplayInterface();
  const embed = makeMegaPlayDisplayInterface();
  let active: DisplayInterface = video;

  // only the display that is actually playing may speak for the player: the
  // idle one still emits while it unloads, and that must not reach the store
  [video, embed].forEach((child) => {
    EVENTS.forEach((event) => {
      child.on(event, (value: any) => {
        if (child === active) emit(event, value);
      });
    });
  });

  return {
    on,
    off,
    getType: () => active.getType(),
    destroy() {
      video.destroy();
      embed.destroy();
    },
    load(ops) {
      const next = ops.source?.type === "embed" ? embed : video;
      const previous = active;
      active = next;
      if (previous !== next) previous.load({ ...ops, source: null });
      next.load(ops);
    },
    play: () => active.play(),
    pause: () => active.pause(),
    changeQuality: (automatic, preferred) =>
      active.changeQuality(automatic, preferred),
    changeAudioTrack: (track) => active.changeAudioTrack(track),
    processVideoElement: (el) => video.processVideoElement(el),
    processContainerElement(container) {
      video.processContainerElement(container);
      embed.processContainerElement(container);
    },
    processEmbedFrame: (frame) => embed.processEmbedFrame?.(frame),
    toggleFullscreen: () => active.toggleFullscreen(),
    togglePictureInPicture: () => active.togglePictureInPicture(),
    setSeeking: (seeking) => active.setSeeking(seeking),
    // both remember it, so switching sources keeps the viewer's mute state
    setVolume(vol) {
      video.setVolume(vol);
      embed.setVolume(vol);
    },
    setTime: (t) => active.setTime(t),
    startAirplay: () => active.startAirplay(),
    setPlaybackRate: (rate) => active.setPlaybackRate(rate),
    setMeta(meta) {
      video.setMeta(meta);
      embed.setMeta(meta);
    },
    setCaption(caption) {
      video.setCaption(caption);
      embed.setCaption(caption);
    },
    getCaptionList: () => active.getCaptionList(),
    getSubtitleTracks: () => active.getSubtitleTracks(),
    setSubtitlePreference: (lang) => active.setSubtitlePreference(lang),
  };
}
