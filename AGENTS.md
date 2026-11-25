# AGENTS.md

pantaujalur shows the fastest driving route between two points in Malang, and
the city's public CCTV cameras along it. Many agents work on it at once, so
every rule here keeps main green.

```sh
bun install
bun run dev
bun run format
scripts/verify.sh
scripts/score
```

`bun run dev` serves http://localhost:1337 with no Cloudflare account. A deploy
is `gh workflow run deploy.yml`, by hand.

## Work

- Follow `LOOP.md` toward `GOAL.md`. The score is the only measure of progress.
- Own one folder. Never edit a folder another agent owns.
- Work in your own worktree. End every slice with
  `git pull --rebase && scripts/verify.sh && git push` to main.
- Keep slices small. End every session with nothing unpushed.
- The commit message is the record: `type(scope): summary`, then why, with the
  commands and the numbers.
- No plan, status or extra docs. No skills. No second instruction file.
- Never silence a check. Fix the code, not the check.

## Code

- No comments. Say it with a name. The gate fails on one.
- No em dash. Server code runs on workerd. Web APIs only.
- The wall shows snapshots, at most three at once. The stream proxy fetches
  only names that match `STREAM_FILE`.
- Tests compare against the reference, replay a recorded input, or pin a found
  bug. The gate refuses a new test file that is not allowlisted.
- A new dependency says in its commit what it replaces and why. Exact pins.
- Never read, print or commit `.env`, `.env.*`, `.dev.vars`, or a Cloudflare
  token. Ask before a deploy, a deleted Cloudflare resource, or a force push.
