import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

/*
 * The Flux Stratopad account, as seen from Flux Movies.
 *
 * Movies runs on a different origin from the account system, so it can never
 * read that session cookie. Linking opens /authorize in a popup on the account
 * origin - where the user is already signed in - and that page hands back a
 * signed token over postMessage. From then on the token is the credential.
 */

export const FLUX_SSO_ORIGIN = "https://web.flux.focuznow.com";

export interface FluxProfile {
  id: number;
  username: string;
  avatarSeed: number;
  hasLicence: boolean;
}

interface FluxAccountStore {
  token: string | null;
  profile: FluxProfile | null;
  lastSyncedAt: number | null;
  setLink(token: string, profile: FluxProfile): void;
  setProfile(profile: FluxProfile): void;
  markSynced(): void;
  unlink(): void;
}

export const useFluxAccountStore = create(
  persist(
    immer<FluxAccountStore>((set) => ({
      token: null,
      profile: null,
      lastSyncedAt: null,
      setLink(token, profile) {
        set((s) => {
          s.token = token;
          s.profile = profile;
        });
      },
      setProfile(profile) {
        set((s) => {
          s.profile = profile;
        });
      },
      markSynced() {
        set((s) => {
          s.lastSyncedAt = Date.now();
        });
      },
      unlink() {
        set((s) => {
          s.token = null;
          s.profile = null;
          s.lastSyncedAt = null;
        });
      },
    })),
    { name: "__FLUX::account" },
  ),
);

export async function verifyFluxToken(
  token: string,
): Promise<FluxProfile | null> {
  try {
    const res = await fetch(`${FLUX_SSO_ORIGIN}/api/sso/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    return payload?.profile ?? null;
  } catch {
    return null;
  }
}

/**
 * Open the approval popup and resolve once the account page reports back.
 *
 * Only messages from FLUX_SSO_ORIGIN are honoured - a postMessage listener
 * that trusts any sender is a token-stealing hole.
 */
export function linkFluxAccount(): Promise<{
  token: string;
  profile: FluxProfile;
} | null> {
  return new Promise((resolve) => {
    const url = `${FLUX_SSO_ORIGIN}/authorize?origin=${encodeURIComponent(
      window.location.origin,
    )}`;

    const width = 460;
    const height = 620;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2.4;
    const popup = window.open(
      url,
      "flux-sso",
      `width=${width},height=${height},left=${Math.max(left, 0)},top=${Math.max(
        top,
        0,
      )},menubar=no,toolbar=no,location=no,status=no`,
    );
    if (!popup) {
      resolve(null);
      return;
    }

    let settled = false;
    // set the moment the account page answers: it closes its own window right
    // after posting, and that must not be mistaken for the viewer giving up
    let answered = false;
    let watchClosed = 0;
    // declared up front so finish() can detach it without a forward reference
    let onMessage: (event: MessageEvent) => void = () => {};
    const finish = (value: { token: string; profile: FluxProfile } | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      window.clearInterval(watchClosed);
      resolve(value);
    };

    onMessage = async (event: MessageEvent) => {
      if (event.origin !== FLUX_SSO_ORIGIN) return;
      const data = event.data;
      if (!data || data.type !== "flux-sso") return;
      answered = true;
      if (!data.ok || typeof data.token !== "string") {
        finish(null);
        return;
      }
      // this round trip is what the closed-window check used to beat, throwing
      // away a token that had already arrived
      const profile = await verifyFluxToken(data.token);
      finish(profile ? { token: data.token, profile } : null);
    };

    window.addEventListener("message", onMessage);
    // the viewer can simply close the window; do not hang forever on that
    watchClosed = window.setInterval(() => {
      if (!popup.closed || answered) return;
      window.clearInterval(watchClosed);
      // a message posted just before the window closed can still be on its way
      window.setTimeout(() => {
        if (!answered) finish(null);
      }, 1500);
    }, 500);
  });
}

/*
 * Linking or unlinking in one tab reaches every other open tab at once. The
 * persisted store only reads storage when the page loads, so a tab opened
 * before linking kept asking to link until it was refreshed.
 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === "__FLUX::account")
      useFluxAccountStore.persist.rehydrate();
  });
}

export interface FluxLibrary {
  progress?: Record<string, unknown>;
  bookmarks?: Record<string, unknown>;
  updatedAt?: number;
}

export async function pullFluxLibrary(
  token: string,
): Promise<FluxLibrary | null> {
  try {
    const res = await fetch(`${FLUX_SSO_ORIGIN}/api/sso/library`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    return (payload?.data ?? {}) as FluxLibrary;
  } catch {
    return null;
  }
}

export async function pushFluxLibrary(
  token: string,
  data: FluxLibrary,
): Promise<boolean> {
  try {
    const res = await fetch(`${FLUX_SSO_ORIGIN}/api/sso/library`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
