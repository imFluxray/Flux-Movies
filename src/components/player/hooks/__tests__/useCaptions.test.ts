import { describe, expect, it } from "vitest";

import { findCaptionForLanguage } from "@/components/player/hooks/useCaptions";
import { CaptionListItem } from "@/stores/player/slices/source";

const caption = (id: string, language: string): CaptionListItem => ({
  id,
  language,
  url: `https://example.com/${id}.vtt`,
  needsProxy: false,
});

describe("findCaptionForLanguage", () => {
  it("prefers an exact locale match", () => {
    const captions = [caption("generic", "en"), caption("us", "en-US")];
    expect(findCaptionForLanguage(captions, "en-US")?.id).toBe("us");
  });

  it("matches two-letter, three-letter, and regional language codes", () => {
    const captions = [caption("english", "eng")];
    expect(findCaptionForLanguage(captions, "en-US")?.id).toBe("english");
  });
});
