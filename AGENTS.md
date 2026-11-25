# AGENTS.md

pantaujalur shows the fastest driving route between two points in Malang,
Indonesia, and the city's public CCTV cameras along it. It deploys to a
Cloudflare Worker with Alchemy.

Read `README.md` for how the app works, the upstream endpoints, and why a
deployed Worker reaches the city through the relay in `relay/`.

## Rules

- Never read, print or commit a secrets file, such as `.env`, `.env.*` or
  `.dev.vars`, or the Cloudflare token.
- Never use the em dash. Write a period or a comma instead.
- Server code runs in workerd, locally and in production. Use Web-standard APIs
  only (`fetch`, `Headers.getSetCookie()`, `FormData`, streams), never a Node
  API that workerd lacks. `bun run dev` runs server code on workerd.
- Share only resolved values across requests. Workers cancel a promise that
  another, finished request started, so a module-level cache holds data, never a
  pending promise. `src/server/cctv-session.ts` and `src/server/cctv-cameras.ts`
  show the pattern.
- The stream proxy fetches only names that match `STREAM_FILE` in
  `src/routes/api/stream/$file.ts`. Never widen it to arbitrary upstream paths.
- The camera wall shows snapshots, never a live player per tile, so it does not
  hammer the city's server. Every capture goes through the queue in
  `src/components/snapshotQueue.ts`, which runs at most three at once and
  captures a camera again only when its frame is over 15 minutes old (5 for an
  offline or stopped camera) or the user asks. `bun run e2e:wall` fails when the wall mounts a
  `<video>` or runs more than three captures.
- `alchemy.run.ts` declares the `pantaujalur` Worker, the relay's tunnel and
  its DNS record. Change infrastructure there and nowhere else. Account ids and
  domains come from the environment, never from the code.
- Ask the operator before you deploy, delete a Cloudflare resource, or force
  push.

## Commands

- `bun run dev` serves the app with Vite, server code on workerd, at
  <http://localhost:1337>. It touches no Cloudflare account.
- `bun run test` runs every `*.test.ts` in `src`, `scripts` and `relay`. Run it before a
  commit.
- `bun run typecheck` runs `bun check -b` over `tsconfig.app.json` (`src`) and
  `tsconfig.node.json` (`alchemy.run.ts`, `vite.config.ts`, `scripts`).
- `bun run lint` runs `lint:code`, which is `bun lint` with its recommended
  rules and no warnings allowed, then `bun fmt --check`. Stable Bun 1.4.4 has no
  `bun lint`, so `lint:code` and `lint:fix` run it from a pinned canary through
  `bun x`. Move them to plain `bun lint` once a stable release ships it.
- `bun run format` runs `lint:fix`, then `bun fmt` with its defaults plus the
  import and Tailwind class sorting in `bunfig.toml`. The pre-commit hook does
  the same for staged files and refuses a file that is only partly staged.
- `bun run build` runs `vite build`, which leaves the Worker in `dist/server`
  and the static files in `dist/client`.
- `bun run e2e` drives `bun run dev` in headless Chrome from a search to a
  playing camera and writes `screenshot.png`. `bun run e2e:wall` drives the
  camera wall at desktop and phone sizes, prints the stream requests and bytes
  one wall open costs, and writes `screenshot-wall*.png`.
  `bun run e2e:places` drives the saved trips loop at phone size and writes
  `screenshot-places.png`.
- `bun run demo:record` records the running app (real footage, Chrome's
  screencast at 2x) and edits it with Remotion in `video/` into a square,
  captioned `recordings/demo.mp4` for social feeds. Run `bun install` in
  `video/` first. After changing only the edit (`video/src`), run
  `bun run render` in `video/` to re-render from the saved
  `recordings/raw.mp4` and `recordings/timeline.json`.

## Deploys

GitHub Actions deploys every push to `main` with
`bunx alchemy deploy --stage prod --yes` (`.github/workflows/deploy.yml`) when
the repo has the Cloudflare secrets README.md lists, so do not run
`bun run deploy` after a merge. Only the `prod` stage deploys. Any other stage
runs only under `alchemy dev`, and `alchemy.run.ts` stops otherwise, because
the Worker name is the live one.

The stack keeps its state in the account's shared `alchemy-state-store`
Worker. The workflow refuses a deploy that would move that store to another
version.

The city refuses Cloudflare's IPs, so a deployed Worker calls it through the
relay in `relay/` (README.md, "Hosting on Cloudflare"). A deploy does not
update the relay machine. After a change to `relay/`, or after the first
deploy creates the tunnel, run `bun run relay:deploy`. On that machine, touch
only `~/pantaujalur-relay` and the Compose project `pantaujalur-relay`.

## Agent harnesses

Each thing an agent needs has one home that every harness reads. Edit the home.
A harness folder only points at it.

| What         | Home                             | How each harness gets it                                                                                                                                                    |
| ------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instructions | `AGENTS.md`                      | Amp, Cursor and Codex read it. Claude Code reads it because the repo has no `CLAUDE.md`                                                                                     |
| Skills       | `.agents/skills/<name>/SKILL.md` | Amp and Cursor read it. Add a `.claude/skills` symlink to `../.agents/skills` with the first skill, for Claude Code                                                         |
| Cloud setup  | `.agents/setup`                  | Amp runs it for each new orb. `.cursor/environment.json` runs it as the Cursor cloud install. The SessionStart hook in `.claude/settings.json` runs it in Claude Code cloud |

`.agents/setup` installs the Bun pinned in `packageManager` and runs
`bun install --frozen-lockfile`. `scripts/harness.test.ts`, part of
`bun run test`, fails when a `CLAUDE.md` exists, when a `SKILL.md` sits outside
`.agents/skills/`, or when the Cursor install or the Claude hook stops running
`.agents/setup`. Claude Code's `/init` and `#` memory write a `CLAUDE.md`, and
Cursor's `/create-skill` writes to `.cursor/skills/`. Move what they write into
`AGENTS.md` or `.agents/skills/` and delete their copy.

## Repeated mistakes

When the same correction happens twice, encode it so the next change fails
closed. Prefer structure over prose: one owner in the code, then a type, then a
lint or a test whose failure names the fix. A sentence in this file is for a
judgment call, and it names the command that enforces it.

## Handoff

Bots gather context. Agents write code on a branch and run `bun run lint`,
`bun run typecheck`, `bun run test` and `bun run build` before opening a pull
request, plus `bun run e2e` against `bun run dev` for a change a user can see. A
human approves every merge and anything public, including a deploy.

## Cursor Cloud specific instructions

When you run as a Cursor cloud agent, read `docs/cursor-cloud.md` first.
It holds the install command, the verify command and the secrets notes.
