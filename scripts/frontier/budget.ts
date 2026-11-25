import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createSnapshotQueue,
  MAX_CONCURRENT_CAPTURES,
  RECHECK_AFTER_MS,
  STALE_AFTER_MS,
} from "../../src/components/snapshotQueue";
import type { Camera } from "../../src/domain/types";

const MINUTE = 60_000;
const urls = {
  createObjectURL: () => "blob:score",
  revokeObjectURL: () => {},
};

function camera(id: string): Camera {
  return {
    id,
    name: id,
    streamId: "1",
    address: "",
    district: "KLOJEN",
    position: { lat: -7.97, lng: 112.63 },
  };
}

function frame(at: number, ended = false) {
  return {
    blob: new Blob(["frame"]),
    capturedAt: new Date(at),
    ...(ended ? { endedAt: new Date(0) } : {}),
  };
}

function started(
  cameras: Camera[],
  cached: Record<string, ReturnType<typeof frame>>,
  now: number,
) {
  const ids: string[] = [];
  createSnapshotQueue({
    cameras,
    cached: new Map(Object.entries(cached)),
    capture: (item) => {
      ids.push(item.id);
      return new Promise<never>(() => {});
    },
    now: () => now,
    urls,
  });
  return ids;
}

function regexLiteral(source: string) {
  const match = source.match(/const STREAM_FILE = (\/[\s\S]*\/[a-z]*);/);
  return match?.[1] ?? "";
}

function compile(literal: string) {
  const match = literal.match(/^\/([\s\S]*)\/([a-z]*)$/);
  if (!match) return null;
  return new RegExp(match[1] ?? "", match[2] ?? "");
}

export function budget(root: string, all: boolean) {
  const fails: string[] = [];
  const now = 100 * MINUTE;
  const six = ["a", "b", "c", "d", "e", "f"].map(camera);
  const opening = started(six, {}, now);
  if (MAX_CONCURRENT_CAPTURES !== 3 || opening.length !== 3) {
    fails.push(
      `opening 6 cameras started ${opening.length}, and MAX_CONCURRENT_CAPTURES is ${MAX_CONCURRENT_CAPTURES}; the budget is 3`,
    );
  }

  const stale = started(
    [camera("fresh"), camera("old")],
    {
      fresh: frame(now - 14 * MINUTE),
      old: frame(now - 16 * MINUTE),
    },
    now,
  );
  if (STALE_AFTER_MS !== 15 * MINUTE || stale.join(",") !== "old") {
    fails.push(
      `a 14 min frame and a 16 min frame started [${stale.join(", ")}]; STALE_AFTER_MS is ${STALE_AFTER_MS}. A live frame is captured again after 15 min`,
    );
  }

  const ended = started(
    [camera("recent"), camera("due")],
    {
      recent: frame(now - 4 * MINUTE, true),
      due: frame(now - 6 * MINUTE, true),
    },
    now,
  );
  if (RECHECK_AFTER_MS !== 5 * MINUTE || ended.join(",") !== "due") {
    fails.push(
      `ended frames of 4 min and 6 min started [${ended.join(", ")}]; RECHECK_AFTER_MS is ${RECHECK_AFTER_MS}. An ended stream is asked again after 5 min`,
    );
  }

  const wall = readFileSync(
    join(root, "src/components/CameraWall.tsx"),
    "utf8",
  );
  if (/<video[\s>]/.test(wall)) fails.push("CameraWall.tsx mounts a <video>");

  const proxy = regexLiteral(
    readFileSync(join(root, "src/routes/api/stream/$file.ts"), "utf8"),
  );
  const relay = regexLiteral(
    readFileSync(join(root, "relay/server.ts"), "utf8"),
  );
  if (proxy === "" || proxy !== relay) {
    fails.push("STREAM_FILE in the stream proxy and relay/server.ts differ");
  }

  const pattern = compile(proxy);
  const accept = ["123.m3u8", "123_0p0870.ts"];
  const reject = ["../x.m3u8", "123.txt", "abc.m3u8", "123.m3u8/evil"];
  const badAccept = accept.filter((name) => !pattern?.test(name));
  const badReject = reject.filter((name) => pattern?.test(name));
  if (!pattern || badAccept.length > 0 || badReject.length > 0) {
    fails.push(
      `STREAM_FILE rejected [${badAccept.join(", ")}] and accepted [${badReject.join(", ")}]`,
    );
  }

  const total = 6;
  return {
    pass: total - fails.length,
    total,
    first_fail: fails[0] ?? "",
    ...(all ? { fails } : {}),
  };
}
