import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const COOLDOWN_SECONDS = 3 * 24 * 60 * 60;
const EXACT = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const SHA = /^[0-9a-f]{40}$/;
const RUNNER = /\b(?:bunx|npx(?: -y)?|bun x)\s+(?:--\S+\s+)*"?([@\w./$-]+)/g;
const SPLIT_RUNNER = /"bunx",\s*(?:"--[\w-]+",\s*)*"([^"]+)"/g;
const PACKAGES = [".", "video"];
const SCANNED_FOLDERS = ["scripts", "scripts/frontier", "relay"];
const WORKFLOWS = ".github/workflows";
const HOOKS = ".githooks";

type Check = { name: string; failures: string[] };
type PackageJson = Record<string, Record<string, string> | string | undefined>;

const read = (file: string) => readFileSync(join(root, file), "utf8");
const manifest = (dir: string) =>
  JSON.parse(read(join(dir, "package.json"))) as PackageJson;
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

function declared(dir: string): Map<string, string> {
  const all = new Map<string, string>();
  const pkg = manifest(dir);
  for (const field of dependencyFields) {
    const group = pkg[field];
    if (typeof group !== "object") continue;
    for (const [name, spec] of Object.entries(group)) all.set(name, spec);
  }
  return all;
}

function exactVersions(): Check {
  const failures = PACKAGES.flatMap((dir) =>
    [...declared(dir)]
      .filter(([, spec]) => !EXACT.test(spec))
      .map(([name, spec]) => `${dir}: ${name} is "${spec}", not exact`),
  );
  return { name: "exact versions in package.json", failures };
}

function registryOnly(): Check {
  const failures = PACKAGES.flatMap((dir) => {
    const lock = read(join(dir, "bun.lock"));
    const entries = lock
      .slice(lock.indexOf('"packages": {'))
      .split("\n")
      .filter((line) => /^ {4}"[^"]+": \[/.test(line));
    if (!entries.length) return [`${dir}/bun.lock lists no packages`];
    return entries
      .filter((line) => !/"sha512-[\w+/=]+"\]?,?$/.test(line.trim()))
      .map((line) => `${dir}: ${line.trim().slice(0, 120)}`);
  });
  return { name: "every locked package comes from the registry", failures };
}

function bunfig(): Check {
  const failures = PACKAGES.flatMap((dir) => {
    const file = join(dir, "bunfig.toml");
    if (!existsSync(join(root, file))) return [`${file} is missing`];
    const install = read(file)
      .split(/^\[/m)
      .find((s) => s.startsWith("install]"));
    const age = Number(install?.match(/^minimumReleaseAge\s*=\s*(\d+)/m)?.[1]);
    const found: string[] = [];
    if (!(age >= COOLDOWN_SECONDS))
      found.push(
        `${file} [install] minimumReleaseAge is ${Number.isNaN(age) ? "unset" : age}, want ${COOLDOWN_SECONDS} or more`,
      );
    if (!/^exact\s*=\s*true/m.test(install ?? ""))
      found.push(`${file} [install] exact is not true`);
    return found;
  });
  return { name: "Bun waits out the cooldown and pins what it adds", failures };
}

function workflowFiles(): string[] {
  return readdirSync(join(root, WORKFLOWS))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => join(WORKFLOWS, f));
}

