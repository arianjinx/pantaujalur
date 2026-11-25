import { spawnSync } from "node:child_process";
import { hostname, loadavg, platform, release } from "node:os";
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
  if (args.has("--no-gate")) return { score: "skipped" };
  const run = spawnSync("bash", ["scripts/verify.sh"], {
    cwd: root,
    encoding: "utf8",
  });
  if (run.status === 0) return { score: "yes" };
  const tail =
    `${run.stdout}\n${run.stderr}`.trim().split("\n").filter(Boolean).at(-1) ??
    "";
  return { score: "no", first_fail: tail.slice(0, 300) };
}

function flows() {
  if (process.env.SCORE_FLOWS !== "1") {
    return {
      score: "unmeasured",
      why: "The three flows drive a live camera list. cctv.malangkota.go.id answers 403 from networks the city refuses, and this meter does not count a refused list as a product failure. On a network the city accepts, with bun run dev up, run SCORE_FLOWS=1 scripts/score.",
      how: "SCORE_FLOWS=1 bun run e2e, bun run e2e:wall and bun run e2e:places",
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
      const tail =
        `${run.stdout}\n${run.stderr}`
          .trim()
          .split("\n")
          .filter(Boolean)
          .at(-1) ?? "";
      fails.push(`${command}: ${tail.slice(0, 200)}`);
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
// Browser and Lighthouse run before the gate, so a build does not heat the machine first.
const measured = {
  R1: geometry(root, all),
  R2: await places(root, all),
  R3: budget(root, all),
  R8: direction(root, all),
  screen: await browser(root, all),
  R5: flows(),
  R7: speed(),
};

console.log(
  JSON.stringify({
    commit: dirty ? `${commit}+dirty` : commit,
    machine: `${hostname()} ${platform()} ${release()}`,
    load1,
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
      why: "The operator signs off on the route, the wall and the player, at phone and desktop size. Notes go in docs/DEVIATIONS.md only when a difference is on purpose.",
    },
  }),
);
