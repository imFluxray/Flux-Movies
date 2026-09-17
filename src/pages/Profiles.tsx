import classNames from "classnames";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { get } from "@/backend/metadata/tmdb";
import { Icon, Icons } from "@/components/Icon";
import { conf } from "@/setup/config";
import { useBookmarkStore } from "@/stores/bookmarks";
import { LocalProfile, useProfileStore } from "@/stores/profiles";
import { useProgressStore } from "@/stores/progress";
import { useTasteStore } from "@/stores/taste";
import { FeedItem, toFeedItem } from "@/utils/algorithm";
import {
  AVATAR_GROUPS,
  avatarForProfile,
  avatarUrl,
  fileToAvatar,
} from "@/utils/avatars";
import { fetchTitleLogo } from "@/utils/heroMedia";

/*
 * The profile screen, laid out the way a TV app does it: a vertical rail of
 * profiles on the left over a full-bleed piece of artwork on the right.
 *
 * The artwork is a real trending title with its own logo, so the screen is a
 * storefront rather than a form. Selecting stays instant.
 */

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

/** One trending title, with its campaign logo and genres, for the backdrop. */
function useFeatured() {
  const [item, setItem] = useState<FeedItem | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [genres, setGenres] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await get<any>("/trending/all/week", {
          api_key: conf().TMDB_READ_API_KEY,
          language: "en-US",
        });
        const pool = (data?.results ?? [])
          .map((raw: any) => toFeedItem(raw))
          .filter((f: FeedItem | null): f is FeedItem => !!f?.backdrop);
        if (!pool.length || !alive) return;
        const pick = pool[Math.floor(Math.random() * Math.min(pool.length, 8))];
        setItem(pick);

        const path = pick.type === "show" ? "tv" : "movie";
        get<any>(`/${path}/${pick.id}`, {
          api_key: conf().TMDB_READ_API_KEY,
          language: "en-US",
        })
          .then((detail) => {
            if (alive)
              setGenres(
                (detail?.genres ?? []).slice(0, 3).map((g: any) => g.name),
              );
          })
          .catch(() => {});
        fetchTitleLogo(pick).then((l) => {
          if (alive) setLogo(l);
        });
      } catch {
        /* the rail works fine on plain black */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { item, logo, genres };
}

