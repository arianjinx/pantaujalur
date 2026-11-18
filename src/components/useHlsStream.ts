import { type RefObject, useEffect, useState } from "react";

import type { Camera } from "#/domain/types";

export type StreamStatus = "loading" | "playing" | "offline" | "failed";

export function streamUrl(camera: Camera) {
  return `/api/stream/${camera.streamId}.m3u8`;
}

/**
 * Plays one camera's HLS stream through the app's proxy into `videoRef` while
 * the hook is mounted, and tears the player down on unmount.
 */
export function useHlsStream(
  videoRef: RefObject<HTMLVideoElement | null>,
  camera: Camera,
): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>("loading");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let destroyed = false;
    let destroyHls = () => {};

    const onPlaying = () => setStatus("playing");
    const onWaiting = () => setStatus("loading");
    const onNativeError = () => setStatus("failed");
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);

    import("hls.js").then(({ default: Hls }) => {
      if (destroyed) return;
      if (Hls.isSupported()) {
        const hls = new Hls();
        destroyHls = () => {
          hls.destroy();
          destroyHls = () => {};
        };
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          setStatus(data.response?.code === 404 ? "offline" : "failed");
          destroyHls();
        });
        hls.loadSource(streamUrl(camera));
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.addEventListener("error", onNativeError);
        video.src = streamUrl(camera);
      } else {
        setStatus("failed");
      }
    });

    return () => {
      destroyed = true;
      destroyHls();
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("error", onNativeError);
      video.removeAttribute("src");
      video.load();
    };
  }, [videoRef, camera]);

  return status;
}
