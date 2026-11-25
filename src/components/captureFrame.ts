import type { Camera } from "#/domain/types";

import type { StoredFrame } from "./frameStore";
import { CameraOffline } from "./snapshotQueue";
import { streamUrl } from "./useHlsStream";

const TIMEOUT_MS = 60_000;

const RETRY_DELAYS_MS = [2_000, 5_000];
const PLAYLIST_TIMEOUT_MS = 15_000;
const MAX_WIDTH = 640;
const JPEG_QUALITY = 0.75;

const MIN_SEGMENT_S = 1;

const ONE_TRY = {
  default: {
    maxTimeToFirstByteMs: 15_000,
    maxLoadTimeMs: 20_000,
    timeoutRetry: null,
    errorRetry: null,
  },
};

export function newestSegmentPlaylist(playlist: string, base: string) {
  let newest: { duration: number; uri: string } | null = null;
  let duration: number | null = null;
  for (const line of playlist.split(/\r?\n/).map((l) => l.trim())) {
    if (line.startsWith("#EXTINF:"))
      duration = Number.parseFloat(line.slice("#EXTINF:".length));
    else if (line && !line.startsWith("#") && duration !== null) {
      if (duration >= MIN_SEGMENT_S || !newest)
        newest = { duration, uri: line };
      duration = null;
    }
  }
  if (!newest) throw new CameraOffline("The playlist lists no segment");
  const single = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${Math.ceil(newest.duration)}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    `#EXTINF:${newest.duration},`,
    new URL(newest.uri, base).href,
    "#EXT-X-ENDLIST",
    "",
  ].join("\n");
  return { playlist: single, ended: playlist.includes("#EXT-X-ENDLIST") };
}

export async function captureFrame(
  camera: Camera,
  signal: AbortSignal,
): Promise<StoredFrame> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
  for (const delayMs of RETRY_DELAYS_MS) {
    try {
      return await captureOnce(camera, deadline, signal);
    } catch (error) {
      deadline.throwIfAborted();
      console.info(`Capture of ${camera.streamId} failed, retrying:`, error);
    }
    await sleep(delayMs, deadline);
  }
  return captureOnce(camera, deadline, signal);
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function captureOnce(
  camera: Camera,
  deadline: AbortSignal,
  signal: AbortSignal,
): Promise<StoredFrame> {
  const src = new URL(streamUrl(camera), location.href).href;
  const response = await fetch(src, {
    signal: AbortSignal.any([
      deadline,
      AbortSignal.timeout(PLAYLIST_TIMEOUT_MS),
    ]),
  });
  if (response.status === 404) throw new CameraOffline("HTTP 404");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { playlist: single, ended } = newestSegmentPlaylist(
    await response.text(),
    src,
  );
  const capturedAt = new Date();
  const endedAt = ended ? (lastModified(response) ?? capturedAt) : undefined;
  const playlist = new Blob([single], {
    type: "application/vnd.apple.mpegurl",
  });
  const { default: Hls } = await import("hls.js");
  deadline.throwIfAborted();

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const playlistUrl = URL.createObjectURL(playlist);
  let hls: InstanceType<typeof Hls> | null = null;
  let onAbort = () => {};

  const firstFrame = new Promise<void>((resolve, reject) => {
    onAbort = () => reject(deadline.reason);
    deadline.addEventListener("abort", onAbort);
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener(
      "error",
      () => reject(new Error("The stream could not be decoded")),
      { once: true },
    );
    if (Hls.isSupported()) {
      hls = new Hls({
        capLevelToPlayerSize: false,
        manifestLoadPolicy: ONE_TRY,
        playlistLoadPolicy: ONE_TRY,
        fragLoadPolicy: ONE_TRY,
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal)
          reject(
            new Error(
              data.response?.code ? `HTTP ${data.response.code}` : data.details,
            ),
          );
      });
      hls.loadSource(playlistUrl);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    } else {
      reject(new Error("This browser cannot play HLS"));
    }
    void video.play().catch(() => {});
  });

  try {
    await firstFrame;
    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas
      .getContext("2d")
      ?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new Error("The frame could not be encoded");
    signal.throwIfAborted();
    return { blob, capturedAt, endedAt };
  } finally {
    deadline.removeEventListener("abort", onAbort);
    (hls as InstanceType<typeof Hls> | null)?.destroy();
    URL.revokeObjectURL(playlistUrl);
    video.removeAttribute("src");
    video.load();
  }
}

function lastModified(response: Response): Date | undefined {
  const header = response.headers.get("Last-Modified");
  const date = header ? new Date(header) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}
