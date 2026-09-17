import fscreen from "fscreen";

import {
  DisplayInterface,
  DisplayInterfaceEvents,
} from "@/components/player/display/displayInterface";
import { LoadableSource } from "@/stores/player/utils/qualities";
import { canFullscreen, canFullscreenAnyElement } from "@/utils/detectFeatures";
import { makeEmitter } from "@/utils/events";

/*
 * Drives MegaPlay's embedded player from our own controls.
 *
 * MegaPlay encrypts the stream url inside its page, so the video itself is out
 * of reach; all we get is its postMessage bridge. While playing it reports
 * {event: "time", time, duration} about four times a second, and while paused
 * or buffering it reports nothing at all. It accepts PLAY_TOGGLE, SEEK, MUTE
 * and GET_TIME - there is no volume level and no playback speed, which is why
 * the player hides those controls for embeds.
 *
 * Play state is therefore inferred: time updates arriving means playing. The
 * bridge's toggle only pauses when the player is really playing (otherwise it
 * calls play), so a pause asked for mid-buffer is held until playback resumes.
 */

// updates arrive every ~250ms, so this much silence means it is not playing
const STALL_MS = 900;
// a player that is ready but never starts was most likely denied autoplay
const START_GRACE_MS = 5_000;
// not a single message from the frame in this long means the embed is broken
const LOAD_TIMEOUT_MS = 25_000;
// re-applying a held pause any sooner could land on the pause just sent
const REPAUSE_GAP_MS = 1_500;
/*
 * The embedded player keeps its own mute setting across episodes, and MUTE only
 * flips it. We are the only thing that ever sends MUTE, so remembering what we
 * last left it at keeps a flip from inverting the viewer's choice.
 */
const MUTED_KEY = "__flux_megaplay_muted";

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  } catch {
    // storage blocked: the in-memory value still holds for this page
  }
}

