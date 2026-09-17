import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  FluxProvider,
  getAllFluxProviders,
} from "@/backend/providers/fluxProviders";
import { runFluxProviders } from "@/backend/providers/fluxRunner";
import { SettingsCard } from "@/components/layout/SettingsCard";
import { AuthInputBox } from "@/components/text-inputs/AuthInputBox";
import { Heading1 } from "@/components/utils/Text";
import {
  getDisabledSources,
  getSourceOrder,
  setSourceDisabled,
  setSourceOrder,
} from "@/utils/sourcePrefs";

/*
 * Which sources reach you, and how.
 *
 * Two things live here because they are the same question asked twice: a
 * school network can block the proxy, or it can block an individual source,
 * and in both cases the symptom is identical - a title that will not play.
 * Being able to test each one and switch it off is the difference between
 * "the site is broken" and "that one source is blocked here".
 */

type ProxyMode = "flux" | "custom" | "none";

function proxyModeOf(proxyUrls: string[] | null): ProxyMode {
  if (proxyUrls === null) return "flux";
  if (proxyUrls.length === 0) return "none";
  return "custom";
}

type TestOutcome = { status: "working" | "notfound" | "blocked"; ms: number };

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | {
      kind: "done";
      movie: TestOutcome;
      show: TestOutcome;
    };

const TEST_CAP_MS = 8000;

// Two titles that are on essentially every catalogue, so a miss says something
// about the source rather than about the film.
const SAMPLE_MOVIE = {
  type: "movie" as const,
  title: "Fight Club",
  releaseYear: 1999,
  tmdbId: "550",
};
const SAMPLE_SHOW = {
  type: "show" as const,
  title: "Breaking Bad",
  releaseYear: 2008,
  tmdbId: "1396",
  season: { number: 1, tmdbId: "3572" },
  episode: { number: 1, tmdbId: "62085" },
};

async function testOne(
  provider: FluxProvider,
  media: typeof SAMPLE_MOVIE | typeof SAMPLE_SHOW,
): Promise<TestOutcome> {
  const started = performance.now();
  const supports =
    !provider.media_types || provider.media_types.includes(media.type);
  if (!supports) return { status: "notfound", ms: 0 };
  try {
    const output = await Promise.race([
      runFluxProviders({ media: media as any, providers: [provider] }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), TEST_CAP_MS);
      }),
    ]);
    const ms = Math.round(performance.now() - started);
    if (output?.stream) return { status: "working", ms };
    // A source that answered but had nothing for this title is not broken.
    return { status: ms >= TEST_CAP_MS ? "blocked" : "notfound", ms };
  } catch {
    return { status: "blocked", ms: Math.round(performance.now() - started) };
  }
}

function OutcomeChip({
  label,
  outcome,
}: {
  label: string;
  outcome: TestOutcome;
}) {
  const tone =
    outcome.status === "working"
      ? "text-green-400"
      : outcome.status === "blocked"
        ? "text-red-400"
        : "text-type-dimmed";
  const text =
    outcome.status === "working"
      ? `${label} ${(outcome.ms / 1000).toFixed(1)}s`
      : outcome.status === "blocked"
        ? `${label} blocked`
        : `${label} none`;
  return <span className={`text-xs font-medium ${tone}`}>{text}</span>;
}

