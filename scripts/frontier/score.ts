import { spawnSync } from "node:child_process";
import { availableParallelism, loadavg, platform, release } from "node:os";
import { join } from "node:path";

import { browser } from "./browser";
import { budget } from "./budget";
import { direction } from "./direction";
import { geometry } from "./geometry";
import { places } from "./places";
import { speed } from "./speed";

const root = join(import.meta.dir, "../..");
const args = new Set(process.argv.slice(2));
const all = args.has("--all");

function git(args: string[]) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout.trim();
}

function gate() {
  if (args.has("--no-gate")) return { score: "skipped", first_fail: "" };
  const run = spawnSync("bash", ["scripts/verify.sh"], {
    cwd: root,
    encoding: "utf8",
  });
  if (run.status === 0) return { score: "yes", first_fail: "" };
  const tail =
    `${run.stdout}\n${run.stderr}`.trim().split("\n").filter(Boolean).at(-1) ??
    "";
  return { score: "no", first_fail: tail.slice(0, 300) };
}

const FLOWS_HOW =
  "SCORE_FLOWS=1 with bun run dev on BASE_URL runs bun run e2e, bun run e2e:wall and bun run e2e:places";

async function cityAnswers(base: string) {
  try {
    const response = await fetch(`${base}/api/cameras`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) return "";
    const body = (await response.text()).replace(/\s+/g, " ").trim();
    return `GET ${base}/api/cameras answered ${response.status}: ${body.slice(0, 160)}`;
  } catch (error) {
    return `GET ${base}/api/cameras failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const SCRIPT_EXIT = /^error: script ".*" exited with code \d+$/;

function failureLine(output: string) {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !SCRIPT_EXIT.test(line));
  const thrown = lines.find((line) => /^(\w*Error|error):/.test(line));
  return (thrown ?? lines.at(-1) ?? "").slice(0, 300);
}

async function flows() {
  if (process.env.SCORE_FLOWS !== "1") {
    return {
      score: "unmeasured",
      first_fail: "",
      why: "The three flows drive a live camera list. cctv.malangkota.go.id answers 403 from networks the city refuses, and this meter does not count a refused list as a product failure. On a network the city accepts, with bun run dev up, run SCORE_FLOWS=1 scripts/score.",
      how: FLOWS_HOW,
    };
  }
  const base = process.env.BASE_URL ?? "http://localhost:1337";
  const refused = await cityAnswers(base);
  if (refused !== "") {
    return {
      score: "unmeasured",
      first_fail: "",
      why: `${refused}. A camera list the city refuses is not a product failure, so the flows were not run.`,
      how: FLOWS_HOW,
    };
  }
  const commands = ["e2e", "e2e:wall", "e2e:places"] as const;
  const fails: string[] = [];
  for (const command of commands) {
    const run = spawnSync("bun", ["run", command], {
      cwd: root,
      encoding: "utf8",
    });
    if (run.status !== 0) {
      fails.push(`${command}: ${failureLine(`${run.stdout}\n${run.stderr}`)}`);
    }
  }
  return {
    pass: commands.length - fails.length,
    total: commands.length,
    first_fail: fails[0] ?? "",
    ...(all ? { fails } : {}),
  };
}

const commit = git(["rev-parse", "--short", "HEAD"]);
const dirty = git(["status", "--porcelain"]) !== "";
const [load1] = loadavg();
const cores = availableParallelism();

const measured = {
  R1: geometry(root, all),
  R2: await places(root, all),
  R3: budget(root, all),
  R8: direction(root, all),
  screen: await browser(root, all),
  R5: await flows(),
  R7: speed(),
};

console.log(
  JSON.stringify({
    commit: dirty ? `${commit}+dirty` : commit,
    machine: `${platform()} ${release()}`,
    load1,
    cores,
    R0: gate(),
    R1: measured.R1,
    R2: measured.R2,
    R3: measured.R3,
    R4: measured.screen.R4,
    R5: measured.R5,
    R6: measured.screen.R6,
    R7: measured.R7,
    R8: measured.R8,
    R9: {
      score: "manual",
      first_fail: "",
      why: "The operator signs off on the route, the wall and the player, at phone and desktop size.",
    },
  }),
);
