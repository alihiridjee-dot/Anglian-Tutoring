import { describe, expect, test } from "bun:test";
import { parseVideoUrl } from "./videoEmbed";

const embed = (url: string) => parseVideoUrl(url)?.embedUrl ?? null;
const YT = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";

describe("YouTube", () => {
  test("a plain watch link embeds exactly as before", () => {
    // Every video in production is this shape, so its embed must not move.
    expect(embed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      `${YT}?rel=0&modestbranding=1`,
    );
  });

  test("youtu.be, shorts and embed links find the id", () => {
    for (const url of [
      "https://youtu.be/dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=abc123",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ]) {
      expect(embed(url)).toBe(`${YT}?rel=0&modestbranding=1`);
    }
  });

  test("a start time carries through, in every form YouTube writes it", () => {
    for (const [url, start] of [
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90", 90],
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s", 90],
      ["https://youtu.be/dQw4w9WgXcQ?t=1m30s", 90],
      ["https://youtu.be/dQw4w9WgXcQ?t=1h2m3s", 3723],
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=45", 45],
      ["https://www.youtube.com/embed/dQw4w9WgXcQ?start=30", 30],
    ] as const) {
      expect(embed(url)).toBe(`${YT}?rel=0&modestbranding=1&start=${start}`);
    }
  });

  test("a playlist carries through", () => {
    expect(
      embed(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG&t=10s",
      ),
    ).toBe(`${YT}?rel=0&modestbranding=1&start=10&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG`);
  });

  test("a start of zero or nonsense is left out", () => {
    expect(embed("https://youtu.be/dQw4w9WgXcQ?t=0")).toBe(`${YT}?rel=0&modestbranding=1`);
    expect(embed("https://youtu.be/dQw4w9WgXcQ?t=soon")).toBe(`${YT}?rel=0&modestbranding=1`);
  });

  test("a playlist id with odd characters can't add parameters", () => {
    expect(embed("https://youtu.be/dQw4w9WgXcQ?list=PL1%26autoplay%3D1")).toBe(
      `${YT}?rel=0&modestbranding=1`,
    );
  });
});

describe("Vimeo", () => {
  test("a public video embeds by id", () => {
    expect(embed("https://vimeo.com/123456789")).toBe("https://player.vimeo.com/video/123456789");
    expect(embed("https://player.vimeo.com/video/123456789")).toBe(
      "https://player.vimeo.com/video/123456789",
    );
  });

  test("an unlisted video keeps its hash", () => {
    expect(embed("https://vimeo.com/123456789/abcdef1234")).toBe(
      "https://player.vimeo.com/video/123456789?h=abcdef1234",
    );
    expect(embed("https://player.vimeo.com/video/123456789?h=abcdef1234&badge=0")).toBe(
      "https://player.vimeo.com/video/123456789?h=abcdef1234",
    );
  });

  test("a video inside a showcase, album, group or channel embeds the video, not the collection", () => {
    for (const url of [
      "https://vimeo.com/showcase/7654321/video/123456789",
      "https://vimeo.com/album/7654321/video/123456789",
      "https://vimeo.com/groups/physics/videos/123456789",
      "https://vimeo.com/channels/staffpicks/123456789",
      "https://vimeo.com/channels/7654321/123456789",
    ]) {
      expect(embed(url)).toBe("https://player.vimeo.com/video/123456789");
    }
  });

  test("a link that isn't one video falls back to opening the link", () => {
    for (const url of ["https://vimeo.com/showcase/7654321", "https://vimeo.com/user12345"]) {
      const parsed = parseVideoUrl(url);
      expect(parsed?.provider).toBe("other");
      expect(parsed?.embedUrl).toBeNull();
      expect(parsed?.originalUrl).toBe(url);
    }
  });
});

describe("embed hosts", () => {
  test("only youtube-nocookie.com and player.vimeo.com are ever embedded", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90&list=PLabc",
      "https://vimeo.com/123456789/abcdef1234",
      "https://vimeo.com/showcase/7654321/video/123456789",
    ]) {
      expect(new URL(embed(url)!).host).toMatch(
        /^(www\.youtube-nocookie\.com|player\.vimeo\.com)$/,
      );
    }
  });
});
