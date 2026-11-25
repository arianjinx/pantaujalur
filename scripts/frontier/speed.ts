import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";

const HOW =
  "SCORE_SPEED=1 with bun run dev on BASE_URL. Three Lighthouse mobile runs, median of each category. Chrome is BROWSER_CHANNEL or google-chrome.";

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
  const [load1] = loadavg();
  const chrome = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
  const dir = mkdtempSync(join(tmpdir(), "pantaujalur-lh-"));
  const samples: Sample[] = [];
  const errors: string[] = [];
  for (let i = 0; i < 3; i++) {
    const out = join(dir, `run-${i}.json`);
    const run = spawnSync(
      "bunx",
      [
        "--bun",
        "lighthouse",
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
    load1,
    samples,
    first_fail:
      below
        .map(([key, name]) => `${name} ${summary[key]} < ${FRONTIER[key]}`)
        .join("; ") || "",
  };
}
