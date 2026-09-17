import { RunOutput } from "@movie-web/providers";
import DOMPurify from "dompurify";
import { convert, detect, parse } from "subsrt-ts";
import { ContentCaption } from "subsrt-ts/dist/types/handler";

import { CaptionListItem } from "@/stores/player/slices/source";

export type CaptionCueType = ContentCaption;
export const sanitize = DOMPurify.sanitize;

export function captionIsVisible(
  start: number,
  end: number,
  delay: number,
  currentTime: number,
) {
  const delayedStart = start / 1000 + delay;
  const delayedEnd = end / 1000 + delay;
  return (
    Math.max(0, delayedStart) <= currentTime &&
    Math.max(0, delayedEnd) >= currentTime
  );
}

export function makeQueId(index: number, start: number, end: number): string {
  return `${index}-${start}-${end}`;
}

/*
 * ASS/SSA - most anime subtitles - are not plain text. Lines carry override
 * blocks like {\an8\fad(200,0)}, hard line breaks as \N, hard spaces as \h,
 * and whole vector drawings (\p1 ... \p0) for on-screen signs. subsrt-ts
 * keeps all of that inside the cue text, which is how raw tags ended up on
 * screen. This keeps only what a viewer should read and hands clean SRT on to
 * the normal pipeline.
 */
const ASS_DEFAULT_FIELDS = [
  "layer",
  "start",
  "end",
  "style",
  "name",
  "marginl",
  "marginr",
  "marginv",
  "effect",
  "text",
];

function isAssSubtitles(text: string): boolean {
  const format = detect(text);
  return format === "ass" || format === "ssa";
}

/** "0:01:02.35" (centiseconds) to milliseconds. */
function assTimeToMs(value: string | undefined): number | null {
  const match = /^(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,3})$/.exec(
    (value ?? "").trim(),
  );
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  return (
    Number(hours) * 3600000 +
    Number(minutes) * 60000 +
    Number(seconds) * 1000 +
    Number(fraction.padEnd(3, "0").slice(0, 3))
  );
}

function msToSrtTime(ms: number): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(ms % 1000, 3)}`;
}

/** The text field may itself contain commas, so split on the leading ones only. */
function splitAssFields(body: string, count: number): string[] {
  const parts: string[] = [];
  let rest = body;
  while (parts.length < count - 1) {
    const comma = rest.indexOf(",");
    if (comma < 0) break;
    parts.push(rest.slice(0, comma));
    rest = rest.slice(comma + 1);
  }
  parts.push(rest);
  return parts;
}

function cleanAssText(raw: string): string | null {
  // \p1 and up switch to drawing mode: the "text" is vector shapes, not words
  if (/\{[^}]*\\p[1-9]/.test(raw)) return null;
  const text = raw
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, " ")
    .replace(/\\h/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return text || null;
}

export function assToSrt(text: string): string {
  let fields = ASS_DEFAULT_FIELDS;
  const cues: { start: number; end: number; text: string }[] = [];

  text.split(/\r?\n/).forEach((line) => {
    // the [Events] Format line says which field holds what
    if (/^Format:/i.test(line) && /\btext\b/i.test(line)) {
      fields = line
        .slice(line.indexOf(":") + 1)
        .split(",")
        .map((field) => field.trim().toLowerCase());
      return;
    }
    if (!/^Dialogue:/i.test(line)) return;
    const values = splitAssFields(
      line.slice(line.indexOf(":") + 1),
      fields.length,
    );
    const field = (name: string) => values[fields.indexOf(name)];
    const start = assTimeToMs(field("start"));
    const end = assTimeToMs(field("end"));
    const cleaned = cleanAssText(field("text") ?? "");
    if (start === null || end === null || end <= start || !cleaned) return;
    cues.push({ start, end, text: cleaned });
  });

  // styled duplicates (outlines, shadows, karaoke layers) repeat the same line
  const seen = new Set<string>();
  return cues
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .filter((cue) => {
      const key = `${cue.start}|${cue.end}|${cue.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(
      (cue, index) =>
        `${index + 1}\n${msToSrtTime(cue.start)} --> ${msToSrtTime(cue.end)}\n${cue.text}`,
    )
    .join("\n\n");
}

/** Plain subtitle text for subsrt-ts, with ASS styling already removed. */
function readableSubtitles(text: string): string {
  return isAssSubtitles(text) ? assToSrt(text) : text;
}

export function convertSubtitlesToVtt(text: string): string {
  const textTrimmed = text.trim();
  if (textTrimmed === "") {
    throw new Error("Given text is empty");
  }
  const vtt = convert(readableSubtitles(textTrimmed), "vtt");
  if (detect(vtt) === "") {
    throw new Error("Invalid subtitle format");
  }
  return vtt;
}

export function convertSubtitlesToSrt(text: string): string {
  const textTrimmed = text.trim();
  if (textTrimmed === "") {
    throw new Error("Given text is empty");
  }
  const srt = convert(readableSubtitles(textTrimmed), "srt");
  if (detect(srt) === "") {
    throw new Error("Invalid subtitle format");
  }
  return srt;
}

export function filterDuplicateCaptionCues(cues: ContentCaption[]) {
  return cues.reduce((acc: ContentCaption[], cap: ContentCaption) => {
    const lastCap = acc[acc.length - 1];
    const isSameAsLast =
      lastCap?.start === cap.start &&
      lastCap?.end === cap.end &&
      lastCap?.content === cap.content;
    if (lastCap === undefined || !isSameAsLast) {
      acc.push(cap);
    }
    return acc;
  }, []);
}

export function parseVttSubtitles(vtt: string) {
  return parse(vtt).filter((cue) => cue.type === "caption") as CaptionCueType[];
}

export function parseSubtitles(
  text: string,
  _language?: string,
): CaptionCueType[] {
  const vtt = convertSubtitlesToVtt(text);
  return parseVttSubtitles(vtt);
}

function stringToBase64(input: string): string {
  return btoa(String.fromCodePoint(...new TextEncoder().encode(input)));
}

export function convertSubtitlesToSrtDataurl(text: string): string {
  return `data:application/x-subrip;base64,${stringToBase64(
    convertSubtitlesToSrt(text),
  )}`;
}

export function convertSubtitlesToObjectUrl(text: string): string {
  return URL.createObjectURL(
    new Blob([convertSubtitlesToVtt(text)], {
      type: "text/vtt",
    }),
  );
}

export function convertProviderCaption(
  captions: RunOutput["stream"]["captions"],
): CaptionListItem[] {
  return (captions ?? []).map((v) => ({
    id: v.id,
    language: v.language,
    url: v.url,
    needsProxy: v.hasCorsRestrictions,
    opensubtitles: v.opensubtitles,
  }));
}
