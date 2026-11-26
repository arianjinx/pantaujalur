# pantaujalur

A web app that shows the fastest driving route across Malang, Indonesia, and the public CCTV cameras along it.

**Status:** In use. It runs from a clone with `bun run dev`, and the owner deploys it to a Cloudflare Worker by hand. Public repository with one owner.

<img src=".github/route.jpg" alt="The route from Stasiun Malang to Jl. Kayutangan, with the 19 cameras along it" width="49%">
<img src=".github/wall.jpg" alt="The camera wall: one photo per camera, ordered along the route" width="49%">

See traffic before you leave. pantaujalur is an unofficial client of the city's public CCTV map at <https://cctv.malangkota.go.id/sebaran-cctv>. Maps come from OpenStreetMap, routes from OSRM, and place search from Nominatim. It needs no API key and no account.

## Quick start

You need [Bun](https://bun.sh) 1.4.4.

```sh
git clone https://github.com/arianjinx/pantaujalur.git
cd pantaujalur
bun install
bun run dev
```

Open <http://localhost:1337> and search for a start and a destination. You should see the fastest route on the map and the cameras along it in a list.

## Requirements

You need:

- [Bun](https://bun.sh) 1.4.4, the version that `package.json` pins in `packageManager`.
- a network the city answers. The city refuses some networks with `HTTP 403`. It refused Cloudflare's servers and a cloud Linux machine.
- Google Chrome, for the browser tests and the browser rungs of `scripts/score`.
- to deploy, a Cloudflare account and a machine with Docker that you reach over ssh and that the city accepts. See [Deploy](#deploy).

## Usage

1. Set the start under **From**. The app asks for your location and uses it. You can also type in **Search origin…**, or select **Pick on map** and tap the map.
2. Set the destination under **To** in the same way.
3. Read the route summary and the camera list. From Stasiun Malang to Universitas Brawijaya, the summary is `6.8 km · 9 min by car`, and the list is **Cameras along the route (40)**.
4. Change **within** to 50, 100 or 200 m to set how far from the route a camera can be. It starts at 100 m.
5. Select a camera in the list or on the map to watch it live.
6. Select **Watch all cameras on this route (40)** to open the wall: one photo per camera, ordered from your start to your destination. **▶ Live** on a tile plays that camera.

The wall shows photos, not video. A wall costs the city one playlist and one short segment per camera, not a stream per tile. It captures at most three photos at once, the visible page first. Photos stay in your browser's IndexedDB, so the wall shows them again at once after a reload. A photo is captured again when it is 15 minutes old, or when you tap it. A stream that has stopped shows its last photo under **Last seen**. A camera with no stream shows **No signal**, and the wall asks again after 5 minutes.

The app keeps your last eight trips under **Your trips**. You can save a place as Home, Work, School or a name of your own. Trips and saved places stay in your browser's `localStorage`.

`bun run e2e` drives the same trip in Chrome. Here is its output on 26 November 2026, with the screenshot lines and the player's details cut:

```text
ok - map rendered on the client
   origin: Stasiun Malang Bangunan Baru, Jalan Panglima Besar Sudirman, RW 07 KEL. KESATRIAN, KOTA MALANG
   destination: Universitas Brawijaya, Jalan Taman Cibogo, 06, Kel Penanggungan
ok - route found: 6.8 km · 9 min by car
ok - route polyline drawn on the map
ok - 40 cameras listed along the route
ok - 40 on-route cameras highlighted on the map
ok - camera #1 "Jl. Sudirman Arah Utara" plays: ...
ok - at least one camera on the route streamed live video
ok - no uncaught page errors
```

## How it works

The browser asks the app server for the cameras and the route. The server calls the city, OSRM and Nominatim. The map tiles come straight from OpenStreetMap:

```text
browser ──► app server (TanStack Start) ──► cctv.malangkota.go.id   camera list, HLS streams
   │                                    ──► OSRM, Nominatim          route, place search
   └──► OpenStreetMap tiles
```

## Known limits

Know these limits before you rely on the app:

- the city's endpoints are undocumented and can change without notice. Please keep the load low. The wall's photo design exists for that.
- many cameras are offline at any given time. That is on the city's side.
- OSRM (`router.project-osrm.org`) and Nominatim (`nominatim.openstreetmap.org`) are public demo servers with rate limits. Search waits for a 450 ms pause in your typing, because Nominatim allows one request a second.
- search can put the wrong place first. For "Stasiun Malang", the first result is Jalan Stasiun Blimbing, about 4 km from the station.
- cameras are matched by position, not by your direction of travel. A camera named "Arah Barat" (facing west) stays on the list for a road that runs north.
- the server keeps the camera list for 10 minutes and the city session for 50 minutes, in memory.

## Configuration

`bun run dev` needs no configuration. The app server reads these variables only for the relay and the deploy:

| Variable                | Default       | Required              | Meaning                                                                                             |
| ----------------------- | ------------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| `CCTV_UPSTREAM_URL`     | unset         | No                    | The relay's URL. When it is unset, the server calls the city directly                               |
| `CCTV_RELAY_SECRET`     | unset         | With the relay        | The secret the server sends to the relay in `x-relay-secret`. The relay needs 32 characters or more |
| `RELAY_HOSTNAME`        | unset         | With `RELAY_ZONE`     | Deploy only. The relay's public hostname, such as `cctv-relay.example.com`                          |
| `RELAY_ZONE`            | unset         | With `RELAY_HOSTNAME` | Deploy only. The Cloudflare zone of that hostname, such as `example.com`                            |
| `APP_DOMAIN`            | `workers.dev` | No                    | Deploy only. A custom domain for the app                                                            |
| `CLOUDFLARE_API_TOKEN`  | unset         | To deploy             | A Cloudflare API token. [Deploy](#deploy) lists its permissions                                     |
| `CLOUDFLARE_ACCOUNT_ID` | unset         | To deploy             | The Cloudflare account ID                                                                           |

In the prod deploy, the Worker gets `CCTV_UPSTREAM_URL` from `RELAY_HOSTNAME`.

<details>
<summary>Variables for the test and score scripts</summary>

| Variable            | Default                 | Meaning                                                                  |
| ------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `BASE_URL`          | `http://localhost:1337` | The app the browser tests and the score drive                            |
| `BROWSER_CHANNEL`   | `chrome`                | The Playwright browser channel. `chromium` uses Playwright's own browser |
| `ORIGIN_QUERY`      | `Stasiun Malang`        | The start that `e2e` and `e2e:wall` search for                           |
| `DESTINATION_QUERY` | `Universitas Brawijaya` | The destination that `e2e` and `e2e:wall` search for                     |
| `SCORE_UI`          | unset                   | `1` scores the states (R4) and the UI rules (R6)                         |
| `SCORE_FLOWS`       | unset                   | `1` scores the three e2e flows (R5)                                      |
| `SCORE_SPEED`       | unset                   | `1` scores Lighthouse speed (R7)                                         |
| `CHROME_PATH`       | the platform's Chrome   | The Chrome that Lighthouse uses                                          |

</details>

## Development

`bun install` also points git at the hooks in `.githooks`. The pre-commit hook formats the staged files. The pre-push hook runs `scripts/verify.sh`.

| Command               | What it does                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `bun run dev`         | Serves the app on <http://localhost:1337>, with the server code on workerd, the same runtime as production |
| `bun run test`        | Runs the unit tests in `src`, `scripts` and `relay`                                                        |
| `bun run typecheck`   | Runs `bun check -b`                                                                                        |
| `bun run lint`        | Runs `bun lint` and the format check. `bun run format` fixes what it can                                   |
| `bun run build`       | Builds the Worker into `dist/server` and the static files into `dist/client`                               |
| `bun run e2e`         | Drives the app in headless Chrome from a search to a playing camera                                        |
| `bun run e2e:wall`    | Drives the camera wall at desktop and phone sizes                                                          |
| `bun run e2e:places`  | Drives saved places and trips at phone size                                                                |
| `scripts/verify.sh`   | The gate: the repository rules, lint, typecheck, test and build. It ends with `verify: green`              |
| `scripts/score`       | Prints the score of each rung in `GOAL.md` as one JSON line. `--all` lists every failing case              |
| `bun run demo:record` | Records a walkthrough of the running app and edits it into a video with Remotion, in `video/`              |

The three e2e scripts need `bun run dev` running and a network the city accepts.

## Deploy

The app runs on a Cloudflare Worker, deployed with [Alchemy](https://alchemy.run). A deploy runs only by hand:

```sh
gh workflow run deploy.yml
```

The workflow runs lint, typecheck, test and build, checks the account's Alchemy state store version, then runs `alchemy deploy --stage prod`. It skips when `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` is unset, as in a fork.

The city answers `403` to Cloudflare, so the Worker cannot reach it directly. It goes through `relay/`, a small Bun server on a machine the city accepts, behind a Cloudflare Tunnel:

```text
Worker ──HTTPS──► relay hostname ──Cloudflare Tunnel──► cloudflared ──► relay:8080 ──► cctv.malangkota.go.id
```

The relay answers only requests that carry the shared secret, and forwards only the three city calls the app makes. `GET /healthz` needs no secret.

To set it up:

1. Make a Cloudflare API token. On the account, it needs Workers Scripts: Edit, Secrets Store: Edit and Cloudflare Tunnel: Edit. On the relay's zone, it needs Zone: Read and DNS: Edit.
2. Make a relay secret with `openssl rand -hex 32`.
3. Set these repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CCTV_RELAY_SECRET`, `RELAY_HOSTNAME`, `RELAY_ZONE`, and `APP_DOMAIN` if you want one. [Configuration](#configuration) says what each holds.
4. Run `gh workflow run deploy.yml`. The first deploy creates the Worker, the tunnel and the relay's DNS record.
5. Install the relay on your machine, with the same secret:

   ```sh
   RELAY_SSH_HOST=relay-box CCTV_RELAY_SECRET=<the relay secret> \
     CLOUDFLARE_API_TOKEN=<the token> CLOUDFLARE_ACCOUNT_ID=<the account ID> \
     bun run relay:deploy
   ```

   It copies `relay/` to `~/pantaujalur-relay` on the machine, writes its `.env` with mode 600, and starts the Compose project `pantaujalur-relay` with the `relay` and `cloudflared` services. Run it again after any change to `relay/`.

6. Open `https://<your app>/api/cameras`. It should list the cameras. A `502` answer says what failed. `HTTP 401` means the Worker's secret and the relay's secret differ.

## Troubleshooting

To check that your machine can reach the city, open <http://localhost:1337/api/cameras>. It returns a JSON list of about 251 cameras. If it answers `502` with `HTTP 403`, the city refuses your network, and the camera list in the app stays empty.

## Project structure

| Path             | What it holds                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `src/domain`     | `camerasAlongRoute`, which keeps the cameras near the route and orders them from the start |
| `src/flow`       | The XState machine for picking a start and a destination                                   |
| `src/places`     | Recent trips and saved places, in `localStorage`                                           |
| `src/server`     | The city session, the camera list, and OSRM and Nominatim calls                            |
| `src/routes`     | The home screen, `GET /api/cameras` and the stream proxy `GET /api/stream/{file}`          |
| `src/components` | The map, the camera list, the live player, and the wall with its photo queue               |
| `relay`          | The relay for a deployed Worker                                                            |
| `scripts`        | The e2e scripts, the gate, the relay installer, and the meter in `scripts/frontier`        |
| `testdata`       | Recorded routes, place searches, cameras and screen states that the score replays          |
| `video`          | The Remotion project for `bun run demo:record`                                             |

## Contributing

Report bugs and ask questions in [GitHub issues](https://github.com/arianjinx/pantaujalur/issues). Coding agents work in it by the rules in [AGENTS.md](AGENTS.md). Several agents work in it at the same time, so know these rules first:

- work on one folder, in your own worktree, and push to `main`.
- end each change with `git pull --rebase && scripts/verify.sh && git push`. `scripts/verify.sh` is the gate, and the pre-push hook runs it too.
- write commit messages as `type(scope): summary`, then why, with the commands and the numbers.
- ask the owner before a deploy, a deleted Cloudflare resource, or a force push.

Work climbs the ladder in [GOAL.md](GOAL.md), one step at a time as [LOOP.md](LOOP.md) describes, and [FRONTIER.md](FRONTIER.md) holds the current scores.

## License

[MIT](LICENSE), copyright 2026 pantaujalur contributors.
