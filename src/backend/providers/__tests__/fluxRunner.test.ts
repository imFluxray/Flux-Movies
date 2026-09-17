import { describe, expect, it } from "vitest";

import { normaliseStreams } from "@/backend/providers/fluxRunner";

/*
 * The aggregator's exact JSON shape is not fixed, so these lock in the shapes
 * it is plausibly returning. If the real payload differs, add it here first -
 * a failing case here is much cheaper to read than a blank player.
 */

const M3U8 = "https://example.com/a/index.m3u8";
const MP4_1080 = "https://example.com/a/1080.mp4";
const MP4_720 = "https://example.com/a/720.mp4";

describe("normaliseStreams", () => {
  it("bare array of mp4s merges into one stream with a quality ladder", () => {
    const { streams, count } = normaliseStreams([
      { url: MP4_1080, quality: "1080" },
      { url: MP4_720, quality: "720" },
    ]);
    expect(count).toBe(2);
    expect(streams).toHaveLength(1);
    expect(streams[0].type).toBe("file");
    expect(Object.keys((streams[0] as any).qualities).sort()).toEqual([
      "1080",
      "720",
    ]);
    expect((streams[0] as any).qualities["1080"].url).toBe(MP4_1080);
  });

  it("unwraps a { streams: [...] } envelope", () => {
    const { streams } = normaliseStreams({
      streams: [{ file: MP4_1080, res: 1080 }],
    });
    expect(streams).toHaveLength(1);
    expect((streams[0] as any).qualities["1080"].url).toBe(MP4_1080);
  });

  it("unwraps { success, data: [...] }", () => {
    const { streams } = normaliseStreams({
      success: true,
      data: [{ link: M3U8, type: "hls" }],
    });
    expect(streams[0].type).toBe("hls");
    expect((streams[0] as any).playlist).toBe(M3U8);
  });

  it("detects hls from the url when no type is given", () => {
    const { streams } = normaliseStreams([{ url: M3U8 }]);
    expect(streams[0].type).toBe("hls");
  });

  it("keeps several playlists separate, in the given order", () => {
    const { streams, count } = normaliseStreams([
      { url: M3U8, name: "server 3" },
      { url: "https://example.com/b/index.m3u8", name: "server 4" },
    ]);
    expect(count).toBe(2);
    expect(streams).toHaveLength(2);
    expect((streams[0] as any).playlist).toBe(M3U8);
  });

  it("maps odd quality labels onto the player's ladder", () => {
    const { streams } = normaliseStreams([
      { url: "https://example.com/x/4k.mp4", quality: "2160p" },
      { url: MP4_1080, quality: "FHD" },
    ]);
    expect(Object.keys((streams[0] as any).qualities).sort()).toEqual([
      "1080",
      "4k",
    ]);
  });

  it("carries captions and headers through", () => {
    const { streams } = normaliseStreams({
      streams: [
        {
          url: MP4_1080,
          quality: 1080,
          headers: { Referer: "https://example.com" },
          subtitles: [{ url: "https://example.com/s.vtt", language: "en" }],
        },
      ],
    });
    expect((streams[0] as any).headers.Referer).toBe("https://example.com");
    expect(streams[0].captions).toHaveLength(1);
    expect(streams[0].captions[0].language).toBe("en");
    expect(streams[0].captions[0].type).toBe("vtt");
  });

  it("merges response headers and a stream referer for the relay", () => {
    const { streams } = normaliseStreams({
      headers: { "User-Agent": "anime-client" },
      streams: [{ url: M3U8, referer: "https://anime.example/" }],
    });
    expect((streams[0] as any).headers).toEqual({
      "User-Agent": "anime-client",
      Referer: "https://anime.example/",
    });
  });

  it("does not lose a second unlabelled file to key collision", () => {
    const { streams, count } = normaliseStreams([
      { url: MP4_1080 },
      { url: MP4_720 },
    ]);
    expect(count).toBe(2);
    expect(Object.keys((streams[0] as any).qualities).length).toBeGreaterThan(
      0,
    );
  });

  it("reports an empty payload rather than throwing", () => {
    expect(normaliseStreams({ streams: [] })).toEqual({
      streams: [],
      count: 0,
    });
    expect(normaliseStreams(null)).toEqual({ streams: [], count: 0 });
    expect(normaliseStreams({ error: "nothing found" })).toEqual({
      streams: [],
      count: 0,
    });
  });

  it("does not mislabel an HTML embed page as a video file", () => {
    expect(
      normaliseStreams([
        { url: "https://example.com/embed/episode-1", type: "embed" },
      ]),
    ).toEqual({ streams: [], count: 0 });
    expect(
      normaliseStreams([
        { url: "https://example.com/player/episode-1", type: "player" },
      ]),
    ).toEqual({ streams: [], count: 0 });
  });
});

describe("cinepro envelope", () => {
  // shape confirmed live from cinepro-core: sources[] alongside a shared
  // subtitles[], which is why captions are hoisted from the envelope
  const payload = {
    responseId: "68c0df38-6328-4ba6-bad3-c899085b9944",
    expiresAt: "2026-08-28T00:24:58.729Z",
    sources: [
      {
        url: MP4_1080,
        type: "mp4",
        quality: "1080p",
        audioTracks: [{ language: "org", label: "Original" }],
        provider: { id: "fsharetv", name: "FshareTV" },
      },
      {
        url: MP4_720,
        type: "mp4",
        quality: "720p",
        audioTracks: [{ language: "org", label: "Original" }],
        provider: { id: "showsst", name: "ShowsST Fallbacks" },
      },
    ],
    subtitles: [
      { url: "https://example.com/pt.vtt", label: "Brazilian3", format: "vtt" },
      { url: "https://example.com/en.srt", label: "English", format: "srt" },
    ],
    diagnostics: [],
  };

  it("merges the sources into one quality ladder", () => {
    const { streams, count } = normaliseStreams(payload);
    expect(count).toBe(2);
    expect(streams).toHaveLength(1);
    expect(streams[0].type).toBe("file");
    expect(Object.keys((streams[0] as any).qualities).sort()).toEqual([
      "1080",
      "720",
    ]);
  });

  it("keeps the shared subtitles that sit outside the sources", () => {
    const { streams } = normaliseStreams(payload);
    expect(streams[0].captions).toHaveLength(2);
    expect(streams[0].captions[0].language).toBe("Brazilian3");
  });

  it("honours the declared subtitle format over the file extension", () => {
    const { streams } = normaliseStreams(payload);
    expect(streams[0].captions[0].type).toBe("vtt");
    expect(streams[0].captions[1].type).toBe("srt");
  });
});
