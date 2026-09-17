import { describe, expect, it } from "vitest";

import {
  assToSrt,
  convertSubtitlesToSrt,
} from "@/components/player/utils/captions";

// the shape anime subtitles arrive in: override tags, hard breaks, a sign
// drawn as vector shapes, commas inside the text, and a duplicated styled line
const SAMPLE = `[Script Info]
Title: Sample
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\an8\\fad(200,0)}Hello there
Dialogue: 0,0:00:04.00,0:00:06.25,Default,,0,0,0,,First line\\NSecond, with a comma
Dialogue: 0,0:00:04.00,0:00:06.25,Default,,0,0,0,,First line\\NSecond, with a comma
Dialogue: 1,0:00:07.00,0:00:08.00,Sign,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}
Dialogue: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,No\\hbreak`;

describe("assToSrt", () => {
  it("keeps only the text a viewer should read", () => {
    const srt = assToSrt(SAMPLE);
    expect(srt).not.toContain("{");
    expect(srt).not.toContain("\\N");
    expect(srt).not.toContain("\\h");
    expect(srt).toContain("Hello there");
    expect(srt).toContain("First line\nSecond, with a comma");
    expect(srt).toContain("No break");
  });

  it("drops vector drawings and styled duplicates", () => {
    const srt = assToSrt(SAMPLE);
    expect(srt).not.toContain("m 0 0");
    expect(srt.match(/First line/g)).toHaveLength(1);
  });

  it("converts ASS centisecond timings to SRT", () => {
    expect(assToSrt(SAMPLE)).toContain("00:00:01,500 --> 00:00:03,000");
    expect(assToSrt(SAMPLE)).toContain("00:00:04,000 --> 00:00:06,250");
  });

  it("is what the normal SRT conversion now uses for ASS input", () => {
    const srt = convertSubtitlesToSrt(SAMPLE);
    expect(srt).toContain("Hello there");
    expect(srt).not.toContain("an8");
  });
});
