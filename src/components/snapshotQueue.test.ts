import { describe, expect, test } from "bun:test";

import type { Camera } from "#/domain/types";

import type { StoredFrame } from "./frameStore";
import {
  CameraOffline,
  capturePriority,
  createSnapshotQueue,
  RECHECK_AFTER_MS,
  STALE_AFTER_MS,
} from "./snapshotQueue";

const MINUTE = 60_000;

function cameras(count: number): Camera[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `cam-${i + 1}`,
    name: `Camera ${i + 1}`,
    streamId: String(i + 1),
    address: "",
    district: "KLOJEN",
    position: { lat: -7.97, lng: 112.63 },
  }));
}

type Call = {
  id: string;
  signal: AbortSignal;
  done: boolean;
  succeed: (endedAt?: Date) => StoredFrame;
  fail: () => void;
  failOffline: () => void;
};

function fakeCapture(clock: () => number) {
  const calls: Call[] = [];
  let running = 0;
  let maxRunning = 0;
  const capture = (camera: Camera, signal: AbortSignal) =>
    new Promise<StoredFrame>((resolve, reject) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      const settle = () => {
        running--;
        call.done = true;
      };
      signal.addEventListener("abort", () => {
        settle();
        reject(signal.reason);
      });
      const call: Call = {
        id: camera.id,
        signal,
        done: false,
        succeed: (endedAt?: Date) => {
          settle();
          const frame = {
            blob: new Blob([camera.id]),
            capturedAt: new Date(clock()),
            endedAt,
          };
          resolve(frame);
          return frame;
        },
        fail: () => {
          settle();
          reject(new Error("HTTP 502"));
        },
        failOffline: () => {
          settle();
          reject(new CameraOffline("HTTP 404"));
        },
      };
      calls.push(call);
    });
  return {
    capture,
    calls,
    ids: () => calls.map((c) => c.id),
    maxRunning: () => maxRunning,

    call(id: string): Call {
      const call = calls.filter((c) => c.id === id).pop();
      if (!call) throw new Error(`${id} was never captured`);
      return call;
    },

    open: () => calls.find((c) => !c.done),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(
  count: number,
  cached: Record<string, StoredFrame> = {},
  start = 100 * MINUTE,
  failures: Record<string, Date> = {},
) {
  let clock = start;
  const fake = fakeCapture(() => clock);
  const revoked: string[] = [];
  const persisted: { id: string; frame: StoredFrame }[] = [];
  const failuresPersisted: { id: string; at: Date | null }[] = [];
  let urls = 0;
  const queue = createSnapshotQueue({
    cameras: cameras(count),
    cached: new Map(Object.entries(cached)),
    failures: new Map(Object.entries(failures)),
    capture: fake.capture,
    persist: (id, frame) => persisted.push({ id, frame }),
    persistFailure: (id, at) => failuresPersisted.push({ id, at }),
    now: () => clock,
    urls: {
      createObjectURL: () => `blob:${++urls}`,
      revokeObjectURL: (url) => revoked.push(url),
    },
  });
  const snapshot = (id: string) => queue.getSnapshots().get(id);

  const shown = (id: string) => {
    const s = snapshot(id);
    return s?.kind === "captured" ? s.frame : s?.previous;
  };
  const mustShow = (id: string) => {
    const frame = shown(id);
    if (!frame) throw new Error(`${id} shows no frame`);
    return frame;
  };
  return {
    fake,
    revoked,
    persisted,
    failuresPersisted,
    queue,
    shown,
    mustShow,
    kind: (id: string) => snapshot(id)?.kind,
    advance: (ms: number) => (clock += ms),
  };
}

const frameAt = (ms: number): StoredFrame => ({
  blob: new Blob(["cached"]),
  capturedAt: new Date(ms),
});

async function completeAll(fake: ReturnType<typeof fakeCapture>) {
  for (let next = fake.open(); next; next = fake.open()) {
    next.succeed();
    await flush();
  }
}

describe("createSnapshotQueue", () => {
  test("opening captures the first three cameras and queues the rest", () => {
    const { fake, kind } = setup(5);
    expect(fake.ids()).toEqual(["cam-1", "cam-2", "cam-3"]);
    expect(kind("cam-1")).toBe("capturing");
    expect(kind("cam-4")).toBe("pending");
  });

  test("never runs more than three captures, and captures every camera once", async () => {
    const { fake, queue } = setup(10);
    await completeAll(fake);
    expect(fake.maxRunning()).toBe(3);
    expect(new Set(fake.ids())).toEqual(new Set(cameras(10).map((c) => c.id)));
    expect(
      [...queue.getSnapshots().values()].every((s) => s.kind === "captured"),
    ).toBe(true);
    await flush();
    expect(fake.calls).toHaveLength(10);
  });

  test("a finished capture shows its frame, is persisted, and frees a slot", async () => {
    const { fake, kind, shown, persisted } = setup(5);
    const frame = fake.call("cam-2").succeed();
    await flush();
    expect(kind("cam-2")).toBe("captured");
    expect(shown("cam-2")?.capturedAt).toEqual(frame.capturedAt);
    expect(persisted).toEqual([{ id: "cam-2", frame }]);
    expect(fake.ids()).toEqual(["cam-1", "cam-2", "cam-3", "cam-4"]);
  });

  test("a failed capture shows offline, persists nothing, and the queue moves on", async () => {
    const { fake, kind, shown, persisted } = setup(4);
    fake.call("cam-1").fail();
    await flush();
    expect(kind("cam-1")).toBe("offline");
    expect(shown("cam-1")).toBeUndefined();
    expect(persisted).toEqual([]);
    expect(fake.ids()).toContain("cam-4");
  });

  test("prioritize reorders the cameras still waiting", async () => {
    const { fake, queue } = setup(9);
    queue.prioritize(
      capturePriority(
        cameras(9).map((c) => c.id),
        3,
        2,
      ),
    );
    fake.call("cam-1").succeed();
    fake.call("cam-2").succeed();
    await flush();
    expect(fake.ids().slice(3)).toEqual(["cam-7", "cam-8"]);
  });

  test("a clicked camera jumps the queue", async () => {
    const { fake, queue, kind } = setup(9);
    queue.refresh("cam-8");
    expect(kind("cam-8")).toBe("pending");
    fake.call("cam-1").succeed();
    await flush();
    expect(fake.ids()[3]).toBe("cam-8");
  });

  test("refreshing keeps the old frame until the new one arrives, then revokes it", async () => {
    const { fake, queue, revoked, kind, shown, mustShow, advance } = setup(1);
    fake.call("cam-1").succeed();
    await flush();
    const first = mustShow("cam-1");
    queue.refresh("cam-1");
    expect(kind("cam-1")).toBe("capturing");
    expect(shown("cam-1")).toEqual(first);
    expect(revoked).toEqual([]);
    advance(1000);
    fake.call("cam-1").succeed();
    await flush();
    const second = mustShow("cam-1");
    expect(kind("cam-1")).toBe("captured");
    expect(second.url).not.toBe(first.url);
    expect(second.capturedAt.getTime()).toBeGreaterThan(
      first.capturedAt.getTime(),
    );
    expect(revoked).toEqual([first.url]);
  });

  test("a failed refresh keeps the last good frame", async () => {
    const { fake, queue, kind, shown } = setup(1);
    fake.call("cam-1").succeed();
    await flush();
    const first = shown("cam-1");
    queue.refresh("cam-1");
    fake.call("cam-1").fail();
    await flush();
    expect(kind("cam-1")).toBe("offline");
    expect(shown("cam-1")).toEqual(first);
  });

  test("never captures the same camera twice at once", async () => {
    const { fake, queue } = setup(5);
    queue.refresh("cam-1");
    queue.refresh("cam-1");
    queue.refreshAll();
    await flush();
    expect(fake.ids()).toEqual(["cam-1", "cam-2", "cam-3"]);
  });

  test("clicking a camera that is already capturing starts nothing new", async () => {
    const { fake, queue } = setup(1);
    queue.refresh("cam-1");
    queue.refreshAll();
    await flush();
    expect(fake.ids()).toEqual(["cam-1"]);
    fake.call("cam-1").succeed();
    await flush();
    expect(fake.ids()).toEqual(["cam-1"]);
  });

  test("refresh all captures every camera again through the same limit", async () => {
    const { fake, queue } = setup(5);
    await completeAll(fake);
    expect(fake.calls).toHaveLength(5);
    queue.refreshAll();
    expect(fake.calls).toHaveLength(8);
    await completeAll(fake);
    expect(fake.calls).toHaveLength(10);
    expect(fake.maxRunning()).toBe(3);
  });

  test("dispose aborts captures in flight, starts no more, and revokes every frame", async () => {
    const { fake, queue, revoked, mustShow, persisted } = setup(5);
    fake.call("cam-1").succeed();
    await flush();
    const kept = mustShow("cam-1");
    const late = fake.call("cam-2");
    queue.dispose();
    expect(fake.calls.filter((c) => c.signal.aborted).map((c) => c.id)).toEqual(
      ["cam-2", "cam-3", "cam-4"],
    );
    late.succeed();
    queue.refreshAll();
    queue.refreshStale();
    await flush();
    expect(fake.calls).toHaveLength(4);
    expect(revoked).toEqual([kept.url]);
    expect(persisted.map((p) => p.id)).toEqual(["cam-1"]);
  });
});

describe("staleness", () => {
  const now = 100 * MINUTE;
  const fresh = frameAt(now - 14 * MINUTE);
  const stale = frameAt(now - 16 * MINUTE);

  test("a fresh cached frame shows at once and is not captured", () => {
    const { fake, kind, shown } = setup(1, { "cam-1": fresh }, now);
    expect(kind("cam-1")).toBe("captured");
    expect(shown("cam-1")?.capturedAt).toEqual(fresh.capturedAt);
    expect(fake.calls).toHaveLength(0);
  });

  test("a stale cached frame shows while it is captured again; a missing one is captured", () => {
    const { fake, kind, shown } = setup(
      3,
      { "cam-1": fresh, "cam-2": stale },
      now,
    );
    expect(fake.ids()).toEqual(["cam-2", "cam-3"]);
    expect(kind("cam-2")).toBe("capturing");
    expect(shown("cam-2")?.capturedAt).toEqual(stale.capturedAt);
  });

  test("a click captures a fresh camera anyway", () => {
    const { fake, queue } = setup(1, { "cam-1": fresh }, now);
    queue.refresh("cam-1");
    expect(fake.ids()).toEqual(["cam-1"]);
  });

  test("refresh all captures fresh cameras too", () => {
    const { fake, queue } = setup(2, { "cam-1": fresh, "cam-2": fresh }, now);
    queue.refreshAll();
    expect(fake.ids()).toEqual(["cam-1", "cam-2"]);
  });

  test("refreshStale queues only the frames that crossed the threshold since", async () => {
    const { fake, queue, advance } = setup(2, { "cam-1": fresh }, now);
    fake.call("cam-2").succeed();
    await flush();
    queue.refreshStale();
    expect(fake.calls).toHaveLength(1);
    advance(STALE_AFTER_MS - 14 * MINUTE + 1);
    queue.refreshStale();
    expect(fake.ids()).toEqual(["cam-2", "cam-1"]);
    advance(14 * MINUTE);
    queue.refreshStale();
    expect(fake.ids()).toEqual(["cam-2", "cam-1", "cam-2"]);
  });

  test("a failed camera is asked again after 5 minutes", async () => {
    const { fake, queue, advance } = setup(1, {}, now);
    fake.call("cam-1").fail();
    await flush();
    advance(RECHECK_AFTER_MS);
    queue.refreshStale();
    expect(fake.calls).toHaveLength(1);
    advance(1);
    queue.refreshStale();
    expect(fake.calls).toHaveLength(2);
  });

  test("a camera whose stream had ended is asked again after 5 minutes, and shows its last picture meanwhile", async () => {
    const { fake, queue, advance, kind, shown } = setup(1, {}, now);
    const endedAt = new Date(now - 3 * MINUTE);
    fake.call("cam-1").succeed(endedAt);
    await flush();
    expect(kind("cam-1")).toBe("captured");
    expect(shown("cam-1")?.endedAt).toEqual(endedAt);
    advance(RECHECK_AFTER_MS);
    queue.refreshStale();
    expect(fake.calls).toHaveLength(1);
    advance(1);
    queue.refreshStale();
    expect(fake.calls).toHaveLength(2);
  });

  test("a new wall shows a recent ended-stream frame, and asks again once it is 5 minutes old", () => {
    const { fake, kind } = setup(
      2,
      {
        "cam-1": { ...frameAt(now - 4 * MINUTE), endedAt: new Date(0) },
        "cam-2": { ...frameAt(now - 6 * MINUTE), endedAt: new Date(0) },
      },
      now,
    );
    expect(kind("cam-1")).toBe("captured");
    expect(fake.ids()).toEqual(["cam-2"]);
  });

  test("a new wall waits out a remembered failure instead of asking the camera again", () => {
    const { fake, kind } = setup(2, {}, now, {
      "cam-1": new Date(now - 4 * MINUTE),
      "cam-2": new Date(now - RECHECK_AFTER_MS - 1),
    });
    expect(kind("cam-1")).toBe("offline");
    expect(fake.ids()).toEqual(["cam-2"]);
  });

  test("only an offline answer is remembered; a timeout or server error is not", async () => {
    const { fake, queue, failuresPersisted } = setup(1, {}, now);
    fake.call("cam-1").fail();
    await flush();
    expect(failuresPersisted).toEqual([]);
    queue.refresh("cam-1");
    fake.call("cam-1").failOffline();
    await flush();
    expect(failuresPersisted).toEqual([{ id: "cam-1", at: new Date(now) }]);
  });

  test("a failure is remembered, and a later frame forgets it", async () => {
    const { fake, queue, failuresPersisted } = setup(1, {}, now);
    fake.call("cam-1").failOffline();
    await flush();
    expect(failuresPersisted).toEqual([{ id: "cam-1", at: new Date(now) }]);
    queue.refresh("cam-1");
    fake.call("cam-1").succeed();
    await flush();
    expect(failuresPersisted.at(-1)).toEqual({ id: "cam-1", at: null });
  });
});

describe("capturePriority", () => {
  const ids = cameras(10).map((c) => c.id);

  test("on the first page, follows the route", () => {
    expect(capturePriority(ids, 3, 0)).toEqual(ids);
  });

  test("visible page first, then onward, then earlier pages nearest first", () => {
    expect(capturePriority(ids, 3, 2)).toEqual([
      "cam-7",
      "cam-8",
      "cam-9",
      "cam-10",
      "cam-4",
      "cam-5",
      "cam-6",
      "cam-1",
      "cam-2",
      "cam-3",
    ]);
  });
});
