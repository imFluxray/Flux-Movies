export type AnimeAudioId = "dub" | "sub";

const KEY = "flux.preferredAnimeAudio";

export function getPreferredAnimeAudio(): AnimeAudioId {
  try {
    return window.localStorage.getItem(KEY) === "sub" ? "sub" : "dub";
  } catch {
    return "dub";
  }
}

export function setPreferredAnimeAudio(value: AnimeAudioId): void {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // Private browsing/storage restrictions should not block switching audio.
  }
}
