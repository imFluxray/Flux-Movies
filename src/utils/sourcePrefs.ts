/*
 * Per-browser source preferences.
 *
 * A source blocked on a school network works fine at home, so nothing here
 * ever deletes a provider - it only stops us asking. Kept in localStorage
 * rather than the account, because "which sources reach me" is a property of
 * the network you are sitting on, not of who you are.
 */

const DISABLED_KEY = "flux-disabled-sources";
const ORDER_KEY = "flux-source-order";

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v) => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function writeList(key: string, value: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // a private window with storage denied is not a reason to break playback
  }
}

export function getDisabledSources(): string[] {
  return readList(DISABLED_KEY);
}

export function isSourceDisabled(id: string): boolean {
  return getDisabledSources().includes(id);
}

export function setSourceDisabled(id: string, disabled: boolean): void {
  const current = getDisabledSources().filter((v) => v !== id);
  if (disabled) current.push(id);
  writeList(DISABLED_KEY, current);
}

export function getSourceOrder(): string[] {
  return readList(ORDER_KEY);
}

export function setSourceOrder(ids: string[]): void {
  writeList(ORDER_KEY, ids);
}

/**
 * Apply the viewer's order, then their disabled list.
 *
 * Anything not named in the stored order keeps its configured position after
 * the ones that are, so a provider added to providers.json later still shows
 * up without the viewer having to touch anything.
 */
export function applySourcePrefs<T extends { id: string }>(
  providers: T[],
): T[] {
  const order = getSourceOrder();
  const disabled = new Set(getDisabledSources());
  const rank = new Map(order.map((id, i) => [id, i]));
  return providers
    .filter((p) => !disabled.has(p.id))
    .slice()
    .sort((a, b) => {
      const ra = rank.has(a.id)
        ? (rank.get(a.id) as number)
        : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.id)
        ? (rank.get(b.id) as number)
        : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
}
