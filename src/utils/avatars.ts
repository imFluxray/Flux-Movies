/*
 * Profile avatars.
 *
 * The alohe set, vendored into public/avatars rather than hotlinked from
 * jsDelivr: a CDN that a school network blocks would leave every profile
 * faceless, and 1.3MB of static PNGs served from our own origin costs nothing
 * at runtime.
 *
 * A profile just stores `avatarUrl` - either "/avatars/<id>.png" for one of
 * these, or a data: URL for an upload. That is the field <Avatar> already
 * renders, so the dropdown and settings pick it up unchanged.
 */

interface AvatarGroup {
  id: string;
  label: string;
  count: number;
}

export const AVATAR_GROUPS: AvatarGroup[] = [
  { id: "vibrent", label: "Vibrent", count: 27 },
  { id: "toon", label: "Toon", count: 10 },
  { id: "memo", label: "Memo", count: 35 },
  { id: "notion", label: "Notion", count: 15 },
  { id: "upstream", label: "Upstream", count: 22 },
  { id: "bluey", label: "Bluey", count: 10 },
  { id: "teams", label: "Teams", count: 9 },
  { id: "3d", label: "3D", count: 5 },
];

export const AVATAR_IDS: string[] = AVATAR_GROUPS.flatMap((group) =>
  Array.from({ length: group.count }, (_, i) => `${group.id}_${i + 1}`),
);

export function avatarUrl(id: string): string {
  return `/avatars/${id}.png`;
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    // stay inside a safe integer without bit twiddling
    h = (h * 31 + value.charCodeAt(i)) % 1000000007;
  }
  return h;
}

/** A stable avatar for something that has never picked one. */
export function defaultAvatarFor(seed: string): string {
  return avatarUrl(AVATAR_IDS[hash(seed) % AVATAR_IDS.length]);
}

export function avatarForProfile(profile: {
  id: string;
  avatarUrl?: string;
}): string {
  return profile.avatarUrl || defaultAvatarFor(profile.id);
}

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const STORED_SIZE = 256;

/**
 * Turn an uploaded file into a small square data URL.
 *
 * Downscaled on purpose: profiles live in localStorage, and dropping a 4MB
 * phone photo in there would blow the quota and take every profile with it.
 */
export function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("That file is not an image."));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      reject(new Error("That image is too large. Try one under 6MB."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image could not be opened."));
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = STORED_SIZE;
          canvas.height = STORED_SIZE;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Image processing is unavailable."));
            return;
          }
          // cover-crop to a square so portraits are not squashed
          const side = Math.min(img.width, img.height);
          ctx.drawImage(
            img,
            (img.width - side) / 2,
            (img.height - side) / 2,
            side,
            side,
            0,
            0,
            STORED_SIZE,
            STORED_SIZE,
          );
          resolve(canvas.toDataURL("image/webp", 0.85));
        } catch {
          reject(new Error("That image could not be processed."));
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
