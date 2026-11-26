import { describe, expect, test } from "bun:test";

import { newestSegmentPlaylist } from "./captureFrame";
import { CameraOffline } from "./snapshotQueue";

const BASE = "http://localhost:1337/api/stream/42.m3u8";

const live = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:28256
#EXTINF:2.000000,
42_0p28256.ts
#EXTINF:2.000000,
42_0p28257.ts
#EXTINF:0.280000,
42_0p28258.ts
`;

describe("newestSegmentPlaylist", () => {
  test("keeps only the newest whole segment, through the proxy, as an ended playlist", () => {
    expect(newestSegmentPlaylist(live, BASE)).toEqual({
      ended: false,
      playlist: [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:2",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXTINF:2,",
        "http://localhost:1337/api/stream/42_0p28257.ts",
        "#EXT-X-ENDLIST",
        "",
      ].join("\n"),
    });
  });

  test("falls back to a short segment when it is the only one", () => {
    const short = "#EXTM3U\n#EXTINF:0.5,\n42_0p1.ts\n";
    expect(newestSegmentPlaylist(short, BASE).playlist).toContain(
      "/api/stream/42_0p1.ts",
    );
  });

  test("keeps the last segment of a stream that has ended, and says it ended", () => {
    const ended = newestSegmentPlaylist(`${live}#EXT-X-ENDLIST\n`, BASE);
    expect(ended.ended).toBe(true);
    expect(ended.playlist).toContain("/api/stream/42_0p28257.ts");
  });

  test("refuses a playlist with no segment as offline", () => {
    expect(() => newestSegmentPlaylist("#EXTM3U\n", BASE)).toThrow(
      CameraOffline,
    );
  });
});
