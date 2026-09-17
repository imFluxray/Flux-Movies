import { create } from "zustand";

import {
  PartyChatMessage,
  PartyMedia,
  PartyMember,
  PartySummary,
  partySocketUrl,
} from "@/backend/party/api";

/*
 * The live watch party connection.
 *
 * The socket lives at module level rather than in a component, because the
 * player remounts when a guest follows the host to another title and the
 * party has to survive that. Only the store's state reaches React.
 */

type PartyStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "ended"
  | "error";

export interface RemotePlayback {
  time: number;
  paused: boolean;
  media: PartyMedia;
  /** local clock when it arrived, to extrapolate a playing host's position */
  receivedAt: number;
}

interface PartyStore {
  code: string | null;
  isHost: boolean;
  status: PartyStatus;
  message: string | null;
  room: PartySummary | null;
  members: PartyMember[];
  chat: PartyChatMessage[];
  remote: RemotePlayback | null;
  panelOpen: boolean;
  connect(code: string, token: string): void;
  leave(): void;
  endParty(): void;
  sendChat(text: string): void;
  sendState(state: { time: number; paused: boolean; media: PartyMedia }): void;
  setPanelOpen(open: boolean): void;
}

const HOST_KEY_PREFIX = "flux-party-host:";
const MAX_RETRIES = 5;
// the server closes with these on purpose; reconnecting would not help
const FINAL_CLOSE_CODES = new Set([4000, 4001, 4003, 4004, 4005]);

/** Kept per tab, so a host who refreshes the player is still the host. */
export function rememberHostKey(code: string, hostKey: string) {
  try {
    sessionStorage.setItem(HOST_KEY_PREFIX + code, hostKey);
  } catch {
    // storage blocked: hosting still works until the tab reloads
  }
}

function hostKeyFor(code: string): string | null {
  try {
    return sessionStorage.getItem(HOST_KEY_PREFIX + code);
  } catch {
    return null;
  }
}

let socket: WebSocket | null = null;
let retries = 0;
let retryTimer: number | null = null;

export const usePartyStore = create<PartyStore>((set, get) => {
  const transmit = (payload: Record<string, unknown>) => {
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(payload));
  };

  const handle = (data: any) => {
    switch (data?.type) {
      case "welcome":
        retries = 0;
        set({
          status: "live",
          message: null,
          room: data.room ?? null,
          isHost: Boolean(data.you?.isHost),
          members: data.members ?? [],
          chat: data.chat ?? [],
          remote: data.state ? { ...data.state, receivedAt: Date.now() } : null,
          panelOpen: true,
        });
        break;
      case "members":
        set((state) => ({
          members: data.members ?? [],
          room: state.room
            ? { ...state.room, watching: (data.members ?? []).length }
            : null,
        }));
        break;
      case "state":
        set({
          remote: {
            time: Number(data.time) || 0,
            paused: Boolean(data.paused),
            media: data.media,
            receivedAt: Date.now(),
          },
        });
        break;
      case "chat":
        set((state) => ({ chat: [...state.chat, data.message].slice(-100) }));
        break;
      case "ended":
        set({
          status: "ended",
          message: data.reason ?? "The party has ended",
          remote: null,
          panelOpen: true,
        });
        break;
      case "error":
        set({
          status: "error",
          message: data.error ?? "Could not join the party",
          panelOpen: true,
        });
        break;
      default:
        break;
    }
  };

  const open = (code: string, token: string) => {
    const ws = new WebSocket(partySocketUrl());
    socket = ws;
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          type: "hello",
          code,
          token,
          hostKey: hostKeyFor(code),
        }),
      );
    ws.onmessage = (event) => {
      try {
        handle(JSON.parse(String(event.data)));
      } catch {
        // not ours to understand
      }
    };
    ws.onclose = (event) => {
      // replaced by a newer connection, or closed by leave()
      if (socket !== ws) return;
      socket = null;
      const { status } = get();
      if (
        status === "ended" ||
        status === "error" ||
        FINAL_CLOSE_CODES.has(event.code)
      )
        return;
      if (retries >= MAX_RETRIES) {
        set({ status: "error", message: "Lost the connection to the party" });
        return;
      }
      retries += 1;
      set({ status: "reconnecting" });
      retryTimer = window.setTimeout(
        () => open(code, token),
        Math.min(8000, 500 * 2 ** retries),
      );
    };
  };

  const disconnect = () => {
    if (retryTimer) window.clearTimeout(retryTimer);
    retryTimer = null;
    const closing = socket;
    socket = null;
    closing?.close(1000, "left");
  };

  return {
    code: null,
    isHost: false,
    status: "idle",
    message: null,
    room: null,
    members: [],
    chat: [],
    remote: null,
    panelOpen: false,
    connect(rawCode, token) {
      const code = rawCode.toUpperCase();
      const { code: currentCode, status } = get();
      if (
        currentCode === code &&
        (status === "connecting" ||
          status === "live" ||
          status === "reconnecting")
      )
        return;
      disconnect();
      retries = 0;
      set({
        code,
        status: "connecting",
        message: null,
        isHost: false,
        room: null,
        members: [],
        chat: [],
        remote: null,
      });
      open(code, token);
    },
    leave() {
      disconnect();
      set({
        code: null,
        status: "idle",
        message: null,
        isHost: false,
        room: null,
        members: [],
        chat: [],
        remote: null,
      });
    },
    endParty() {
      transmit({ type: "end" });
    },
    sendChat(text) {
      transmit({ type: "chat", text });
    },
    sendState(state) {
      transmit({ type: "state", ...state });
    },
    setPanelOpen(panelOpen) {
      set({ panelOpen });
    },
  };
});
