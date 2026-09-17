import { useCallback, useState } from "react";

import { Icon, Icons } from "@/components/Icon";
import { linkFluxAccount, useFluxAccountStore } from "@/stores/fluxAccount";
import { defaultAvatarFor } from "@/utils/avatars";

/*
 * Replaces the inherited "Sync to sudo-cloud" callout.
 *
 * Flux Stratopad is the identity, so this does not ask for a password: it
 * opens the account origin in a popup, the user approves there, and a signed
 * token comes back. Same shape as a "sign in with…" button, themed as ours.
 */

function Avatar(props: { username: string; seed: number }) {
  // stable hue from the seed the server derives from the username, so the
  // same person looks the same on every device and in watch parties
  const hue = (props.seed * 137) % 360;
  return (
    <div
      className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 70% 45%), hsl(${
          (hue + 40) % 360
        } 70% 28%))`,
      }}
    >
      <img
        src={defaultAvatarFor(props.username)}
        alt=""
        className="h-full w-full object-cover"
      />
    </div>
  );
}

export function FluxAccountPart() {
  const token = useFluxAccountStore((s) => s.token);
  const profile = useFluxAccountStore((s) => s.profile);
  const lastSyncedAt = useFluxAccountStore((s) => s.lastSyncedAt);
  const setLink = useFluxAccountStore((s) => s.setLink);
  const unlink = useFluxAccountStore((s) => s.unlink);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = useCallback(async () => {
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
  }, [setLink]);

  const linked = !!token && !!profile;

  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#15151b] to-[#0b0b0e]">
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="flex items-center gap-4">
          {linked ? (
            <Avatar username={profile.username} seed={profile.avatarSeed} />
          ) : (
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#FF2A32]/15 ring-1 ring-[#FF2A32]/40">
              <Icon icon={Icons.USER} className="text-lg text-[#FF2A32]" />
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-tight text-white">
              {linked ? `@${profile.username}` : "Link your Flux account"}
            </h3>
            <p className="mt-1 max-w-md text-sm leading-relaxed text-white/55">
              {linked ? (
                <>
                  {profile.hasLicence ? "Licence linked · " : "Free account · "}
                  {lastSyncedAt
                    ? `synced ${new Date(lastSyncedAt).toLocaleTimeString()}`
                    : "waiting for first sync"}
                </>
              ) : (
                "Keep your watch history, list and licence across every device you sign in on."
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-3">
          {linked ? (
            <button
              type="button"
              onClick={() => unlink()}
              className="rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
            >
              Unlink
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={link}
              className="inline-flex items-center gap-2.5 rounded-xl bg-[#FF2A32] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_28px_rgba(255,42,50,0.35)] transition-transform duration-200 hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
            >
              <img src="/flux-mark.webp" alt="" className="h-4 w-4" />
              {busy ? "Waiting for approval…" : "Link Flux account"}
            </button>
          )}
        </div>
      </div>

      {error ? (
        <p className="border-t border-white/10 bg-[#FF2A32]/10 px-6 py-3 text-sm text-[#ff8b90] sm:px-8">
          {error}
        </p>
      ) : null}
    </div>
  );
}
