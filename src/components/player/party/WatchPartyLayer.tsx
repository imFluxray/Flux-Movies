import classNames from "classnames";
import {
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { PartyMedia, createParty } from "@/backend/party/api";
import { Icon, Icons } from "@/components/Icon";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { linkFluxAccount, useFluxAccountStore } from "@/stores/fluxAccount";
import { rememberHostKey, usePartyStore } from "@/stores/party";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

/*
 * Watch parties inside the player.
 *
 * The host's player is the clock: it reports its position and play state every
 * couple of seconds, and immediately on any play, pause or seek. Guests follow
 * - first to the same title and episode, then to within a couple of seconds of
 * the host, re-checked every second - so the host's controls drive the room
 * without guests needing a different player.
 */

const DRIFT_SECONDS = 2.5;
const HOST_HEARTBEAT_MS = 2000;
// a jump larger than this between beats is a seek, not ordinary playback
const SEEK_JUMP_SECONDS = 2;

function posterUrl(poster?: string | null): string | null {
  if (!poster) return null;
  if (poster.startsWith("https://image.tmdb.org/")) return poster;
  return poster.startsWith("/")
    ? `https://image.tmdb.org/t/p/w342${poster}`
    : null;
}

function useCurrentMedia(): PartyMedia | null {
  const meta = usePlayerStore((state) => state.meta);
  const location = useLocation();
  return useMemo(() => {
    if (!meta) return null;
    return {
      path: location.pathname,
      title: meta.title,
      poster: posterUrl(meta.poster),
      episodeLabel:
        meta.type === "show" && meta.season && meta.episode
          ? `S${meta.season.number} E${meta.episode.number}`
          : null,
    };
  }, [meta, location.pathname]);
}

/** ?party=CODE in the address bar is what actually joins a party. */
function usePartyFromUrl() {
  const location = useLocation();
  const token = useFluxAccountStore((state) => state.token);
  const connect = usePartyStore((state) => state.connect);
  const setPanelOpen = usePartyStore((state) => state.setPanelOpen);
  const currentCode = usePartyStore((state) => state.code);
  const status = usePartyStore((state) => state.status);
  const code = new URLSearchParams(location.search).get("party")?.toUpperCase();

  useEffect(() => {
    if (!code) return;
    // without an account there is nobody to be in the room, so explain instead
    if (!token) {
      setPanelOpen(true);
      return;
    }
    if (currentCode === code && status !== "idle") return;
    connect(code, token);
  }, [code, token, currentCode, status, connect, setPanelOpen]);
}

function useHostBroadcast(media: PartyMedia | null) {
  const isHost = usePartyStore((state) => state.isHost);
  const live = usePartyStore((state) => state.status === "live");
  const sendState = usePartyStore((state) => state.sendState);
  const mediaRef = useRef(media);

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  useEffect(() => {
    if (!isHost || !live) return undefined;
    let last = { time: -999, paused: true, at: 0, path: "" };

    const push = () => {
      const current = mediaRef.current;
      if (!current) return;
      const player = usePlayerStore.getState();
      if (player.status !== playerStatus.PLAYING) return;
      last = {
        time: player.progress.time,
        paused: player.mediaPlaying.isPaused,
        at: Date.now(),
        path: current.path,
      };
      sendState({
        time: player.progress.time,
        paused: player.mediaPlaying.isPaused,
        media: current,
      });
    };

    push();
    const heartbeat = window.setInterval(push, HOST_HEARTBEAT_MS);
    // play, pause and seeks go out at once rather than on the next beat
    const unsubscribe = usePlayerStore.subscribe((player) => {
      const current = mediaRef.current;
      if (!current) return;
      const expected = last.paused
        ? last.time
        : last.time + (Date.now() - last.at) / 1000;
      const seeked =
        Math.abs(player.progress.time - expected) > SEEK_JUMP_SECONDS;
      if (
        player.mediaPlaying.isPaused !== last.paused ||
        current.path !== last.path ||
        seeked
      )
        push();
    });

    return () => {
      window.clearInterval(heartbeat);
      unsubscribe();
    };
  }, [isHost, live, sendState]);
}

function useGuestFollow() {
  const isHost = usePartyStore((state) => state.isHost);
  const live = usePartyStore((state) => state.status === "live");
  const remote = usePartyStore((state) => state.remote);
  const code = usePartyStore((state) => state.code);
  const navigate = useNavigate();
  const location = useLocation();
  const remoteRef = useRef(remote);

  useEffect(() => {
    remoteRef.current = remote;
  }, [remote]);

  // follow the host to whatever they are watching
  useEffect(() => {
    if (isHost || !live || !code || !remote?.media) return;
    if (remote.media.path !== location.pathname)
      navigate(`${remote.media.path}?party=${code}`, { replace: true });
  }, [isHost, live, code, remote, location.pathname, navigate]);

  useEffect(() => {
    if (isHost || !live) return undefined;
    const align = () => {
      const target = remoteRef.current;
      if (!target?.media) return;
      const player = usePlayerStore.getState();
      if (
        !player.display ||
        player.status !== playerStatus.PLAYING ||
        player.progress.duration <= 0 ||
        window.location.pathname !== target.media.path
      )
        return;
      const expected = target.paused
        ? target.time
        : target.time + (Date.now() - target.receivedAt) / 1000;
      if (Math.abs(player.progress.time - expected) > DRIFT_SECONDS)
        player.display.setTime(expected);
      if (target.paused && !player.mediaPlaying.isPaused)
        player.display.pause();
      if (!target.paused && player.mediaPlaying.isPaused) player.display.play();
    };
    align();
    const timer = window.setInterval(align, 1000);
    return () => window.clearInterval(timer);
  }, [isHost, live, remote]);
}

export function PartyButton() {
  const panelOpen = usePartyStore((state) => state.panelOpen);
  const setPanelOpen = usePartyStore((state) => state.setPanelOpen);
  const live = usePartyStore((state) => state.status === "live");
  return (
    <VideoPlayerButton
      icon={Icons.WATCH_PARTY}
      className={live ? "text-emerald-300" : undefined}
      onClick={() => setPanelOpen(!panelOpen)}
    />
  );
}

function Avatar(props: { name: string; host?: boolean }) {
  return (
    <span
      title={props.name}
      className={classNames(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold uppercase ring-2 ring-black",
        props.host ? "bg-amber-400 text-black" : "bg-white/20 text-white",
      )}
    >
      {props.name.charAt(0) || "?"}
    </span>
  );
}

/*
 * Being signed in on the account site is not the same as Movies having a
 * token for it, so link right here rather than sending anyone to Settings.
 */
function SignInNotice() {
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
    <div className="space-y-3 p-5 text-sm text-white/75">
      <p className="text-base font-semibold text-white">Watch together</p>
      <p>
        Link your Flux account to host or join a party - your display name comes
        from it.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={link}
        className="inline-flex items-center gap-2.5 rounded-xl bg-[#FF2A32] px-4 py-2.5 font-semibold text-white shadow-[0_8px_28px_rgba(255,42,50,0.35)] transition-transform duration-200 hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
      >
        <img src="/flux-mark.webp" alt="" className="h-4 w-4" />
        {busy ? "Waiting for approval…" : "Link Flux account"}
      </button>
      {error ? <p className="text-[#ff8b90]">{error}</p> : null}
    </div>
  );
}

