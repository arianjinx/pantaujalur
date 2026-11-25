import { useEffect, useRef } from "react";

import type { Camera } from "#/domain/types";

import { type StreamStatus, useHlsStream } from "./useHlsStream";

const STATUS_MESSAGE: Record<Exclude<StreamStatus, "playing">, string> = {
  loading: "Connecting to live stream…",
  offline: "This camera is offline right now.",
  failed: "The stream could not be loaded.",
};

export function CameraPlayer({
  camera,
  onClose,
}: {
  camera: Camera;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const status = useHlsStream(videoRef, camera);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-3"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Live camera: ${camera.name}`}
        className="w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{camera.name}</h2>
            <p className="truncate text-xs text-slate-500">
              {camera.district} · {camera.address}
            </p>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="relative aspect-video bg-black">
          <video
            ref={videoRef}
            className="h-full w-full"
            autoPlay
            muted
            playsInline
            controls
            data-testid="camera-video"
          />
          {status !== "playing" && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white">
              {STATUS_MESSAGE[status]}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
