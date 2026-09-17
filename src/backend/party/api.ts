/*
 * Client for the watch party server (flux-party), served same-origin under
 * /party. Rooms are created over HTTP; everything live - playback sync, the
 * member list and chat - runs over the WebSocket in stores/party.
 */

export interface PartyMedia {
  /** the Flux player route everyone watches, e.g. /media/tmdb-tv-.../1/2 */
  path: string;
  title: string;
  poster: string | null;
  episodeLabel: string | null;
}

export interface PartySummary {
  code: string;
  isPublic: boolean;
  hostName: string;
  title: string;
  poster: string | null;
  episodeLabel: string | null;
  media: PartyMedia;
  watching: number;
  startedAt: number;
}

export interface PartyMember {
  id: string;
  name: string;
  avatarSeed: number;
  isHost: boolean;
}

export interface PartyChatMessage {
  id: string;
  name: string;
  text: string;
  at: number;
  isHost: boolean;
  system?: boolean;
}

const BASE = "/party";

async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export async function listPublicParties(): Promise<PartySummary[]> {
  const res = await fetch(`${BASE}/api/rooms`, { cache: "no-store" });
  if (!res.ok) throw new Error(await errorFrom(res, "Could not load parties"));
  const body = await res.json();
  return body?.rooms ?? [];
}

export async function findParty(code: string): Promise<PartySummary | null> {
  const res = await fetch(
    `${BASE}/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error(await errorFrom(res, "Could not look up that code"));
  const body = await res.json();
  return body?.room ?? null;
}

export async function createParty(
  token: string,
  options: { isPublic: boolean; media: PartyMedia; time: number },
): Promise<{ code: string; hostKey: string }> {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(options),
  });
  if (!res.ok)
    throw new Error(await errorFrom(res, "Could not start the party"));
  return res.json();
}

export function partySocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${BASE}/ws`;
}

export function partyLink(media: PartyMedia, code: string): string {
  return `${media.path}?party=${code}`;
}
