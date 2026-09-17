import { CSSProperties, ReactNode, useEffect, useMemo, useRef } from "react";

import { makeHybridDisplayInterface } from "@/components/player/display/hybrid";
import { convertSubtitlesToObjectUrl } from "@/components/player/utils/captions";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

import { useInitializeSource } from "../hooks/useInitializePlayer";

// initialize display interface
function useDisplayInterface() {
  const display = usePlayerStore((s) => s.display);
  const setDisplay = usePlayerStore((s) => s.setDisplay);

  const displayRef = useRef(display);
  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    if (!displayRef.current) {
      const newDisplay = makeHybridDisplayInterface();
      displayRef.current = newDisplay;
      setDisplay(newDisplay);
    }
    return () => {
      if (displayRef.current) {
        displayRef.current = null;
        setDisplay(null);
      }
    };
  }, [setDisplay]);
}

export function useShouldShowVideoElement() {
  const status = usePlayerStore((s) => s.status);

  if (status !== playerStatus.PLAYING) return false;
  return true;
}

function useObjectUrl(cb: () => string | null, deps: any[]) {
  const lastObjectUrl = useRef<string | null>(null);
  const output = useMemo(() => {
    if (lastObjectUrl.current) URL.revokeObjectURL(lastObjectUrl.current);
    const data = cb();
    lastObjectUrl.current = data;
    return data;
    // deps are passed in, cb is known not to be changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    return () => {
      // this is intentionally done only in cleanup
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (lastObjectUrl.current) URL.revokeObjectURL(lastObjectUrl.current);
    };
  }, []);

  return output;
}

function VideoElement() {
  const videoEl = useRef<HTMLVideoElement>(null);
  const trackEl = useRef<HTMLTrackElement>(null);
  const display = usePlayerStore((s) => s.display);
  const srtData = usePlayerStore((s) => s.caption.selected?.srtData);
  const captionAsTrack = usePlayerStore((s) => s.caption.asTrack);
  const language = usePlayerStore((s) => s.caption.selected?.language);
  const trackObjectUrl = useObjectUrl(
    () => (srtData ? convertSubtitlesToObjectUrl(srtData) : null),
    [srtData],
  );

  // report video element to display interface
  useEffect(() => {
    if (display && videoEl.current) {
      display.processVideoElement(videoEl.current);
    }
  }, [display, videoEl]);

  // select track as showing if it exists
  useEffect(() => {
    if (trackEl.current) {
      trackEl.current.track.mode = "showing";
    }
  }, [trackEl]);

  let subtitleTrack: ReactNode = null;
  if (captionAsTrack && trackObjectUrl && language)
    subtitleTrack = (
      <track
        label="Flux Movies"
        kind="subtitles"
        srcLang={language}
        src={trackObjectUrl}
        default
      />
    );

  return (
    <video
      className="absolute inset-0 w-full h-screen bg-black"
      autoPlay
      playsInline
      ref={videoEl}
    >
      {subtitleTrack}
    </video>
  );
}

/*
 * MegaPlay draws its own control bar along the bottom of its frame. The frame
 * is made taller than the 16:9 picture box that clips it, so the picture still
 * fills the box while that bar lands in black space cut off below it. The frame
 * never receives pointer events either, so the bar never wakes up - every
 * click and key goes to our own controls on top.
 */
const EMBED_CROP_PX = 90;

function EmbedElement() {
  const frameEl = useRef<HTMLIFrameElement>(null);
  const display = usePlayerStore((s) => s.display);

  useEffect(() => {
    if (!display?.processEmbedFrame) return undefined;
    display.processEmbedFrame(frameEl.current);
    return () => display.processEmbedFrame?.(null);
  }, [display]);

  return (
    <div
      className="absolute inset-0 flex h-screen w-full items-center justify-center bg-black"
      style={{ containerType: "size" } as CSSProperties}
    >
      <div
        className="relative overflow-hidden"
        style={{
          width: "min(100cqw, 100cqh * 16 / 9)",
          height: "min(100cqh, 100cqw * 9 / 16)",
        }}
      >
        <iframe
          ref={frameEl}
          title="MegaPlay"
          className="pointer-events-none absolute left-0 w-full border-0"
          style={{
            top: -EMBED_CROP_PX,
            height: `calc(100% + ${EMBED_CROP_PX * 2}px)`,
          }}
          allow="autoplay *; fullscreen *; encrypted-media *"
          referrerPolicy="origin"
        />
      </div>
    </div>
  );
}

export function VideoContainer() {
  const show = useShouldShowVideoElement();
  const isEmbed = usePlayerStore((s) => s.source?.type === "embed");
  useDisplayInterface();
  useInitializeSource();

  if (!show) return null;
  return (
    <>
      <VideoElement />
      {isEmbed ? <EmbedElement /> : null}
    </>
  );
}