function AvatarPicker(props: {
  value: string;
  onPick: (url: string) => void;
  onError: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [group, setGroup] = useState(AVATAR_GROUPS[0].id);
  const active = AVATAR_GROUPS.find((g) => g.id === group) ?? AVATAR_GROUPS[0];

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-[0.18em] text-white/40">
          Avatar
        </span>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/75 transition-colors hover:border-white/40 hover:text-white"
        >
          Upload your own
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            try {
              props.onPick(await fileToAvatar(file));
            } catch (err: any) {
              props.onError(err?.message ?? "That image could not be used.");
            }
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {AVATAR_GROUPS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setGroup(entry.id)}
            className={classNames(
              "rounded-lg px-2.5 py-1 text-[0.7rem] font-medium transition-colors",
              entry.id === group
                ? "bg-white/15 text-white"
                : "text-white/45 hover:text-white",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid max-h-56 grid-cols-6 gap-2 overflow-y-auto pr-1 sm:grid-cols-8">
        {Array.from({ length: active.count }, (_, i) => {
          const id = `${active.id}_${i + 1}`;
          const url = avatarUrl(id);
          return (
            <button
              key={id}
              type="button"
              aria-label={id}
              aria-pressed={props.value === url}
              onClick={() => props.onPick(url)}
              className={classNames(
                "overflow-hidden rounded-xl transition-all",
                props.value === url
                  ? "ring-2 ring-[#FF2A32]"
                  : "ring-1 ring-white/10 hover:ring-white/40",
              )}
            >
              <img src={url} alt="" loading="lazy" className="h-full w-full" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Shell(props: {
  children: React.ReactNode;
  onClose: () => void;
  label: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") props.onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props]);

  return (
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-black/80 p-4 backdrop-blur-md"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-background-main p-7 shadow-2xl ring-1 ring-white/10"
      >
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close"
          className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/5 text-white/70 ring-1 ring-white/10 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Icon icon={Icons.X} className="text-xs" />
        </button>
        {props.children}
      </div>
    </div>
  );
}

/** Where the viewer was heading before a profile had to be chosen. */
export const INTENDED_PATH_KEY = "__FLUX::intended-path";

export function ProfilesPage() {
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();
  const featured = useFeatured();

  const profiles = useProfileStore((s) => s.profiles);
  const addProfile = useProfileStore((s) => s.addProfile);
  const removeProfile = useProfileStore((s) => s.removeProfile);
  const renameProfile = useProfileStore((s) => s.renameProfile);
  const setAvatar = useProfileStore((s) => s.setAvatar);
  const selectProfile = useProfileStore((s) => s.selectProfile);

  const [focus, setFocus] = useState(0);
  const [editId, setEditId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [draftAvatar, setDraftAvatar] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const anyModal = creating || !!editId || !!deleteId;

  const activate = useCallback(
    (profile: LocalProfile) => {
      selectProfile(profile.id);
      useBookmarkStore.setState({
        bookmarks: profile.library.bookmarks,
        updateQueue: [],
      });
      useProgressStore.setState({
        items: profile.library.progress,
        updateQueue: [],
      });
      useTasteStore.getState().replaceLikes(profile.library.likes);
      /*
       * Back to whatever was asked for, not always the home page: a shared
       * link - a watch party invite especially - lands here first because a
       * profile has to be chosen, and dropping its query string would lose
       * the party code.
       */
      let destination = "/";
      try {
        destination = sessionStorage.getItem(INTENDED_PATH_KEY) || "/";
        sessionStorage.removeItem(INTENDED_PATH_KEY);
      } catch {
        // storage blocked: the home page is a fine fallback
      }
      navigate(destination);
    },
    [navigate, selectProfile],
  );

  /* ---- a TV rail is driven with up/down ---- */
  useEffect(() => {
    if (anyModal) return;
    function onKey(event: KeyboardEvent) {
      const last = profiles.length; // the add tile
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setFocus((current) => {
          const next = current + (event.key === "ArrowDown" ? 1 : -1);
          const clamped = Math.max(0, Math.min(last, next));
          tiles.current[clamped]?.focus();
          return clamped;
        });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [profiles.length, anyModal]);

  const openCreate = () => {
    setName("");
    setDraftAvatar(avatarUrl(`vibrent_${1 + Math.floor(Math.random() * 27)}`));
    setError(null);
    setCreating(true);
  };

  const create = () => {
    const clean = name.trim();
    if (!clean) return;
    const id = addProfile({
      colorA: "#FF2A32",
      colorB: "#5c0810",
      icon: "user" as any,
      avatarUrl: draftAvatar,
      name: clean,
    } as any);
    const created = useProfileStore
      .getState()
      .profiles.find((item) => item.id === id);
    setCreating(false);
    if (created) activate(created);
  };

  const editing = profiles.find((p) => p.id === editId);
  const pendingDelete = profiles.find((p) => p.id === deleteId);
  const focused = profiles[Math.min(focus, profiles.length - 1)];

  const rise = (index: number) =>
    reduced ? undefined : ({ animationDelay: `${80 + index * 60}ms` } as const);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-black text-white">
      {/* ---- the artwork ---- */}
      {featured.item?.backdrop ? (
        <div className="pointer-events-none absolute inset-0">
          <img
            src={featured.item.backdrop}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          {/* the rail has to sit on something solid, the art keeps the right */}
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/85 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/40" />
          <div className="flux-vignette absolute inset-0" />
          {!reduced ? <div className="flux-grain" /> : null}
        </div>
      ) : null}

      <div className="relative z-10 flex min-h-screen">
        {/* ---- left: the rail ---- */}
        <div className="flex w-full max-w-[30rem] flex-col justify-center px-8 py-14 sm:px-14">
          <div
            className={classNames("mb-9", !reduced && "flux-rise")}
            style={rise(0)}
          >
            <img
              src="/flux-mark.webp"
              alt="Flux"
              className="mb-3 h-9 w-9 drop-shadow-lg"
            />
            <p className="text-lg font-medium tracking-tight text-white/85">
              Choose a profile
            </p>
          </div>

          <div className="flex flex-col gap-3.5">
            {profiles.map((profile, index) => {
              const isFocused = focus === index;
              return (
                <div key={profile.id} className="flex items-center gap-4">
                  <button
                    type="button"
                    aria-label={`Edit ${profile.name}`}
                    onClick={() => {
                      setError(null);
                      setEditId(profile.id);
                    }}
                    className={classNames(
                      "grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-white/50 transition-all",
                      isFocused
                        ? "opacity-100 hover:bg-white/10 hover:text-white"
                        : "pointer-events-none opacity-0",
                    )}
                  >
                    <Icon icon={Icons.EDIT} className="text-sm" />
                  </button>

                  <button
                    type="button"
                    ref={(el) => {
                      tiles.current[index] = el;
                    }}
                    onFocus={() => setFocus(index)}
                    onMouseEnter={() => setFocus(index)}
                    onClick={() => activate(profile)}
                    className={classNames(
                      "group flex items-center gap-5 rounded-2xl outline-none",
                      !reduced && "flux-rise",
                    )}
                    style={rise(index + 1)}
                  >
                    <span
                      className={classNames(
                        "block overflow-hidden rounded-2xl bg-white/5 transition-all duration-300",
                        isFocused
                          ? "h-24 w-24 shadow-2xl ring-[3px] ring-white"
                          : "h-[4.5rem] w-[4.5rem] ring-1 ring-white/10",
                      )}
                    >
                      <img
                        src={avatarForProfile(profile)}
                        alt=""
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    </span>
                    <span
                      className={classNames(
                        "whitespace-nowrap text-2xl font-medium tracking-tight transition-all duration-300 sm:text-3xl",
                        isFocused
                          ? "translate-x-0 text-white opacity-100"
                          : "-translate-x-2 text-white/45 opacity-0",
                      )}
                    >
                      {profile.name}
                    </span>
                  </button>
                </div>
              );
            })}

            {/* ---- add ---- */}
            <div className="flex items-center gap-4">
              <span className="h-8 w-8 flex-shrink-0" />
              <button
                type="button"
                ref={(el) => {
                  tiles.current[profiles.length] = el;
                }}
                onFocus={() => setFocus(profiles.length)}
                onMouseEnter={() => setFocus(profiles.length)}
                onClick={openCreate}
                className={classNames(
                  "group flex items-center gap-5 rounded-2xl outline-none",
                  !reduced && "flux-rise",
                )}
                style={rise(profiles.length + 1)}
              >
                <span
                  className={classNames(
                    "grid place-items-center rounded-2xl border border-white/25 text-white/45 transition-all duration-300",
                    focus === profiles.length
                      ? "h-24 w-24 border-white text-white"
                      : "h-[4.5rem] w-[4.5rem]",
                  )}
                >
                  <span className="text-3xl font-light leading-none">+</span>
                </span>
                <span
                  className={classNames(
                    "whitespace-nowrap text-2xl font-medium tracking-tight transition-all duration-300 sm:text-3xl",
                    focus === profiles.length
                      ? "translate-x-0 text-white opacity-100"
                      : "-translate-x-2 opacity-0",
                  )}
                >
                  Add profile
                </span>
              </button>
            </div>
          </div>

          {focused ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setEditId(focused.id);
              }}
              className={classNames(
                "mt-12 self-start rounded-lg border border-white/20 px-5 py-2 text-sm font-medium text-white/60 transition-colors hover:border-white/45 hover:text-white",
                !reduced && "flux-rise",
              )}
              style={rise(profiles.length + 2)}
            >
              Manage profiles
            </button>
          ) : null}
        </div>

        {/* ---- right: what the artwork is ---- */}
        {featured.item ? (
          <div className="pointer-events-none hidden flex-1 items-end justify-end p-12 lg:flex xl:p-16">
            <div
              className={classNames(
                "max-w-md text-right",
                !reduced && "flux-rise",
              )}
              style={rise(3)}
            >
              {featured.logo ? (
                <img
                  src={featured.logo}
                  alt={featured.item.title}
                  className="ml-auto max-h-24 w-auto max-w-full object-contain drop-shadow-[0_6px_24px_rgba(0,0,0,0.6)]"
                />
              ) : (
                <h2 className="text-4xl font-semibold tracking-[-0.03em] drop-shadow-lg">
                  {featured.item.title}
                </h2>
              )}
              {featured.genres.length ? (
                <p className="mt-5 text-sm font-medium tracking-wide text-white/75">
                  {featured.genres.join("  •  ")}
                </p>
              ) : null}
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-white/45">
                {featured.item.type === "show" ? "Series" : "Film"}
                {featured.item.year ? ` · ${featured.item.year}` : ""}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {/* ---- create ---- */}
      {creating ? (
        <Shell onClose={() => setCreating(false)} label="Create a profile">
          <h2 className="text-2xl font-semibold tracking-tight">
            Create a profile
          </h2>
          <p className="mt-2 text-sm text-white/50">
            Its own history, list and recommendations.
          </p>

          <div className="mt-6 flex items-center gap-5">
            <img
              src={draftAvatar}
              alt=""
              className="h-20 w-20 flex-shrink-0 rounded-2xl object-cover ring-1 ring-white/10"
            />
            <div className="min-w-0 flex-1">
              <label
                htmlFor="flux-new-profile"
                className="text-xs uppercase tracking-[0.18em] text-white/40"
              >
                Profile name
              </label>
              <input
                id="flux-new-profile"
                value={name}
                autoFocus
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") create();
                }}
                placeholder="Who is this?"
                className="mt-2 w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-white outline-none transition-colors focus:border-[#FF2A32]"
              />
            </div>
          </div>

          <AvatarPicker
            value={draftAvatar}
            onPick={setDraftAvatar}
            onError={setError}
          />
          {error ? (
            <p className="mt-3 text-sm text-[#ff8b90]">{error}</p>
          ) : null}

          <div className="mt-7 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium transition-colors hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!name.trim()}
              onClick={create}
              className="rounded-xl bg-[#FF2A32] px-5 py-2.5 text-sm font-semibold shadow-[0_8px_28px_rgba(255,42,50,.35)] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </Shell>
      ) : null}

      {/* ---- edit ---- */}
      {editing ? (
        <Shell onClose={() => setEditId(null)} label="Edit profile">
          <h2 className="text-2xl font-semibold tracking-tight">
            Edit profile
          </h2>

          <div className="mt-6 flex items-center gap-5">
            <img
              src={avatarForProfile(editing)}
              alt=""
              className="h-20 w-20 flex-shrink-0 rounded-2xl object-cover ring-1 ring-white/10"
            />
            <div className="min-w-0 flex-1">
              <label
                htmlFor="flux-edit-profile"
                className="text-xs uppercase tracking-[0.18em] text-white/40"
              >
                Profile name
              </label>
              <input
                id="flux-edit-profile"
                defaultValue={editing.name}
                maxLength={24}
                onChange={(e) => renameProfile(editing.id, e.target.value)}
                className="mt-2 w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-white outline-none transition-colors focus:border-[#FF2A32]"
              />
            </div>
          </div>

          <AvatarPicker
            value={avatarForProfile(editing)}
            onPick={(url) => setAvatar(editing.id, { avatarUrl: url } as any)}
            onError={setError}
          />
          {error ? (
            <p className="mt-3 text-sm text-[#ff8b90]">{error}</p>
          ) : null}

          <div className="mt-7 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setEditId(null);
                setDeleteId(editing.id);
              }}
              className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-white/60 transition-colors hover:border-[#d91927] hover:text-[#ff8b90]"
            >
              Delete profile
            </button>
            <button
              type="button"
              onClick={() => setEditId(null)}
              className="rounded-xl bg-[#FF2A32] px-5 py-2.5 text-sm font-semibold transition-transform hover:-translate-y-0.5"
            >
              Done
            </button>
          </div>
        </Shell>
      ) : null}

      {/* ---- delete ---- */}
      {pendingDelete ? (
        <Shell onClose={() => setDeleteId(null)} label="Delete profile">
          <h2 className="text-2xl font-semibold tracking-tight">
            Delete {pendingDelete.name}?
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/55">
            Their history, list and recommendations are removed from this
            device. This cannot be undone.
          </p>
          <div className="mt-7 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setDeleteId(null)}
              className="rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium transition-colors hover:bg-white/10"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() => {
                removeProfile(pendingDelete.id);
                setDeleteId(null);
                setFocus(0);
              }}
              className="rounded-xl bg-[#d91927] px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-[#f12432]"
            >
              Delete permanently
            </button>
          </div>
        </Shell>
      ) : null}
    </div>
  );
}
