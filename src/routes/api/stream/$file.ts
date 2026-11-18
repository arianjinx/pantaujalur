import { createFileRoute } from "@tanstack/react-router";

import {
  cctvFetch,
  cctvUnavailableResponse,
  SESSION_REJECTED,
  withCctvSession,
} from "#/server/cctv-session";

// A playlist is `{streamId}.m3u8`; its segments are relative names such as
// `{streamId}_0p0870.ts`, which hls.js resolves back through this route.
const STREAM_FILE = /^\d{1,40}(?:_[0-9p]{1,20})?\.(?:m3u8|ts)$/;

export const Route = createFileRoute("/api/stream/$file")({
  server: {
    handlers: {
      GET: ({ params }) =>
        streamFile(params.file).catch(cctvUnavailableResponse),
    },
  },
});

async function streamFile(file: string): Promise<Response> {
  if (!STREAM_FILE.test(file)) {
    return new Response("Invalid stream file name", { status: 400 });
  }
  const upstream = await withCctvSession(async (headers) => {
    const response = await cctvFetch(`/cctv-stream/streams/${file}`, {
      headers,
    });
    if (response.status !== 403) return response;
    await response.body?.cancel();
    return SESSION_REJECTED;
  });
  if (!upstream.ok) {
    await upstream.body?.cancel();
    const reason =
      upstream.status === 404 ? "Stream is offline" : "Upstream stream error";
    return new Response(reason, { status: upstream.status });
  }
  const isPlaylist = file.endsWith(".m3u8");
  const headers = new Headers({
    "Content-Type":
      upstream.headers.get("Content-Type") ??
      (isPlaylist ? "application/vnd.apple.mpegurl" : "video/mp2t"),
    "Cache-Control": isPlaylist ? "no-cache" : "public, max-age=60",
  });
  // When the city last wrote the file, which dates a stream that has ended.
  const lastModified = upstream.headers.get("Last-Modified");
  if (lastModified) headers.set("Last-Modified", lastModified);
  return new Response(upstream.body, { headers });
}
