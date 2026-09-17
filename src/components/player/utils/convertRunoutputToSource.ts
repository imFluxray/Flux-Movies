import { Stream } from "@movie-web/providers";

import {
  SourceFileStream,
  SourceQuality,
  SourceSliceSource,
} from "@/stores/player/utils/qualities";

const allowedQualitiesMap: Record<SourceQuality, SourceQuality> = {
  "4k": "4k",
  "1080": "1080",
  "480": "480",
  "360": "360",
  "720": "720",
  unknown: "unknown",
};
const allowedQualities = Object.keys(allowedQualitiesMap);
const allowedFileTypes = ["mp4"];

function isAllowedQuality(inp: string): inp is SourceQuality {
  return allowedQualities.includes(inp);
}

/** Where a stream actually plays from, whatever shape it came in. */
function streamLocator(stream: any): string | undefined {
  return (
    stream?.embedUrl ??
    stream?.playlist ??
    (Object.values(stream?.qualities ?? {})[0] as any)?.url
  );
}

/*
 * Which audio variant is playing. A stream that names its variant is taken at
 * its word; one that does not is matched to the variant sharing its stream.
 * Falling back to the first variant instead is what labelled Japanese audio
 * as English - dub is always listed first.
 */
function playingVariantId(
  stream: Stream,
  variants: Array<{ id: string; stream: Stream }>,
): string {
  const named = (stream as any).fluxAudioVariantId;
  if (named) return String(named);
  const own = streamLocator(stream);
  const match = own
    ? variants.find((variant) => streamLocator(variant.stream) === own)
    : undefined;
  return String((match ?? variants[0]).id);
}

export function convertRunoutputToSource(out: {
  stream: Stream;
}): SourceSliceSource {
  const rawVariants = (out.stream as any).fluxAudioVariants as
    | Array<{ id: string; label: string; language: string; stream: Stream }>
    | undefined;
  const skips = (out.stream as any).fluxSkips as
    | SourceSliceSource["skips"]
    | undefined;
  const variantExtras = rawVariants?.length
    ? {
        audioVariantId: playingVariantId(out.stream, rawVariants),
        audioVariants: rawVariants.map((variant) => ({
          id: variant.id,
          label: variant.label,
          language: variant.language,
          source: convertRunoutputToSource({ stream: variant.stream }),
          captions: (variant.stream.captions ?? []).map((caption) => ({
            id: caption.id,
            language: caption.language,
            url: caption.url,
            needsProxy: caption.hasCorsRestrictions,
            opensubtitles: caption.opensubtitles,
          })),
        })),
      }
    : {};
  const extras = { ...variantExtras, ...(skips ? { skips } : {}) };
  const embedUrl = (out.stream as any).embedUrl as string | undefined;
  if ((out.stream as any).type === "embed" && embedUrl) {
    return { type: "embed", url: embedUrl, ...extras };
  }
  if (out.stream.type === "hls") {
    return {
      type: "hls",
      url: out.stream.playlist,
      headers: out.stream.headers,
      preferredHeaders: out.stream.preferredHeaders,
      ...extras,
    };
  }
  if (out.stream.type === "file") {
    const qualities: Partial<Record<SourceQuality, SourceFileStream>> = {};
    Object.entries(out.stream.qualities).forEach((entry) => {
      if (!isAllowedQuality(entry[0])) {
        console.warn(`unrecognized quality: ${entry[0]}`);
        return;
      }
      if (!allowedFileTypes.includes(entry[1].type)) {
        console.warn(`unrecognized file type: ${entry[1].type}`);
        return;
      }
      qualities[entry[0]] = {
        type: entry[1].type,
        url: entry[1].url,
      };
    });
    return {
      type: "file",
      qualities,
      headers: out.stream.headers,
      preferredHeaders: out.stream.preferredHeaders,
      ...extras,
    };
  }
  throw new Error("unrecognized type");
}
