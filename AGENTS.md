# AGENTS.md

pantaujalur shows the fastest driving route between two points in Malang, and
the city's public CCTV cameras along it. Many agents work on it at once, so
every rule here keeps main green.

```sh
bun install
bun run dev            # http://localhost:1337, no Cloudflare account
bun run format
scripts/verify.sh      # the gate
scripts/score          # every rung of GOAL.md
```

## Work

- Follow `LOOP.md` toward `GOAL.md`. The score is the only measure of progress.
- Own one folder. Never edit a folder another agent owns.
- Work in your own worktree. End every slice with
  `git pull --rebase && scripts/verify.sh && git push` on your branch. Do not
  push to main. A deploy is `gh workflow run deploy.yml`, by hand.
- Small slices. End every session with nothing unpushed.
- The commit message is the record: `type(scope): summary`, then why, with the
  commands and the numbers.
- No plan, status or extra docs. No skills. No second instruction file.
- Never silence a check. Fix the code, not the check.

## Code

- No comments. Say it with a name. `scripts/rules.ts` fails the gate on one.
- No em dash.
- Server code runs on workerd. Web APIs only. A module-level cache holds data,
  never a pending promise.
- The stream proxy fetches only names that match `STREAM_FILE`. Never widen it.
- The wall shows snapshots, at most three captures at once. A live frame is
  taken again after 15 minutes, an ended or offline one after 5. Never a
  `<video>` per tile.
- Tests compare against the reference, or pin a bug the meter does not cover.
  `src/domain` has no unit tests. The geometry meter covers it.
- A new dependency says in its commit what it replaces and why.
- Account ids and domains come from the environment. The Worker is declared
  only in `alchemy.run.ts`.
- A change to `relay/` is installed with `bun run relay:deploy`, on that
  machine only.

## Secrets

- Never read, print or commit `.env`, `.env.*`, `.dev.vars`, or a Cloudflare
  token.
- Ask the operator before a deploy, deleting a Cloudflare resource, or a force
  push.

## Cursor Cloud

When you run as a Cursor cloud agent, read `docs/cursor-cloud.md` first.