export function makeMegaPlayDisplayInterface(): DisplayInterface {
  const { emit, on, off } = makeEmitter<DisplayInterfaceEvents>();
  let source: LoadableSource | null = null;
  let frame: HTMLIFrameElement | null = null;
  let containerElement: HTMLElement | null = null;
  let isFullscreen = false;
  let startAt = 0;
  let time = 0;
  let duration = 0;
  let loadedAt = 0;
  let heard = false; // any message at all from the current frame
  let ready = false;
  let flowing = false; // time updates currently arriving
  let lastTimeAt = 0;
  let awaitingStart = true;
  let ended = false;
  let wantPaused = false;
  let lastToggleAt = 0;
  let playerMuted = readMuted();
  let wantMuted = playerMuted;

  function send(message: Record<string, unknown>) {
    if (!frame?.contentWindow || !source) return;
    try {
      frame.contentWindow.postMessage(message, new URL(source.url).origin);
    } catch {
      // a frame mid-navigation has no window to post to
    }
  }

  function toggle(minGapMs: number) {
    const now = Date.now();
    if (now - lastToggleAt < minGapMs) return;
    lastToggleAt = now;
    send({ cmd: "PLAY_TOGGLE" });
  }

  function syncMute() {
    if (!ready || wantMuted === playerMuted) return;
    send({ cmd: "MUTE" });
    playerMuted = wantMuted;
    writeMuted(playerMuted);
  }

  function reportTime(position: unknown, total?: unknown) {
    const t = Number(position);
    if (Number.isFinite(t)) {
      time = t;
      emit("time", t);
      emit("buffered", t);
    }
    const d = Number(total);
    if (Number.isFinite(d) && d > 0 && d !== duration) {
      duration = d;
      emit("duration", d);
    }
  }

  function showSource() {
    if (!frame) return;
    heard = false;
    ready = false;
    flowing = false;
    ended = false;
    awaitingStart = true;
    lastTimeAt = 0;
    loadedAt = Date.now();
    if (!source) {
      frame.src = "about:blank";
      return;
    }
    const url = new URL(source.url);
    // MegaPlay resumes from ?time=, in whole seconds
    if (startAt >= 2) url.searchParams.set("time", String(Math.floor(startAt)));
    frame.src = url.toString();
  }

  function onMessage(event: MessageEvent) {
    if (!frame || event.source !== frame.contentWindow) return;
    let data = event.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (!data || typeof data !== "object") return;
    heard = true;

    switch (data.event) {
      case "time": {
        const previous = time;
        reportTime(data.time, data.duration);
        /*
         * A seek fires time updates too, even while paused, so only a small
         * forward step counts as playback. Counting those would make the held
         * pause below toggle a paused player straight back on.
         */
        const step = time - previous;
        if (!(step > 0 && step < 3)) break;
        lastTimeAt = Date.now();
        ended = false;
        if (!flowing) {
          flowing = true;
          awaitingStart = false;
          emit("loading", false);
          if (!wantPaused) emit("play", undefined);
        }
        // a pause asked for while buffering: playback is back, so apply it now
        if (wantPaused) toggle(REPAUSE_GAP_MS);
        break;
      }
      case "CURRENT_TIME":
        reportTime(data.time, data.duration);
        break;
      case "SEEK_DONE":
        reportTime(data.value);
        break;
      case "PLAYER_READY":
        ready = true;
        syncMute();
        break;
      case "complete":
        ended = true;
        flowing = false;
        if (duration) reportTime(duration);
        emit("loading", false);
        emit("pause", undefined);
        break;
      case "error":
        emit("error", {
          errorName: "MegaPlayError",
          type: "global",
          message:
            typeof data.message === "string"
              ? data.message
              : "MegaPlay could not play this episode",
        });
        break;
      default:
        break;
    }
  }
  window.addEventListener("message", onMessage);

  const watchdog = window.setInterval(() => {
    if (!source || !frame) return;
    const now = Date.now();
    if (flowing && now - lastTimeAt > STALL_MS) {
      flowing = false;
      if (wantPaused || ended) {
        emit("loading", false);
        emit("pause", undefined);
      } else {
        emit("loading", true);
      }
    }
    if (awaitingStart && ready && now - loadedAt > START_GRACE_MS) {
      // show a play button rather than an endless spinner
      awaitingStart = false;
      emit("loading", false);
      emit("pause", undefined);
    }
    if (!heard && now - loadedAt > LOAD_TIMEOUT_MS) {
      heard = true; // report once per load
      emit("error", {
        errorName: "MegaPlayTimeout",
        type: "global",
        message: "MegaPlay did not respond",
      });
    }
  }, 300);

  function fullscreenChange() {
    isFullscreen =
      !!document.fullscreenElement || // other browsers
      !!(document as any).webkitFullscreenElement; // safari
    emit("fullscreen", isFullscreen);
    if (!isFullscreen) emit("needstrack", false);
  }
  fscreen.addEventListener("fullscreenchange", fullscreenChange);

  return {
    on,
    off,
    getType() {
      return "web";
    },
    destroy() {
      window.clearInterval(watchdog);
      window.removeEventListener("message", onMessage);
      fscreen.removeEventListener("fullscreenchange", fullscreenChange);
      frame = null;
    },
    load(ops) {
      source = ops.source;
      startAt = ops.startAt;
      time = startAt;
      duration = 0;
      wantPaused = false;
      if (source) {
        emit("loading", true);
        emit("qualities", []);
        emit("changedquality", null);
        emit("playbackrate", 1);
      }
      showSource();
    },
    processEmbedFrame(newFrame) {
      if (newFrame === frame) return;
      frame = newFrame;
      if (!frame || !source) return;
      // a remounted frame picks up where the last one was, not where it began
      startAt = time || startAt;
      emit("loading", true);
      showSource();
    },
    processVideoElement() {},
    processContainerElement(container) {
      containerElement = container;
    },
    changeQuality() {
      // the embed picks its own quality
    },
    changeAudioTrack() {
      // sub/dub are separate embeds, switched as audio variants
    },
    setMeta() {},
    setCaption() {
      // our captions are drawn over the frame by SubtitleView
    },

    play() {
      wantPaused = false;
      if (!flowing) {
        toggle(0);
        emit("loading", true);
      }
      emit("play", undefined);
    },
    pause() {
      wantPaused = true;
      if (flowing) toggle(0);
      emit("pause", undefined);
    },
    setSeeking() {
      // only the committed position is sent; see setTime
    },
    setTime(t) {
      let target = Math.max(0, t);
      if (duration) target = Math.min(target, duration);
      if (Number.isNaN(target)) return;
      time = target;
      ended = false;
      emit("time", target);
      send({ cmd: "SEEK", value: target });
    },
    setVolume(v) {
      const volume = Math.max(0, Math.min(v, 1));
      wantMuted = volume === 0;
      syncMute();
      // echo the requested level so the viewer's volume survives for other
      // sources; only muting is actually applied to the embed
      emit("volumechange", volume);
    },
    toggleFullscreen() {
      if (isFullscreen) {
        isFullscreen = false;
        emit("fullscreen", isFullscreen);
        emit("needstrack", false);
        if (!fscreen.fullscreenElement) return;
        fscreen.exitFullscreen();
        return;
      }

      // enter fullscreen
      isFullscreen = true;
      emit("fullscreen", isFullscreen);
      if (!canFullscreen() || fscreen.fullscreenElement) return;
      if (canFullscreenAnyElement()) {
        if (containerElement) fscreen.requestFullscreen(containerElement);
      }
    },
    togglePictureInPicture() {
      // the video lives inside another site's page
    },
    startAirplay() {
      // no stream url to hand over
    },
    setPlaybackRate() {
      emit("playbackrate", 1);
    },
    getCaptionList() {
      return [];
    },
    getSubtitleTracks() {
      return [];
    },
    async setSubtitlePreference() {
      return Promise.resolve();
    },
  };
}
