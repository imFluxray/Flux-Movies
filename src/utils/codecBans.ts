/*
 * Mirrors this browser has proven it cannot decode.
 *
 * A playlist can advertise one codec and deliver another (anidbapp declares
 * mp4a.40.29 and ships AAC Main), so no amount of inspecting manifests catches
 * every case. The one authority that is never wrong is the browser itself:
 * when hls.js fails addSourceBuffer, that mirror is finished for this device.
 *
 * Remembering it means a bad mirror costs one failure ever, instead of one
 * failure every time - and it works no matter which resolve path chose it.
 */

const KEY = "flux.codecBans";
const MAX = 40;

function read(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function write(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* private mode: bans just will not persist */
  }
}

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Hosts to blame for a proxied fragment: its referer, and its real origin. */
export function hostsFromProxiedUrl(url: string | null | undefined): string[] {
  const hosts = new Set<string>();
  if (!url) return [];
  try {
    const parsed = new URL(url, window.location.href);
    const destination = parsed.searchParams.get("destination");
    const destinationHost = hostOf(destination);
    if (destinationHost) hosts.add(destinationHost);

    const headers = parsed.searchParams.get("headers");
    if (headers) {
      const parsedHeaders = JSON.parse(headers);
      const refererHost = hostOf(
        parsedHeaders?.Referer ?? parsedHeaders?.referer,
      );
      if (refererHost) hosts.add(refererHost);
    }
  } catch {
    /* not a proxied url we understand */
  }
  return [...hosts];
}

export function isCodecBanned(
  ...hosts: (string | null | undefined)[]
): boolean {
  const banned = read();
  if (!banned.length) return false;
  return hosts.some((host) => {
    const normalised = host ? host.toLowerCase() : null;
    return !!normalised && banned.includes(normalised);
  });
}

/** Ban every host implicated by a fragment the browser refused to decode. */
export function banCodecFromUrl(url: string | null | undefined): string[] {
  const hosts = hostsFromProxiedUrl(url);
  if (!hosts.length) return [];
  const banned = read();
  const added: string[] = [];
  hosts.forEach((host) => {
    if (!banned.includes(host)) {
      banned.push(host);
      added.push(host);
    }
  });
  if (added.length) write(banned);
  return added;
}

export function refererHostOfStream(stream: any): string | null {
  return hostOf(stream?.headers?.Referer ?? stream?.headers?.referer);
}
