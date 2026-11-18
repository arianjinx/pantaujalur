import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const files = (...pathspecs: string[]) =>
  Bun.spawnSync(
    ["git", "ls-files", "-co", "--exclude-standard", ...pathspecs],
    { cwd: root },
  )
    .stdout.toString()
    .split("\n")
    .filter(Boolean);

test("AGENTS.md is the one instruction file", () => {
  assert.deepEqual(
    files("*CLAUDE.md", "*CLAUDE.local.md"),
    [],
    "no CLAUDE.md, so every harness reads AGENTS.md. Move what /init or # memory wrote into AGENTS.md",
  );
});

test("every skill lives in .agents/skills", () => {
  assert.deepEqual(
    files("*SKILL.md").filter((path) => !path.startsWith(".agents/skills/")),
    [],
    "every skill lives in .agents/skills/, and .claude/skills is a symlink to it",
  );
});

test("Cursor and Claude Code cloud set up through .agents/setup", () => {
  assert.equal(
    JSON.parse(read(".cursor/environment.json")).install,
    "bash .agents/setup",
  );
  type Hook = { hooks: { command: string }[] };
  const sessionStart: Hook[] = JSON.parse(read(".claude/settings.json")).hooks
    .SessionStart;
  assert.ok(
    sessionStart.some(({ hooks }) =>
      hooks.some(({ command }) => command.includes("/.agents/setup")),
    ),
    "the SessionStart hook in .claude/settings.json runs .agents/setup",
  );
});
