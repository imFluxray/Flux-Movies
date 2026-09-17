import classNames from "classnames";
import { useEffect, useRef, useState } from "react";

type YouTubePlayer = {
  destroy: () => void;
  mute: () => void;
  playVideo: () => void;
};

type YouTubeEvent = {
  data?: number;
  target: YouTubePlayer;
};

type YouTubeApi = {
  Player: new (
    target: HTMLIFrameElement,
    options: {
      events: {
        onError: () => void;
        onReady: (event: YouTubeEvent) => void;
        onStateChange: (event: YouTubeEvent) => void;
      };
    },
  ) => YouTubePlayer;
};

type YouTubeWindow = Window & {
  YT?: YouTubeApi;
  onYouTubeIframeAPIReady?: () => void;
};

let youtubeApi: Promise<YouTubeApi> | null = null;

function loadYouTubeApi(): Promise<YouTubeApi> {
  const win = window as YouTubeWindow;
  if (win.YT?.Player) return Promise.resolve(win.YT);
  if (youtubeApi) return youtubeApi;

  const pending = new Promise<YouTubeApi>((resolve, reject) => {
    const previous = win.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(
      () => reject(new Error("YouTube API timed out")),
      10000,
    );
    win.onYouTubeIframeAPIReady = () => {
      previous?.();
      window.clearTimeout(timeout);
      if (win.YT?.Player) resolve(win.YT);
      else reject(new Error("YouTube API unavailable"));
    };

    if (
      !document.querySelector(
        'script[src="https://www.youtube.com/iframe_api"]',
      )
    ) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("YouTube API failed to load"));
      document.head.appendChild(script);
    }
  });

  const result = pending.catch((error) => {
    youtubeApi = null;
    throw error;
  });
  youtubeApi = result;
  return result;
}

export function TrailerPreview({
  active,
  className,
  onUnavailable,
  videoKey,
}: {
  active: boolean;
  className?: string;
  onUnavailable?: () => void;
  videoKey: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!active) {
      setPlaying(false);
      return;
    }
    const iframe = iframeRef.current;
    if (!iframe) return;
    let disposed = false;
    let player: YouTubePlayer | null = null;
    let started = false;
    let revealTimer: number | null = null;
    const fail = () => {
      if (!disposed) onUnavailable?.();
    };
    const timeout = window.setTimeout(() => {
      if (!started) fail();
    }, 12000);

    loadYouTubeApi()
      .then((YT) => {
        if (disposed) return;
        player = new YT.Player(iframe, {
          events: {
            onReady: (event) => {
              event.target.mute();
              event.target.playVideo();
            },
            onStateChange: (event) => {
              if (event.data === 1) {
                started = true;
                window.clearTimeout(timeout);
                // YouTube briefly paints its own central transport controls
                // when playback starts. Keep the promotional still visible
                // until that transient chrome has faded away.
                revealTimer = window.setTimeout(() => {
                  if (!disposed) setPlaying(true);
                }, 4800);
              }
            },
            onError: fail,
          },
        });
      })
      .catch(fail);

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      if (revealTimer) window.clearTimeout(revealTimer);
      player?.destroy();
    };
  }, [active, onUnavailable, videoKey]);

  if (!active) return null;

  const origin = window.location.origin;
  const query = new URLSearchParams({
    autoplay: "1",
    cc_load_policy: "0",
    controls: "0",
    disablekb: "1",
    enablejsapi: "1",
    fs: "0",
    iv_load_policy: "3",
    loop: "1",
    mute: "1",
    modestbranding: "1",
    origin,
    playlist: videoKey,
    playsinline: "1",
    rel: "0",
    start: "5",
    widget_referrer: origin,
  });

  return (
    <div
      aria-hidden="true"
      className={classNames(
        "pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-700",
        playing ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      <iframe
        ref={iframeRef}
        title="Official trailer preview"
        src={`https://www.youtube.com/embed/${videoKey}?${query}`}
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        tabIndex={-1}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: "177.78vh",
          height: "56.25vw",
          minWidth: "100%",
          minHeight: "100%",
          border: 0,
        }}
      />
    </div>
  );
}
