import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const SKIP = new Set(["src/routeTree.gen.ts"]);
const CODE = /\.(tsx?|jsx?|mjs|css)$/;
const HASH = /(\.(sh|ya?ml|toml)$)|(^\.githooks\/)|(^\.agents\/setup$)/;
const EM_DASH = "\u2014";
const ALLOWED_MARKDOWN = new Set([
  "AGENTS.md",
  "README.md",
  "GOAL.md",
  "LOOP.md",
  "FRONTIER.md",
]);
const DIRECTIVE =
  /^\s*(\/\/\/|\/\/\s*@(?:ts-|vite-|jsx)|\/\/\s*eslint-|\/\/\s*noinspection|\/\*\*?[\s*]*eslint-)/;

const files = Bun.spawnSync(["git", "ls-files", "-co", "--exclude-standard"], {
  cwd: root,
})
  .stdout.toString()
  .split("\n")
  .filter((file) => file && !SKIP.has(file))
  .filter((file) => existsSync(join(root, file)));

const codeComment = (line: string) => {
  const text = line.trim();
  if (DIRECTIVE.test(text)) return false;
  if (/^(\/\/|\/\*|\*\/|\{\/\*|<!--)/.test(text)) return true;
  if (text.startsWith("* ") || text === "*") return true;
  const bare = text.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
  return /(^|[\s;,){}])\/\/(?!\/)/.test(bare) || /\/\*.*\*\//.test(bare);
};

const hashComment = (line: string, index: number) => {
  const text = line.trim();
  if (index === 0 && text.startsWith("#!")) return false;
  const bare = text.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
  return bare.startsWith("#") || /\s#\s/.test(bare);
};

const broken: string[] = [];
for (const file of files) {
  if (/^src\/domain\/.*\.test\.tsx?$/.test(file))
    broken.push(
      `${file}: scripts/frontier/geometry.ts is the check for the route geometry`,
    );
  if (file.startsWith("docs/"))
    broken.push(`${file}: no docs; the commit message is the record`);
  if (file.endsWith(".md") && !ALLOWED_MARKDOWN.has(file))
    broken.push(`${file}: no docs; the commit message is the record`);
  if (/(^|\/)CLAUDE\.md$/.test(file) || /(^|\/)SKILL\.md$/.test(file))
    broken.push(`${file}: no second instruction file and no skills`);
  if (
    file.startsWith(".agents/skills/") ||
    file.startsWith(".cursor/skills/") ||
    file.startsWith(".claude/skills/")
  )
    broken.push(`${file}: no skills`);
  const code = CODE.test(file);
  const hash = HASH.test(file);
  if (!code && !hash && !file.endsWith(".md")) continue;
  const lines = readFileSync(join(root, file), "utf8").split("\n");
  lines.forEach((line, index) => {
    if (line.includes(EM_DASH))
      broken.push(`${file}:${index + 1}: em dash; use a period or a comma`);
    if (code && codeComment(line))
      broken.push(`${file}:${index + 1}: comment; say it with a name`);
    if (hash && hashComment(line, index))
      broken.push(`${file}:${index + 1}: comment; say it with a name`);
  });
}

const read = (path: string) => readFileSync(join(root, path), "utf8");
const cursorInstall = JSON.parse(read(".cursor/environment.json")).install;
if (cursorInstall !== "bash .agents/setup")
  broken.push(".cursor/environment.json: install must stay bash .agents/setup");
const sessionStart = JSON.parse(read(".claude/settings.json")).hooks
  .SessionStart as { hooks: { command: string }[] }[];
if (
  !sessionStart.some(({ hooks }) =>
    hooks.some(({ command }) => command.includes("/.agents/setup")),
  )
)
  broken.push(".claude/settings.json: SessionStart must run .agents/setup");

if (broken.length > 0) {
  console.log(broken.join("\n"));
  process.exit(1);
}
