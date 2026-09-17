import classNames from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Icon, Icons } from "@/components/Icon";
import { TrailerPreview } from "@/components/media/TrailerPreview";
import { MediaInfoDialog } from "@/pages/parts/home/MediaInfoDialog";
import { mediaHref } from "@/pages/parts/home/MediaRow";
import { FeedItem } from "@/utils/algorithm";
import {
  Accent,
  extractAccent,
  fetchTitleLogo,
  fetchTrailerKey,
  preloadBackdrop,
} from "@/utils/heroMedia";

/*
 * The home hero.
 *
 * The aim is a projection room rather than a web page, so the effects are few
 * and slow: one dissolve, one push-in, one grain plate. Everything that moves
 * is transform/opacity only, and every one of them stops dead under
 * prefers-reduced-motion, where the composition still has to stand up on its
 * own as a still.
 */

const SLIDE_MS = 9000;
const FADE_MS = 1200;
const TRAILER_HOVER_DELAY_MS = 550;
const ENABLE_TRAILERS = true;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function AlgoHero(props: { items: FeedItem[]; loading?: boolean }) {
  const { items } = props;
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [info, setInfo] = useState<FeedItem | null>(null);
  const [accent, setAccent] = useState<{
    key: string;
    value: Accent | null;
  } | null>(null);
  const [logo, setLogo] = useState<{
    key: string;
    value: string | null;
  } | null>(null);
  const [trailer, setTrailer] = useState<string | null>(null);
  const [trailerOn, setTrailerOn] = useState(false);
  const [warm, setWarm] = useState(true); // projector warm-up, first paint only

  const sectionRef = useRef<HTMLElement | null>(null);
  const timer = useRef<number | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const count = items.length;
  const active = items[index];
  const shown = active;
  const activeKey = active ? `${active.type}-${active.id}` : "";
  const frozen = paused || focused || hovered || !!info;

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  /* ---- advance ---------------------------------------------------------- */
  useEffect(() => {
    if (reduced || frozen || count < 2) return;
    if (typeof document !== "undefined" && document.hidden) return;
    timer.current = window.setTimeout(() => go(index + 1), SLIDE_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [index, frozen, reduced, count, go]);

  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  /* ---- warm-up runs once, not on every slide ---------------------------- */
  useEffect(() => {
    if (reduced) return setWarm(false);
    const t = window.setTimeout(() => setWarm(false), 60);
    return () => window.clearTimeout(t);
  }, [reduced]);

  /* ---- decode the next two so a dissolve never lands half-painted ------- */
  useEffect(() => {
    if (count === 0) return;
    [1, 2].forEach((step) => {
      const next = items[(index + step) % count];
      if (next?.backdrop) preloadBackdrop(next.backdrop);
    });
  }, [index, items, count]);

  /* ---- per-slide material ----------------------------------------------- */
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const key = `${active.type}-${active.id}`;

    fetchTitleLogo(active).then((l) => {
      if (alive) setLogo({ key, value: l });
    });
    if (active.backdrop) {
      extractAccent(active.backdrop).then((a) => {
        if (alive) setAccent({ key, value: a });
      });
    }
    return () => {
      alive = false;
    };
  }, [active]);

  /* ---- only request motion after an intentional hover ------------------- */
  useEffect(() => {
    setTrailer(null);
    setTrailerOn(false);
    if (!ENABLE_TRAILERS || !active || !hovered || reduced || info) return;
    let alive = true;
    const t = window.setTimeout(() => {
      fetchTrailerKey(active).then((key) => {
        if (!alive || !key) return;
        setTrailer(key);
        setTrailerOn(true);
      });
    }, TRAILER_HOVER_DELAY_MS);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [active, hovered, reduced, info]);

  /* ---- keyboard --------------------------------------------------------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (info) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(index - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(index + 1);
      } else if (e.key.toLowerCase() === "i" && active) {
        e.preventDefault();
        setInfo(active);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, index, active, info]);

  /* ---- pointer parallax + scroll recede, both via CSS vars -------------- */
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || reduced) return;

    function onMove(e: PointerEvent) {
      const box = el!.getBoundingClientRect();
      const px = (e.clientX - box.left) / box.width - 0.5;
      const py = (e.clientY - box.top) / box.height - 0.5;
      el!.style.setProperty("--px", px.toFixed(4));
      el!.style.setProperty("--py", py.toFixed(4));
    }
    function onLeave() {
      el!.style.setProperty("--px", "0");
      el!.style.setProperty("--py", "0");
    }
    let raf = 0;
    function onScroll() {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const box = el!.getBoundingClientRect();
        // 0 while fully in view, 1 once it has scrolled a screen away
        const p = Math.min(1, Math.max(0, -box.top / Math.max(box.height, 1)));
        el!.style.setProperty("--recede", p.toFixed(4));
      });
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [reduced]);

  const meta = useMemo(() => {
    if (!shown) return "";
    return [
      shown.type === "show" ? "Series" : "Film",
      shown.year ? String(shown.year) : null,
      shown.rating ? `${shown.rating.toFixed(1)} ★` : null,
    ]
      .filter(Boolean)
      .join("   ·   ");
  }, [shown]);

  const disableTrailer = useCallback(() => {
    setTrailerOn(false);
    setTrailer(null);
  }, []);

  if (props.loading) {
    return (
      <div className="min-h-[26rem] w-full animate-pulse bg-mediaCard-hoverBackground/30 sm:h-[74vh] sm:min-h-[30rem]" />
    );
  }
  if (!active) return null;

  const accentRgb =
    accent?.key === activeKey
      ? (accent.value?.rgb ?? "120, 120, 130")
      : "120, 120, 130";

  return (
    <>
      <section
        ref={sectionRef}
        className="flux-hero relative flex min-h-[26rem] w-full flex-col justify-end overflow-hidden pt-24 sm:h-[74vh] sm:min-h-[30rem] sm:pt-28 [@media(max-height:820px)]:sm:h-[80vh]"
        style={
          {
            "--accent": accentRgb,
            "--px": 0,
            "--py": 0,
            "--recede": 0,
          } as React.CSSProperties
        }
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={() => setFocused(false)}
        onTouchStart={(e) => {
          const t0 = e.touches[0];
          touch.current = { x: t0.clientX, y: t0.clientY };
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          touch.current = null;
          if (!start) return;
          const t1 = e.changedTouches[0];
          const dx = t1.clientX - start.x;
          const dy = t1.clientY - start.y;
          if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6)
            go(index + (dx < 0 ? 1 : -1));
        }}
        aria-roledescription="carousel"
        aria-label="Recommended for you"
      >
        {/* ---- stack of backdrops ---- */}
        <div className="flux-hero-plate absolute inset-0">
          <div
            className={classNames(
              "absolute inset-0",
              warm && !reduced && "flux-warmup",
            )}
          >
            {items.map((item, i) => {
              const on = i === index;
              return (
                <div
                  key={`${item.type}-${item.id}`}
                  aria-hidden={!on}
                  className="absolute inset-0 transition-opacity ease-out"
                  style={{
                    opacity: on ? 1 : 0,
                    transitionDuration: `${FADE_MS}ms`,
                  }}
                >
                  {item.backdrop ? (
                    <img
                      src={item.backdrop}
                      alt=""
                      className={classNames(
                        "h-full w-full object-cover object-center",
                        !reduced && "flux-kenburns",
                      )}
                      style={
                        !reduced && on
                          ? { animationDuration: `${SLIDE_MS + FADE_MS}ms` }
                          : undefined
                      }
                    />
                  ) : null}
                </div>
              );
            })}

            {/* muted trailer, underneath every scrim */}
            {trailerOn && trailer && !reduced && hovered ? (
              <TrailerPreview
                key={trailer}
                videoKey={trailer}
                active
                onUnavailable={disableTrailer}
              />
            ) : null}
          </div>
        </div>

        {/* ---- light: the film's own colour, then the scrims ---- */}
        <div
          className="pointer-events-none absolute inset-0 transition-colors duration-1000"
          style={{
            background: `radial-gradient(120% 80% at 18% 90%, rgba(var(--accent), 0.30) 0%, rgba(var(--accent), 0.10) 38%, transparent 68%)`,
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background-main via-background-main/45 to-background-main/10" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background-main/95 via-background-main/40 to-transparent" />
        <div className="flux-vignette pointer-events-none absolute inset-0" />
        {!reduced ? <div className="flux-grain pointer-events-none" /> : null}

        {/* ---- cinemascope framing hairlines ---- */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/[0.07]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background-main via-background-main/70 to-transparent sm:h-56" />

        {/* ---- copy ---- */}
        <div className="flux-hero-copy relative z-10 mx-auto w-full max-w-[1400px] px-5 pb-8 sm:px-10 sm:pb-11">
          <div key={`${shown.type}-${shown.id}`} className="max-w-xl">
            {logo?.key === activeKey && logo.value ? (
              <img
                src={logo.value}
                alt={shown.title}
                className="flux-rise max-h-[5.5rem] w-auto max-w-[min(20rem,72vw)] object-contain object-left sm:max-h-[8.5rem] sm:max-w-[26rem]"
                style={{
                  animationDelay: "110ms",
                  filter: "drop-shadow(0 6px 24px rgba(0,0,0,0.55))",
                }}
              />
            ) : (
              <h1
                className="flux-rise text-3xl font-semibold leading-[1.04] tracking-[-0.035em] text-white sm:text-6xl"
                style={{
                  animationDelay: "110ms",
                  textShadow: "0 6px 30px rgba(0,0,0,0.5)",
                }}
              >
                {shown.title}
              </h1>
            )}

            <p
              className="flux-rise mt-3 text-[0.7rem] tracking-[0.12em] text-white/55 sm:mt-4 sm:text-xs"
              style={{ animationDelay: "180ms" }}
            >
              {meta}
            </p>

            {shown.overview ? (
              <p
                className="flux-rise mt-4 hidden max-w-lg text-sm leading-relaxed text-white/70 sm:line-clamp-3 sm:block [@media(max-height:820px)]:!hidden"
                style={{ animationDelay: "240ms" }}
              >
                {shown.overview}
              </p>
            ) : null}

            <div
              className="flux-rise mt-5 flex flex-wrap items-center gap-2.5 sm:mt-7 sm:gap-3"
              style={{ animationDelay: "300ms" }}
            >
              {/* small and flat: no glow, nothing shouting over the artwork */}
              <button
                type="button"
                onClick={() => navigate(mediaHref(shown))}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition-transform duration-200 hover:scale-[1.04]"
              >
                <Icon icon={Icons.PLAY} className="text-[0.6rem]" />
                Play
              </button>
              <button
                type="button"
                onClick={() => setInfo(shown)}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2 text-sm font-medium text-white ring-1 ring-white/15 backdrop-blur-sm transition-colors duration-200 hover:bg-white/20"
              >
                <Icon icon={Icons.CIRCLE_QUESTION} className="text-[0.8rem]" />
                More info
              </button>
            </div>
          </div>

          {/* ---- progress + the reel ---- */}
          <div className="mt-6 flex items-end justify-between gap-6 sm:mt-9">
            {count > 1 ? (
              <div className="flex items-center gap-1.5 sm:gap-2">
                {items.map((item, i) => {
                  const isActive = i === index;
                  const isSeen = i < index;
                  return (
                    <button
                      key={`bar-${item.type}-${item.id}`}
                      type="button"
                      aria-label={`Show ${item.title}`}
                      aria-current={isActive}
                      onClick={(event) => {
                        go(i);
                        if (event.detail > 0) event.currentTarget.blur();
                      }}
                      className={`group h-5 shrink-0 transition-[width] duration-500 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] ${
                        isActive ? "w-14 sm:w-20" : "w-4 sm:w-6"
                      }`}
                    >
                      <span className="block h-[3px] w-full overflow-hidden rounded-full bg-white/15 transition-colors duration-300 group-hover:bg-white/35">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: isActive || isSeen ? "100%" : "0%",
                            background: isActive
                              ? "#FF2A32"
                              : "rgba(255,255,255,0.4)",
                            // linear, because this is a clock: any easing makes
                            // it disagree with the time it is measuring
                            transition:
                              isActive && !reduced && !frozen
                                ? `width ${SLIDE_MS}ms linear`
                                : "width 260ms ease-out, background 260ms ease-out",
                          }}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <span />
            )}
          </div>
        </div>
      </section>

      <MediaInfoDialog item={info} onClose={() => setInfo(null)} />
    </>
  );
}
