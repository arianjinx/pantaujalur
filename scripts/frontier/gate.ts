import { spawnSync } from "node:child_process";

// The handoff gate in AGENTS.md. Each step is the repo's own script.
const steps = ["lint", "typecheck", "test", "build"] as const;

for (const step of steps) {
  const run = spawnSync("bun", ["run", step], { stdio: "inherit" });
  if (run.status !== 0) {
    console.error(`verify: ${step} failed`);
    process.exit(run.status ?? 1);
  }
}

console.log("verify: green");
