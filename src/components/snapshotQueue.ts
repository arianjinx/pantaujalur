import type { Camera } from "#/domain/types";

import type { StoredFrame } from "./frameStore";

/**
 * One still picture of a camera on screen. `url` is an object URL of the JPEG,
 * owned by the queue. `endedAt` is set when the picture is the last one of a
 * stream that has stopped.
 */
export type Frame = { url: string; capturedAt: Date; endedAt?: Date };

/**
 * Where one camera's picture stands. `previous` is the last good frame, kept on
 * screen while a new one is on its way or after a capture failed.
 */
export type Snapshot =
  /** Waiting for a free capture slot. */
  | { kind: "pending"; previous?: Frame }
  | { kind: "capturing"; previous?: Frame }
  | { kind: "captured"; frame: Frame }
  | { kind: "offline"; previous?: Frame; at: Date };

export type CaptureFn = (
  camera: Camera,
  signal: AbortSignal,
) => Promise<StoredFrame>;

export type SnapshotQueue = ReturnType<typeof createSnapshotQueue>;

/**
 * The city answered that this camera has nothing to show (404, an ended or an
 * empty stream). Unlike a timeout or a server error, it is worth remembering.
 */
export class CameraOffline extends Error {}

export const MAX_CONCURRENT_CAPTURES = 3;
/** A live camera's frame older than this is captured again. */
export const STALE_AFTER_MS = 15 * 60_000;
/** A camera that was offline, or whose stream had ended, is asked again this soon, since city streams come back. */
export const RECHECK_AFTER_MS = 5 * 60_000;

export function isStale(at: Date, now: number) {
  return now - at.getTime() > STALE_AFTER_MS;
}

/** Whether a frame is due to be captured again. */
function frameIsDue(frame: Pick<Frame, "capturedAt" | "endedAt">, now: number) {
  const age = now - frame.capturedAt.getTime();
  return age > (frame.endedAt ? RECHECK_AFTER_MS : STALE_AFTER_MS);
}

function failureIsDue(at: Date, now: number) {
  return now - at.getTime() > RECHECK_AFTER_MS;
}

/**
 * One snapshot per camera, captured at most three at a time. A camera starts
 * from its `cached` frame: a fresh one shows and costs nothing, a stale or
 * missing one is queued, in the order given. A camera that was offline or whose
 * stream had ended is asked again after 5 minutes, a live frame after 15.
 * `refreshStale` queues the cameras that have come due since; nothing else
 * repeats on its own.
 * `refresh` asks for one camera ahead of the rest whatever its age,
 * `refreshAll` asks for all of them, and `prioritize` reorders the cameras still
 * waiting. A camera is never captured twice at once. Each new frame goes to
 * `persist`. `dispose` aborts the captures in flight and revokes every frame's
 * object URL.
 */
