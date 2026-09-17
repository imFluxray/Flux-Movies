import { useEffect, useRef } from "react";

import { useBookmarkStore } from "@/stores/bookmarks";
import {
  pullFluxLibrary,
  pushFluxLibrary,
  useFluxAccountStore,
  verifyFluxToken,
} from "@/stores/fluxAccount";
import { useProgressStore } from "@/stores/progress";

/*
 * Crossplay.
 *
 * One blob per account holding watch progress and the list. On link we pull
 * the remote copy and merge it in; after that local changes are pushed on a
 * debounce.
 *
 * Merging is per item and decided by updatedAt rather than "last writer wins"
 * on the whole blob - otherwise opening the site on a second device would
 * overwrite everything you watched on the first.
 *
 * Renders nothing.
 */

const PUSH_DEBOUNCE_MS = 4000;

function mergeByUpdatedAt<T extends { updatedAt?: number }>(
  local: Record<string, T>,
  remote: Record<string, T>,
): { merged: Record<string, T>; changed: boolean } {
  const merged: Record<string, T> = { ...local };
  let changed = false;
  Object.entries(remote ?? {}).forEach(([id, remoteItem]) => {
    const localItem = local[id];
    const remoteAt = remoteItem?.updatedAt ?? 0;
    const localAt = localItem?.updatedAt ?? 0;
    if (!localItem || remoteAt > localAt) {
      merged[id] = remoteItem;
      changed = true;
    }
  });
  return { merged, changed };
}

export function FluxLibrarySync() {
  const token = useFluxAccountStore((s) => s.token);
  const setProfile = useFluxAccountStore((s) => s.setProfile);
  const unlink = useFluxAccountStore((s) => s.unlink);
  const markSynced = useFluxAccountStore((s) => s.markSynced);

  const progressItems = useProgressStore((s) => s.items);
  const replaceItems = useProgressStore((s) => s.replaceItems);
  const bookmarks = useBookmarkStore((s) => s.bookmarks);
  const replaceBookmarks = useBookmarkStore((s) => s.replaceBookmarks);

  const pulledFor = useRef<string | null>(null);
  const pushTimer = useRef<number | null>(null);
  const latest = useRef({ progressItems, bookmarks });
  latest.current = { progressItems, bookmarks };

  // ---- on link: confirm the token still works, then pull and merge ----
  useEffect(() => {
    if (!token || pulledFor.current === token) return;
    pulledFor.current = token;
    let alive = true;

    (async () => {
      const profile = await verifyFluxToken(token);
      if (!alive) return;
      if (!profile) {
        // the account was deleted, or the token was revoked
        unlink();
        return;
      }
      setProfile(profile);

      const remote = await pullFluxLibrary(token);
      if (!alive || !remote) return;

      const progress = mergeByUpdatedAt(
        latest.current.progressItems as any,
        (remote.progress ?? {}) as any,
      );
      if (progress.changed) replaceItems(progress.merged as any);

      const list = mergeByUpdatedAt(
        latest.current.bookmarks as any,
        (remote.bookmarks ?? {}) as any,
      );
      if (list.changed) replaceBookmarks(list.merged as any);

      markSynced();
    })();

    return () => {
      alive = false;
    };
  }, [token, setProfile, unlink, replaceItems, replaceBookmarks, markSynced]);

  // ---- after that: push local changes, debounced ----
  useEffect(() => {
    if (!token || pulledFor.current !== token) return;
    if (pushTimer.current) window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(async () => {
      const ok = await pushFluxLibrary(token, {
        progress: latest.current.progressItems as any,
        bookmarks: latest.current.bookmarks as any,
        updatedAt: Date.now(),
      });
      if (ok) markSynced();
    }, PUSH_DEBOUNCE_MS);

    return () => {
      if (pushTimer.current) window.clearTimeout(pushTimer.current);
    };
  }, [token, progressItems, bookmarks, markSynced]);

  return null;
}