function StartParty(props: { media: PartyMedia | null }) {
  const token = useFluxAccountStore((state) => state.token);
  const location = useLocation();
  const navigate = useNavigate();
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (!token || !props.media) return;
    setBusy(true);
    setError(null);
    try {
      const { code, hostKey } = await createParty(token, {
        isPublic,
        media: props.media,
        time: usePlayerStore.getState().progress.time,
      });
      rememberHostKey(code, hostKey);
      // the address bar is what joins; this makes the host a member too
      navigate(`${location.pathname}?party=${code}`, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start the party",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-5 text-sm">
      <div>
        <p className="text-base font-semibold">Watch together</p>
        <p className="mt-1 text-white/60">
          Everyone who joins follows your player, with chat alongside.
        </p>
      </div>
      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white/[0.06] px-3 py-2.5">
        <span>
          <span className="block font-semibold">Public party</span>
          <span className="text-xs text-white/50">
            {isPublic
              ? "Listed on the Watch Parties page"
              : "Only people with the code can join"}
          </span>
        </span>
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(event) => setIsPublic(event.target.checked)}
          className="h-5 w-5 accent-white"
        />
      </label>
      {error ? <p className="text-red-300">{error}</p> : null}
      <button
        type="button"
        disabled={busy || !props.media}
        onClick={start}
        className="w-full rounded-full bg-white py-2.5 font-bold text-black transition hover:bg-white/80 disabled:opacity-50"
      >
        {busy ? "Starting…" : "Start party"}
      </button>
      <button
        type="button"
        onClick={() => navigate("/parties")}
        className="w-full text-xs text-white/50 transition hover:text-white"
      >
        Browse public parties
      </button>
    </div>
  );
}

