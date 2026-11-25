# Cursor cloud

Cursor cloud runs the `install` command in `.cursor/environment.json`:
`bash .agents/setup`. The script is idempotent. It installs the Bun version
pinned in `package.json` onto `/usr/local/bin` when that pin is missing, then
runs `bun install --frozen-lockfile`. It reads no secrets.
`scripts/harness.test.ts` requires `install` to stay `bash .agents/setup`.

The default VM runs that install and the checks below, so the environment file
sets only `install`. `bun test` and `bun run build` need no running service.

From the worktree root:

```sh
bash .agents/setup
bun test
bun run build
```

`bun test` is the verify command (`bun run test` runs the same files).
`bun run build` is the build. Lint, typecheck and the e2e scripts are listed
in [AGENTS.md](../AGENTS.md).

`bun test`, `bun run lint`, `bun run typecheck` and `bun run build` read no
secrets and do not call Cloudflare. `bun run dev` calls the city's CCTV
server, OSRM and Nominatim from this machine, also with no key. The city
refuses some networks. When `http://localhost:1337/api/cameras` answers 403,
the camera list stays empty. [README.md](../README.md) ("Run it") says how a
relay on an accepted network fixes that. Pointing the dev server at the relay
needs `CCTV_UPSTREAM_URL` and `CCTV_RELAY_SECRET`.

`bun run e2e` drives a server that is already on port 1337. It uses the
Google Chrome already on the default image (`BROWSER_CHANNEL` defaults to
`chrome`), so the install does not download Playwright's Chromium. When that
binary is missing, run `bunx playwright install chromium` and set
`BROWSER_CHANNEL=chromium`. On this network the city answers
`Could not open a CCTV session: HTTP 403`, so e2e draws the route and then
waits out the camera list. A playing camera needs a network the city accepts,
or the relay.

Deploy and `bun run relay:deploy` need `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `CCTV_RELAY_SECRET`, `RELAY_HOSTNAME` and
`RELAY_ZONE`. `APP_DOMAIN` is optional. `bun run relay:deploy` also needs
`RELAY_SSH_HOST`. [README.md](../README.md) ("Hosting on Cloudflare") lists
what each one is. Leave deploy to a person. A push to `main` deploys when
those secrets exist.

`video/` has its own install, and only `bun run demo:record` needs it.
`relay/Dockerfile` belongs on the relay machine.