export function createSnapshotQueue({
  cameras,
  cached = new Map(),
  failures = new Map(),
  capture,
  persist = () => {},
  persistFailure = () => {},
  now = Date.now,
  urls = URL,
}: {
  cameras: Camera[];
  cached?: ReadonlyMap<string, StoredFrame>;
  /** When each camera last failed to give a frame, kept between wall opens. */
  failures?: ReadonlyMap<string, Date>;
  capture: CaptureFn;
  persist?: (cameraId: string, frame: StoredFrame) => void;
  persistFailure?: (cameraId: string, at: Date | null) => void;
  now?: () => number;
  urls?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
}) {
  const byId = new Map(cameras.map((camera) => [camera.id, camera]));
  const toFrame = ({ blob, capturedAt, endedAt }: StoredFrame): Frame => ({
    url: urls.createObjectURL(blob),
    capturedAt,
    endedAt,
  });
  const revoke = (frame: Frame) => urls.revokeObjectURL(frame.url);
  let snapshots: ReadonlyMap<string, Snapshot> = new Map(
    cameras.map((camera): [string, Snapshot] => {
      const stored = cached.get(camera.id);
      const frame = stored ? toFrame(stored) : undefined;
      if (frame && !frameIsDue(frame, now()))
        return [camera.id, { kind: "captured", frame }];
      const failedAt = failures.get(camera.id);
      if (failedAt && !failureIsDue(failedAt, now()))
        return [camera.id, { kind: "offline", previous: frame, at: failedAt }];
      return [camera.id, { kind: "pending", previous: frame }];
    }),
  );
  let rank = new Map(cameras.map((camera, index) => [camera.id, index]));
  /** Cameras the user asked for, most recent first; they jump the queue. */
  let urgent: string[] = [];
  const inFlight = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  let disposed = false;

  function frameOf(id: string): Frame | undefined {
    const snapshot = snapshots.get(id);
    return snapshot?.kind === "captured" ? snapshot.frame : snapshot?.previous;
  }

  function update(id: string, snapshot: Snapshot) {
    snapshots = new Map(snapshots).set(id, snapshot);
    for (const listener of listeners) listener();
  }

  function enqueue(id: string) {
    const kind = snapshots.get(id)?.kind;
    if (kind === undefined || kind === "pending" || kind === "capturing")
      return;
    update(id, { kind: "pending", previous: frameOf(id) });
  }

  function next(): string | undefined {
    const isPending = (id: string) => snapshots.get(id)?.kind === "pending";
    urgent = urgent.filter(isPending);
    if (urgent.length > 0) return urgent[0];
    let best: string | undefined;
    for (const [id, snapshot] of snapshots)
      if (
        snapshot.kind === "pending" &&
        (best === undefined || (rank.get(id) ?? 0) < (rank.get(best) ?? 0))
      )
        best = id;
    return best;
  }

  function pump() {
    while (!disposed && inFlight.size < MAX_CONCURRENT_CAPTURES) {
      const id = next();
      if (id === undefined) return;
      start(id);
    }
  }

  function start(id: string) {
    const camera = byId.get(id);
    if (!camera) return;
    const controller = new AbortController();
    inFlight.set(id, controller);
    update(id, { kind: "capturing", previous: frameOf(id) });
    const finish = (stored: StoredFrame | null, error?: unknown) => {
      inFlight.delete(id);
      if (disposed) return;
      const previous = frameOf(id);
      if (stored) {
        persist(id, stored);
        persistFailure(id, null);
        if (previous) revoke(previous);
        update(id, { kind: "captured", frame: toFrame(stored) });
      } else {
        const at = new Date(now());
        if (error instanceof CameraOffline) persistFailure(id, at);
        update(id, { kind: "offline", previous, at });
      }
      pump();
    };
    capture(camera, controller.signal).then(finish, (error: unknown) =>
      finish(null, error),
    );
  }

  pump();

  return {
    getSnapshots: () => snapshots,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Captures the cameras still waiting in this order; cameras left out go last. */
    prioritize(order: string[]) {
      rank = new Map(order.map((id, index) => [id, index]));
      for (const id of byId.keys()) if (!rank.has(id)) rank.set(id, rank.size);
    },
    refresh(id: string) {
      if (disposed) return;
      enqueue(id);
      if (snapshots.get(id)?.kind === "pending")
        urgent = [id, ...urgent.filter((u) => u !== id)];
      pump();
    },
    refreshAll() {
      if (disposed) return;
      for (const id of byId.keys()) enqueue(id);
      pump();
    },
    refreshStale() {
      if (disposed) return;
      for (const [id, snapshot] of snapshots)
        if (
          (snapshot.kind === "captured" && frameIsDue(snapshot.frame, now())) ||
          (snapshot.kind === "offline" && failureIsDue(snapshot.at, now()))
        )
          enqueue(id);
      pump();
    },
    dispose() {
      disposed = true;
      for (const controller of inFlight.values()) controller.abort();
      inFlight.clear();
      for (const id of snapshots.keys()) {
        const frame = frameOf(id);
        if (frame) revoke(frame);
      }
    },
  };
}

/**
 * The order to capture a wall's cameras while it shows `activePage`: that page,
 * then onward along the route, then the earlier pages, nearest first.
 */
export function capturePriority(
  ids: string[],
  pageSize: number,
  activePage: number,
): string[] {
  const start = activePage * pageSize;
  const earlier: string[] = [];
  for (let page = activePage - 1; page >= 0; page--)
    earlier.push(...ids.slice(page * pageSize, (page + 1) * pageSize));
  return [...ids.slice(start), ...earlier];
}