function SourceRow({
  provider,
  disabled,
  onToggle,
  onMove,
}: {
  provider: FluxProvider;
  disabled: boolean;
  onToggle: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  const run = useCallback(async () => {
    setTest({ kind: "running" });
    const [movie, show] = await Promise.all([
      testOne(provider, SAMPLE_MOVIE),
      testOne(provider, SAMPLE_SHOW),
    ]);
    setTest({ kind: "done", movie, show });
  }, [provider]);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 transition-opacity ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <div className="flex flex-col gap-0.5 text-type-dimmed">
        <button
          type="button"
          aria-label={`Move ${provider.name} up`}
          onClick={() => onMove(-1)}
          className="hover:text-white transition-colors leading-none text-[0.6rem]"
        >
          ▲
        </button>
        <button
          type="button"
          aria-label={`Move ${provider.name} down`}
          onClick={() => onMove(1)}
          className="hover:text-white transition-colors leading-none text-[0.6rem]"
        >
          ▼
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-white">{provider.name}</p>
        <div className="mt-0.5 flex items-center gap-3">
          {test.kind === "idle" ? (
            <span className="text-xs text-type-dimmed">Untested</span>
          ) : null}
          {test.kind === "running" ? (
            <span className="text-xs text-type-dimmed">Testing…</span>
          ) : null}
          {test.kind === "done" ? (
            <>
              <OutcomeChip label="Movie" outcome={test.movie} />
              <span className="text-type-dimmed text-xs">/</span>
              <OutcomeChip label="TV" outcome={test.show} />
            </>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={run}
        disabled={test.kind === "running"}
        className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/[0.13] disabled:opacity-50"
      >
        {test.kind === "running" ? "Testing" : "Test"}
      </button>

      <button
        type="button"
        onClick={onToggle}
        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
          disabled
            ? "bg-white/[0.06] text-white hover:bg-white/[0.13]"
            : "border border-white/15 text-type-dimmed hover:text-white"
        }`}
      >
        {disabled ? "On" : "Off"}
      </button>
    </div>
  );
}

function ProxyRadio({
  active,
  title,
  description,
  onSelect,
  children,
}: {
  active: boolean;
  title: string;
  description: string;
  onSelect: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left transition-colors ${
        active
          ? "border-white/25 bg-white/[0.06]"
          : "border-white/10 hover:border-white/20"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
            active ? "border-[#FF2A32]" : "border-white/30"
          }`}
        >
          {active ? (
            <span className="h-2 w-2 rounded-full bg-[#FF2A32]" />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white">{title}</p>
          <p className="mt-1 text-sm text-type-dimmed">{description}</p>
          {children}
        </div>
      </div>
    </button>
  );
}

export function SourcesPart(props: {
  proxyUrls: string[] | null;
  setProxyUrls: Dispatch<SetStateAction<string[] | null>>;
}) {
  const { proxyUrls, setProxyUrls } = props;
  const mode = proxyModeOf(proxyUrls);

  const [providers, setProviders] = useState<FluxProvider[]>([]);
  const [order, setOrderState] = useState<string[]>([]);
  const [disabled, setDisabledState] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    getAllFluxProviders()
      .then((all) => {
        if (!live) return;
        setProviders(all);
        const stored = getSourceOrder();
        const known = all.map((p) => p.id);
        const merged = [
          ...stored.filter((id) => known.includes(id)),
          ...known.filter((id) => !stored.includes(id)),
        ];
        setOrderState(merged);
        setDisabledState(getDisabledSources());
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const move = useCallback((id: string, direction: -1 | 1) => {
    setOrderState((current) => {
      const index = current.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = current.slice();
      [next[index], next[target]] = [next[target], next[index]];
      setSourceOrder(next);
      return next;
    });
  }, []);

  const toggle = useCallback((id: string) => {
    setDisabledState((current) => {
      const isOff = current.includes(id);
      setSourceDisabled(id, !isOff);
      return isOff ? current.filter((v) => v !== id) : [...current, id];
    });
  }, []);

  const ordered = order
    .map((id) => providers.find((p) => p.id === id))
    .filter(Boolean) as FluxProvider[];

  return (
    <div>
      <Heading1 border>Sources &amp; proxy</Heading1>

      <SettingsCard>
        <p className="mb-4 font-bold text-white">Connection</p>
        <div className="flex flex-col gap-3">
          <ProxyRadio
            active={mode === "flux"}
            title="Flux Proxy"
            description="Routes source lookups through Flux's own proxy. Needed on most school and workplace networks, and the right choice unless you know otherwise."
            onSelect={() => setProxyUrls(null)}
          />
          <ProxyRadio
            active={mode === "custom"}
            title="Custom proxy URL"
            description="Point Flux at a proxy you run yourself."
            onSelect={() => setProxyUrls([""])}
          >
            {mode === "custom" ? (
              <div
                className="mt-3"
                onClick={(e) => e.stopPropagation()}
                role="presentation"
              >
                <AuthInputBox
                  onChange={(value) => setProxyUrls([value])}
                  value={proxyUrls?.[0] ?? ""}
                  placeholder="https://your-proxy.example.com"
                />
              </div>
            ) : null}
          </ProxyRadio>
          <ProxyRadio
            active={mode === "none"}
            title="No proxy"
            description="Connect to sources directly. Faster when it works, but most sources will be blocked on a filtered network."
            onSelect={() => setProxyUrls([])}
          />
        </div>
      </SettingsCard>

      <SettingsCard className="mt-6">
        <div className="mb-1 flex items-start justify-between gap-4">
          <div>
            <p className="font-bold text-white">Sources</p>
            <p className="mt-1 max-w-[28rem] text-sm text-type-dimmed">
              Tried in this order. Test a source against a sample film and
              episode to see whether it reaches you here — a source blocked on
              this network may work fine elsewhere, so switching one off is
              never permanent.
            </p>
          </div>
        </div>

        <div className="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/10">
          {ordered.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-type-dimmed">
              Loading sources…
            </div>
          ) : (
            ordered.map((provider) => (
              <SourceRow
                key={provider.id}
                provider={provider}
                disabled={disabled.includes(provider.id)}
                onToggle={() => toggle(provider.id)}
                onMove={(direction) => move(provider.id, direction)}
              />
            ))
          )}
        </div>
      </SettingsCard>
    </div>
  );
}
