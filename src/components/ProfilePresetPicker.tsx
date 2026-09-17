import classNames from "classnames";

import { Avatar } from "@/components/Avatar";
import { UserIcons } from "@/components/UserIcon";

export interface ProfilePreset {
  avatarUrl?: string;
  colorA: string;
  colorB: string;
  icon: UserIcons;
  name: string;
}

const AVATAR_PALETTES = [
  ["#ff5f6d", "#7a102c", "#ffe1b8"],
  ["#7c63ff", "#211251", "#f6c7a8"],
  ["#12c2a3", "#064e55", "#ffe0c2"],
  ["#ff9a3c", "#7b2647", "#7a3d25"],
  ["#f34fc8", "#4a238f", "#8e4f32"],
  ["#35a7ff", "#073a75", "#f4c9a4"],
] as const;

/** Self-contained portraits: no external request, CSP issue, or broken image. */
function localPortrait(seed: string, index: number): string {
  const [a, b, skin] = AVATAR_PALETTES[index % AVATAR_PALETTES.length];
  const hair =
    index % 3 === 0 ? "#17131f" : index % 3 === 1 ? "#5b2f23" : "#f3d36a";
  const glasses =
    index % 4 === 0
      ? `<path d="M25 43h14m10 0h14M39 43h10" stroke="#171717" stroke-width="3"/><rect x="21" y="37" width="20" height="14" rx="6" fill="none" stroke="#171717" stroke-width="3"/><rect x="47" y="37" width="20" height="14" rx="6" fill="none" stroke="#171717" stroke-width="3"/>`
      : "";
  const accessory =
    index % 5 === 0
      ? `<path d="M19 28 9 13l22 8M69 28l10-15-22 8" fill="${hair}"/>`
      : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="88" height="88" rx="20" fill="url(#g)"/><circle cx="44" cy="47" r="27" fill="${skin}"/>${accessory}<path d="M17 39c2-21 13-29 27-29s26 9 28 29c-8-7-14-9-19-16-6 8-17 13-36 16Z" fill="${hair}"/><circle cx="34" cy="45" r="3" fill="#171717"/><circle cx="55" cy="45" r="3" fill="#171717"/>${glasses}<path d="M35 60c5 4 13 4 18 0" fill="none" stroke="#a34848" stroke-width="3" stroke-linecap="round"/><path d="M18 88c2-17 12-25 26-25s25 8 27 25" fill="${a}"/><text x="44" y="82" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="800" fill="white" opacity=".85">${seed.slice(0, 1).toUpperCase()}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const PROFILE_PRESETS: ProfilePreset[] = [
  {
    name: "Premiere",
    colorA: "#ff3b4d",
    colorB: "#730018",
    icon: UserIcons.TICKET,
  },
  {
    name: "Midnight",
    colorA: "#7457ff",
    colorB: "#160f44",
    icon: UserIcons.CAT,
  },
  { name: "Neon", colorA: "#00ddb3", colorB: "#003f54", icon: UserIcons.COUCH },
  {
    name: "Golden Hour",
    colorA: "#ffbe3d",
    colorB: "#d63a21",
    icon: UserIcons.TICKET,
  },
  {
    name: "Arcade",
    colorA: "#ff4fd8",
    colorB: "#4924c6",
    icon: UserIcons.MOBILE,
  },
  { name: "Ocean", colorA: "#21a9ff", colorB: "#06306f", icon: UserIcons.CAT },
  {
    name: "Afterparty",
    colorA: "#ca55ff",
    colorB: "#ff2f6d",
    icon: UserIcons.USER_GROUP,
  },
  {
    name: "Emerald",
    colorA: "#34d17b",
    colorB: "#07492e",
    icon: UserIcons.COUCH,
  },
  {
    name: "Solar",
    colorA: "#ff7a18",
    colorB: "#7b164c",
    icon: UserIcons.MOBILE,
  },
  {
    name: "Classic",
    colorA: "#b7c1cf",
    colorB: "#323946",
    icon: UserIcons.TICKET,
  },
  {
    name: "Cosmic",
    colorA: "#695cff",
    colorB: "#0c87a8",
    icon: UserIcons.USER_GROUP,
  },
  { name: "Rebel", colorA: "#ec344e", colorB: "#26101f", icon: UserIcons.WEED },
  ...[
    "Nova",
    "Mochi",
    "Pixel",
    "Comet",
    "Raven",
    "Juno",
    "Orbit",
    "Bowie",
  ].flatMap((seed, seedIndex) =>
    ["Director", "Dreamer", "Hero", "Critic", "Explorer"].map(
      (style, styleIndex) => ({
        avatarUrl: localPortrait(seed, seedIndex * 5 + styleIndex),
        colorA: ["#ff3b4d", "#7457ff", "#00a884", "#ec4899"][
          (seedIndex + styleIndex) % 4
        ],
        colorB: ["#5b0716", "#17114d", "#063b46", "#4a1230"][
          (seedIndex + styleIndex) % 4
        ],
        icon: UserIcons.TICKET,
        name: `${seed} ${style}`,
      }),
    ),
  ),
];

export function ProfilePresetPicker(props: {
  colorA: string;
  colorB: string;
  icon: UserIcons;
  avatarUrl?: string;
  onSelect: (preset: ProfilePreset) => void;
}) {
  return (
    <fieldset className="rounded-2xl border border-white/10 bg-black/20 p-3 sm:p-5">
      <legend className="px-2 text-sm font-semibold text-white/70">
        Choose a character
      </legend>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6">
        {PROFILE_PRESETS.map((preset) => {
          const selected =
            props.avatarUrl === preset.avatarUrl &&
            props.colorA === preset.colorA &&
            props.colorB === preset.colorB &&
            props.icon === preset.icon;
          return (
            <button
              key={preset.name}
              type="button"
              title={preset.name}
              aria-label={`${preset.name} profile picture`}
              aria-pressed={selected}
              onClick={() => props.onSelect(preset)}
              className={classNames(
                "group relative aspect-square overflow-hidden rounded-2xl p-1.5 transition duration-200 ease-out hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                selected
                  ? "bg-white shadow-[0_8px_28px_rgba(255,255,255,0.2)]"
                  : "bg-white/5 hover:bg-white/10",
              )}
            >
              <Avatar
                profile={preset}
                sizeClass="h-full w-full rounded-xl"
                iconClass="text-xl sm:text-2xl transition-transform duration-300 group-hover:scale-110"
              />
              {selected ? (
                <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-white text-xs font-black text-black shadow-lg">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