function PartyRoom() {
  const room = usePartyStore((state) => state.room);
  const code = usePartyStore((state) => state.code);
  const isHost = usePartyStore((state) => state.isHost);
  const members = usePartyStore((state) => state.members);
  const chat = usePartyStore((state) => state.chat);
  const sendChat = usePartyStore((state) => state.sendChat);
  const endParty = usePartyStore((state) => state.endParty);
  const leave = usePartyStore((state) => state.leave);
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chat.length]);

  const copy = (label: string, text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(label);
        window.setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => {});
  };

  const exit = () => {
    if (isHost) endParty();
    leave();
    // drop ?party= so the player does not rejoin straight away
    navigate(location.pathname, { replace: true });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    sendChat(text);
    setDraft("");
  };

  return (
    <>
      <div className="space-y-3 border-b border-white/10 px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-white/60">
            {isHost ? "You are hosting" : `Hosted by ${room?.hostName ?? "…"}`}
          </span>
          <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] uppercase text-white/60">
            {room?.isPublic ? "Public" : "Private"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-white/10 px-3 py-1.5 text-base font-bold tracking-[0.15em]">
            {code}
          </span>
          <button
            type="button"
            onClick={() => code && copy("code", code)}
            className="text-xs text-white/60 transition hover:text-white"
          >
            {copied === "code" ? "Copied" : "Copy code"}
          </button>
          <button
            type="button"
            onClick={() =>
              code &&
              copy(
                "link",
                `${window.location.origin}${location.pathname}?party=${code}`,
              )
            }
            className="text-xs text-white/60 transition hover:text-white"
          >
            {copied === "link" ? "Copied" : "Copy link"}
          </button>
        </div>
        {!isHost ? (
          <p className="text-xs text-white/45">
            The host controls playback - you stay in sync automatically.
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {members.slice(0, 8).map((member) => (
              <Avatar key={member.id} name={member.name} host={member.isHost} />
            ))}
          </div>
          <span className="text-xs text-white/45">
            {members.length} watching
          </span>
        </div>
      </div>

      <div
        ref={listRef}
        className="flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm"
      >
        {chat.length === 0 ? (
          <p className="text-white/40">No messages yet.</p>
        ) : (
          chat.map((message) =>
            message.system ? (
              <p key={message.id} className="text-center text-xs text-white/40">
                {message.text}
              </p>
            ) : (
              <p key={message.id} className="break-words">
                <span
                  className={classNames(
                    "mr-1.5 font-semibold",
                    message.isHost ? "text-amber-300" : "text-sky-300",
                  )}
                >
                  {message.name}
                </span>
                <span className="text-white/85">{message.text}</span>
              </p>
            ),
          )
        )}
      </div>

      <form
        onSubmit={submit}
        className="flex gap-2 border-t border-white/10 p-3"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={300}
          placeholder="Message"
          aria-label="Chat message"
          className="min-w-0 flex-1 rounded-full bg-white/10 px-4 py-2 text-sm outline-none placeholder:text-white/40 focus:bg-white/15"
        />
        <button
          type="submit"
          className="rounded-full bg-white px-4 text-sm font-bold text-black transition hover:bg-white/80"
        >
          Send
        </button>
      </form>
      <button
        type="button"
        onClick={exit}
        className="border-t border-white/10 py-2.5 text-sm text-red-300 transition hover:bg-red-500/10"
      >
        {isHost ? "End party" : "Leave party"}
      </button>
    </>
  );
}

export function WatchPartyLayer() {
  const media = useCurrentMedia();
  usePartyFromUrl();
  useHostBroadcast(media);
  useGuestFollow();
  const panelOpen = usePartyStore((state) => state.panelOpen);
  const setPanelOpen = usePartyStore((state) => state.setPanelOpen);
  const status = usePartyStore((state) => state.status);
  const message = usePartyStore((state) => state.message);
  const leave = usePartyStore((state) => state.leave);
  const token = useFluxAccountStore((state) => state.token);

  // leaving the player for anywhere but another title ends your part in it
  useEffect(
    () => () => {
      window.setTimeout(() => {
        if (!window.location.pathname.startsWith("/media/"))
          usePartyStore.getState().leave();
      }, 1500);
    },
    [],
  );

  if (!panelOpen) return null;

  let body: ReactNode;
  if (!token) body = <SignInNotice />;
  else if (status === "live") body = <PartyRoom />;
  else if (status === "connecting" || status === "reconnecting")
    body = (
      <p className="animate-pulse p-5 text-sm text-white/60">
        {status === "connecting" ? "Joining the party…" : "Reconnecting…"}
      </p>
    );
  else if (status === "ended" || status === "error")
    body = (
      <div className="space-y-3 p-5 text-sm">
        <p className="text-white/80">{message}</p>
        <button
          type="button"
          onClick={leave}
          className="rounded-full bg-white px-4 py-2 font-bold text-black transition hover:bg-white/80"
        >
          Close
        </button>
      </div>
    );
  else body = <StartParty media={media} />;

  return (
    <div
      className="absolute bottom-24 right-3 top-20 z-[60] flex w-80 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl bg-black/85 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
      onPointerUp={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="font-bold">Watch party</span>
        <button
          type="button"
          aria-label="Close watch party panel"
          onClick={() => setPanelOpen(false)}
          className="text-white/60 transition hover:text-white"
        >
          <Icon icon={Icons.X} />
        </button>
      </div>
      {body}
    </div>
  );
}
