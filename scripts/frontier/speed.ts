import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { availableParallelism, loadavg, platform, tmpdir } from "node:os";
import { join } from "node:path";

const LIGHTHOUSE = "lighthouse@13.6.0";
const BUSY_SHARE = 0.8;
const HOW = `SCORE_SPEED=1 with bun run dev on BASE_URL. Three ${LIGHTHOUSE} mobile runs, median of each category. Chrome is CHROME_PATH, else the platform's Google Chrome. Refused while the 1-minute load is over ${BUSY_SHARE * 100}% of the cores.`;

const DEFAULT_CHROME =
  platform() === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/usr/bin/google-chrome";

type Sample = {
  performance: number;
  accessibility: number;
  best_practices: number;
  seo: number;
};

const FRONTIER: Sample = {
  performance: 90,
  accessibility: 100,
  best_practices: 100,
  seo: 100,
};

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function speed() {
  if (process.env.SCORE_SPEED !== "1")
    return { score: "unmeasured", first_fail: "", how: HOW };
  const base = process.env.BASE_URL ?? "http://localhost:1337";
  const [load1 = 0] = loadavg();
  const cores = availableParallelism();
  if (load1 > cores * BUSY_SHARE) {
    return {
      score: "unmeasured",
      first_fail: "",
      why: `the 1-minute load is ${load1.toFixed(2)} on ${cores} cores, over ${BUSY_SHARE * 100}%. A busy machine reads as a slow page. Wait for it to settle.`,
      load1,
      cores,
      how: HOW,
    };
  }
  const chrome = process.env.CHROME_PATH ?? DEFAULT_CHROME;
  const dir = mkdtempSync(join(tmpdir(), "pantaujalur-lh-"));
  const samples: Sample[] = [];
  const errors: string[] = [];
  for (let i = 0; i < 3; i++) {
    const out = join(dir, `run-${i}.json`);
    const run = spawnSync(
      "bunx",
      [
        "--bun",
        LIGHTHOUSE,
        base,
        "--quiet",
        "--only-categories=performance,accessibility,best-practices,seo",
        "--form-factor=mobile",
        "--screenEmulation.mobile",
        `--chrome-path=${chrome}`,
        "--chrome-flags=--headless=new --no-sandbox --disable-gpu",
        `--output-path=${out}`,
        "--output=json",
      ],
      { cwd: dir, encoding: "utf8", timeout: 180_000 },
    );
    if (run.status !== 0) {
      const tail =
        `${run.stderr}\n${run.stdout}`
          .trim()
          .split("\n")
          .filter(Boolean)
          .at(-1) ?? "";
      errors.push(tail.slice(0, 300));
      continue;
    }
    try {
      const report = JSON.parse(readFileSync(out, "utf8")) as {
        categories: Record<string, { score: number | null }>;
      };
      const score = (name: string) =>
        Math.round((report.categories[name]?.score ?? 0) * 100);
      samples.push({
        performance: score("performance"),
        accessibility: score("accessibility"),
        best_practices: score("best-practices"),
        seo: score("seo"),
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (samples.length < 3) {
    return {
      score: "unmeasured",
      first_fail: "",
      why: `wanted 3 Lighthouse runs, got ${samples.length}. ${errors[0] ?? ""}`.trim(),
      load1,
      cores,
      samples,
      how: HOW,
    };
  }
  const summary: Sample = {
    performance: median(samples.map((sample) => sample.performance)),
    accessibility: median(samples.map((sample) => sample.accessibility)),
    best_practices: median(samples.map((sample) => sample.best_practices)),
    seo: median(samples.map((sample) => sample.seo)),
  };
  const short: [keyof Sample, string][] = [
    ["performance", "performance"],
    ["accessibility", "accessibility"],
    ["best_practices", "best practices"],
    ["seo", "seo"],
  ];
  const below = short.filter(([key]) => summary[key] < FRONTIER[key]);
  return {
    ...summary,
    pass: 4 - below.length,
    total: 4,
    median_of: 3,
    lighthouse: LIGHTHOUSE,
    load1,
    cores,
    samples,
    first_fail:
      below
        .map(([key, name]) => `${name} ${summary[key]} < ${FRONTIER[key]}`)
        .join("; ") || "",
  };
}
