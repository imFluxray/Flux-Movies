import { FormEvent, useCallback, useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";

import {
  PartySummary,
  findParty,
  listPublicParties,
  partyLink,
} from "@/backend/party/api";
import { Icon, Icons } from "@/components/Icon";
import { ThiccContainer } from "@/components/layout/ThinContainer";
import { Flare } from "@/components/utils/Flare";
import { SubPageLayout } from "@/pages/layouts/SubPageLayout";
import { linkFluxAccount, useFluxAccountStore } from "@/stores/fluxAccount";

import { PageTitle } from "./parts/util/PageTitle";

const REFRESH_MS = 15000;

function PartyCard(props: { party: PartySummary; onOpen: () => void }) {
  const { party } = props;
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="group text-left tabbable rounded-xl"
    >
      <Flare.Base className="group cursor-pointer rounded-xl relative p-[0.65em] bg-background-main transition-colors duration-300 bg-transparent">
        <Flare.Light
          flareSize={300}
          cssColorVar="--colors-mediaCard-hoverAccent"
          backgroundClass="bg-mediaCard-hoverBackground duration-200"
          className="rounded-xl bg-background-main group-hover:opacity-100"
        />
        <div className="relative rounded-xl overflow-hidden aspect-[2/3] bg-mediaCard-hoverBackground">
          {party.poster ? (
            <img
              src={party.poster}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : null}
          <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-[#FF2A32] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-[0_6px_18px_rgba(255,42,50,0.45)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            Live
          </span>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background-main via-background-main/80 to-transparent px-3 pb-3 pt-10">
            <p className="truncate text-sm font-bold text-white">
              {party.title}
            </p>
            {party.episodeLabel ? (
              <p className="text-xs text-type-secondary">
                {party.episodeLabel}
              </p>
            ) : null}
          </div>
        </div>
        <div className="relative mt-2 flex items-center justify-between px-1 text-xs text-type-dimmed">
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon icon={Icons.USER} className="text-[0.7rem] shrink-0" />
            <span className="truncate">{party.hostName}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <Icon icon={Icons.EYE} className="text-[0.7rem]" />
            {party.watching}
          </span>
        </div>
      </Flare.Base>
    </button>
  );
}

function LinkAccountBanner() {
  const setLink = useFluxAccountStore((state) => state.setLink);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = async () => {
    setBusy(true);
    setError(null);
    const result = await linkFluxAccount();
    setBusy(false);
    if (!result) {
      setError(
        "Linking was cancelled, or the popup was blocked. Allow pop-ups for this site and try again.",
      );
      return;
    }
    setLink(result.token, result.profile);
  };

  return (
    <div className="mt-10 overflow-hidden rounded-xl border border-white/10 bg-largeCard-background">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#FF2A32]/15 ring-1 ring-[#FF2A32]/40">
            <Icon icon={Icons.WATCH_PARTY} className="text-lg text-[#FF2A32]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">
              Link your Flux account to join
            </h2>
            <p className="mt-1 max-w-md text-sm text-type-secondary">
              Parties use your Flux name, so everyone can see who is watching.
              Signing in on the account site is not enough - this links it to
              Movies.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={link}
          className="inline-flex shrink-0 items-center gap-2.5 rounded-xl bg-[#FF2A32] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_28px_rgba(255,42,50,0.35)] transition-transform duration-200 hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
        >
          <img src="/flux-mark.webp" alt="" className="h-4 w-4" />
          {busy ? "Waiting for approval…" : "Link Flux account"}
        </button>
      </div>
      {error ? (
        <p className="border-t border-white/10 bg-[#FF2A32]/10 px-5 py-3 text-sm text-[#ff8b90] sm:px-6">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function PartiesPage() {
  const navigate = useNavigate();
  const token = useFluxAccountStore((state) => state.token);
  const [parties, setParties] = useState<PartySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    listPublicParties()
      .then((list) => {
        setParties(list);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const join = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6) {
      setJoinError("Party codes are 6 characters");
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const party = await findParty(trimmed);
      if (!party) setJoinError("No party with that code - it may have ended");
      else navigate(partyLink(party.media, party.code));
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Could not join");
    } finally {
      setJoining(false);
    }
  };

  return (
    <SubPageLayout>
      <Helmet>
        <title>Watch Parties</title>
      </Helmet>
      <PageTitle subpage k="global.pages.discover" />
      <div className="mb-16 sm:mb-2">
        <div className="mt-44 space-y-16 text-center">
          <div className="relative z-10 mb-16">
            <h1 className="text-4xl cursor-default font-bold text-white">
              Watch Parties
            </h1>
            <p className="mt-3 text-type-secondary">
              Jump into a room and watch together, chat included.
            </p>
          </div>
        </div>
      </div>
      <ThiccContainer>
        <div className="pb-24">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <form
              onSubmit={join}
              className="flex items-center gap-2 rounded-full bg-pill-background bg-opacity-50 px-2 py-2 backdrop-blur-lg"
            >
              <input
                value={code}
                onChange={(event) =>
                  setCode(
                    event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6),
                  )
                }
                placeholder="Party code"
                aria-label="Party code"
                className="w-36 bg-transparent px-3 text-sm font-semibold uppercase text-white outline-none placeholder:normal-case placeholder:font-normal placeholder:text-type-dimmed"
              />
              <button
                type="submit"
                disabled={joining}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black transition hover:bg-white/80 disabled:opacity-60"
              >
                {joining ? "Joining…" : "Join"}
              </button>
            </form>
            <button
              type="button"
              onClick={refresh}
              className="flex items-center gap-2 rounded-full bg-pill-background bg-opacity-50 px-4 py-2 text-sm text-white transition-[background,transform] duration-100 hover:scale-105 hover:bg-pill-backgroundHover"
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                aria-hidden="true"
              >
                <path
                  fill="currentColor"
                  d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"
                />
              </svg>
              Refresh
            </button>
          </div>

          {joinError ? (
            <p className="mt-3 text-center text-sm text-type-danger sm:text-left">
              {joinError}
            </p>
          ) : null}

          {!token ? <LinkAccountBanner /> : null}

          {error ? (
            <p className="mt-10 text-center text-sm text-type-danger">
              {error}
            </p>
          ) : null}

          {parties.length ? (
            <div className="mt-10 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {parties.map((party) => (
                <PartyCard
                  key={party.code}
                  party={party}
                  onOpen={() => navigate(partyLink(party.media, party.code))}
                />
              ))}
            </div>
          ) : !loading && !error ? (
            <div className="mt-12 rounded-xl border border-dashed border-utils-divider border-opacity-60 px-6 py-16 text-center">
              <Icon
                icon={Icons.WATCH_PARTY}
                className="text-3xl text-type-dimmed"
              />
              <p className="mt-4 font-semibold text-white">
                No public parties right now
              </p>
              <p className="mt-1 text-sm text-type-dimmed">
                Open any title and press the watch party button to start one.
              </p>
            </div>
          ) : null}
        </div>
      </ThiccContainer>
    </SubPageLayout>
  );
}