function workflows(): Check[] {
  const frozen: string[] = [];
  const pinned: string[] = [];
  for (const file of workflowFiles()) {
    for (const [n, line] of read(file).split("\n").entries()) {
      const at = `${file}:${n + 1}`;
      if (/\b(bun|npm|pnpm|yarn) (install|i|ci)\b/.test(line)) {
        if (!/bun install --frozen-lockfile/.test(line))
          frozen.push(`${at} installs without --frozen-lockfile`);
      }
      const uses = line.match(/^\s*-?\s*uses:\s*([^\s#]+)/)?.[1];
      if (uses && !uses.startsWith("./")) {
        const ref = uses.split("@")[1] ?? "";
        if (!SHA.test(ref)) pinned.push(`${at} uses ${uses}, not a commit SHA`);
      }
      if (/bun-version:\s*(latest|canary)/.test(line))
        pinned.push(`${at} sets up Bun ${line.trim()}`);
    }
  }
  return [
    { name: "CI installs from the frozen lockfile", failures: frozen },
    { name: "every action is pinned by commit SHA", failures: pinned },
  ];
}

function installScripts(): Check {
  const failures = PACKAGES.flatMap((dir) => {
    const trusted = manifest(dir).trustedDependencies;
    return Array.isArray(trusted) && trusted.length
      ? [`${dir}: trustedDependencies lets ${trusted.join(", ")} run scripts`]
      : [];
  });
  return { name: "no dependency runs an install script", failures };
}

function listed(folder: string, keep: (file: string) => boolean): string[] {
  if (!existsSync(join(root, folder))) return [];
  return readdirSync(join(root, folder))
    .filter(keep)
    .map((f) => join(folder, f));
}

function runnerSources(): string[] {
  const code = (f: string) => /\.(ts|sh)$/.test(f) && f !== "supply.ts";
  return [
    ...PACKAGES.map((dir) => join(dir, "package.json")),
    ...SCANNED_FOLDERS.flatMap((folder) => listed(folder, code)),
    ...workflowFiles(),
    ...listed(HOOKS, () => true),
  ];
}

function runnerTarget(name: string): string | undefined {
  if (name.startsWith("-") || name.startsWith("$")) return undefined;
  const at = name.lastIndexOf("@");
  return at > 0 ? name.slice(at + 1) : "";
}

function pinnedRunners(): Check {
  const installed = new Set(
    PACKAGES.flatMap((dir) => [...declared(dir).keys()]),
  );
  const failures: string[] = [];
  for (const file of runnerSources()) {
    const text = read(file);
    const names = [
      ...text.matchAll(RUNNER),
      ...text.matchAll(SPLIT_RUNNER),
    ].map((m) => m[1] ?? "");
    for (const name of new Set(names)) {
      const version = runnerTarget(name);
      if (version === undefined) continue;
      if (version && EXACT.test(version)) continue;
      if (!version && installed.has(name)) continue;
      failures.push(
        `${file} runs ${name}, which is neither installed nor an exact version`,
      );
    }
  }
  return { name: "bunx and npx run only pinned packages", failures };
}

function bunVersion(): Check {
  const manager = String(manifest(".").packageManager ?? "");
  const version = manager.match(/^bun@(.+)$/)?.[1] ?? "";
  return {
    name: "Bun itself is an exact version",
    failures: EXACT.test(version)
      ? []
      : [`packageManager is "${manager}", not bun@<exact>`],
  };
}

function bunOutput(dir: string, args: string[]) {
  const run = Bun.spawnSync({
    cmd: ["bun", ...args],
    cwd: join(root, dir),
    stderr: "pipe",
  });
  return run.stdout.toString();
}

function fresh(): Check {
  const failures = PACKAGES.flatMap((dir) => {
    const out = bunOutput(dir, ["outdated"]);
    if (!out.includes("bun outdated"))
      return [`${dir}: bun outdated printed nothing: offline?`];
    return out.split("\n").flatMap((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      const [name = "", current = "", , latest = ""] = cells.slice(1);
      const newest = latest.replace(/\s*\*$/, "");
      if (!name || name === "Package" || !/^\d/.test(current)) return [];
      if (newest === current) return [];
      return [
        `${dir}: ${name.replace(/ \(dev\)$/, "")} is ${current}, ${newest} is out`,
      ];
    });
  });
  return {
    name: "every dependency is on its newest release past the cooldown",
    failures,
  };
}

function advisories(): Check {
  const name = "no installed package has a known advisory";
  const failures = PACKAGES.flatMap((dir) => {
    const out = bunOutput(dir, ["audit", "--json"]);
    try {
      const found = JSON.parse(out || "{}") as Record<
        string,
        { severity: string; title: string }[]
      >;
      return Object.entries(found).flatMap(([pkg, list]) =>
        list.map((a) => `${dir}: ${pkg}: ${a.severity}, ${a.title}`),
      );
    } catch {
      return [`${dir}: bun audit printed no JSON: ${out.slice(0, 80)}`];
    }
  });
  return { name, failures };
}

const online = process.argv.includes("--online");
const checks = [
  ...(online ? [fresh(), advisories()] : []),
  exactVersions(),
  registryOnly(),
  bunfig(),
  ...workflows(),
  installScripts(),
  pinnedRunners(),
  bunVersion(),
];
for (const { name, failures } of checks) {
  console.log(`${failures.length ? "fail" : "pass"}  ${name}`);
  for (const failure of failures) console.log(`      ${failure}`);
}
process.exit(checks.every((c) => c.failures.length === 0) ? 0 : 1);
