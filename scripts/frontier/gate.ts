import { spawnSync } from "node:child_process";

const rules = spawnSync("bun", ["scripts/rules.ts"], { stdio: "inherit" });
if (rules.status !== 0) {
  console.error("verify: rules failed");
  process.exit(rules.status ?? 1);
}

const steps = ["supply", "lint", "typecheck", "test", "build"] as const;

for (const step of steps) {
  const run = spawnSync("bun", ["run", step], { stdio: "inherit" });
  if (run.status !== 0) {
    console.error(`verify: ${step} failed`);
    process.exit(run.status ?? 1);
  }
}

console.log("verify: green");
