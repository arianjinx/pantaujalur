import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const SKIP = new Set(["alchemy.run.ts", "src/routeTree.gen.ts"]);
const CODE = /\.(tsx?|jsx?|mjs|css)$/;
const HASH = /(\.(sh|ya?ml)$)|(^\.githooks\/)/;
const EM_DASH = "\u2014";
const DIRECTIVE =
  /^\s*(\/\/\/|\/\/\s*@(?:ts-|vite-|jsx)|\/\/\s*eslint-|\/\/\s*noinspection|\/\*\*?[\s*]*eslint-)/;

const files = Bun.spawnSync(["git", "ls-files", "-co", "--exclude-standard"], {
  cwd: root,
})
  .stdout.toString()
  .split("\n")
  .filter((file) => file && !file.startsWith(".github/") && !SKIP.has(file))
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

if (broken.length > 0) {
  console.log(broken.join("\n"));
  process.exit(1);
}
