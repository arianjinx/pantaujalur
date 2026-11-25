# Goal: the fastest driving route between two places in Malang, every public camera the buffer rules put on it, the place a person meant at the top of search, and a home screen that meets the UI and speed bars, with the wall inside its snapshot budget

pantaujalur climbs a ladder. Each rung has a number that only goes up, printed by `scripts/score`. A rung counts only when `scripts/verify.sh` passes on the same commit.

| Rung | Name         | Score (higher is better)                                                                                                                                                                                                                        | Frontier               |
| ---- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| R0   | Gate         | `scripts/verify.sh` passes: `scripts/rules.ts`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`                                                                                                                            | yes                    |
| R1   | Geometry     | probes on the six recorded OSRM trips, at the 50, 100 and 200 m buffers, where `camerasAlongRoute` agrees with the sphere reference within 1 m, and the kept list stays ordered along the route                                                 | every probe            |
| R2   | Place search | tracked queries whose first result is the recorded place                                                                                                                                                                                        | every query, 22        |
| R3   | City budget  | the six budget rules: 3 captures at once, a live frame again after 15 min, an ended stream again after 5 min, no `<video>` on the wall, one `STREAM_FILE` in the proxy and the relay, and that pattern's accept and reject list                 | 6 of 6                 |
| R4   | States       | states in `testdata/states.json` that open from `/?fixture=<id>` with `data-fixture` and their text, and no page error                                                                                                                          | every state, 12        |
| R5   | Flows        | `bun run e2e`, `bun run e2e:wall` (desktop and phone) and `bun run e2e:places` pass. Run with `SCORE_FLOWS=1`                                                                                                                                   | 3 of 3                 |
| R6   | UI rules     | checks on the home screen at 390×844 and 1440×900: named controls, 44×44 px targets, contrast 4.5:1 (3:1 for large text), no clipped text, no overflow, no overlapping controls, zoom allowed, one h1, and a dark scheme. Run with `SCORE_UI=1` | every check            |
| R8   | Direction    | cameras in `testdata/cameras.json` whose name states a compass facing and that lie within 100 m of a recorded trip, where the app keeps the ones facing within 45° of the direction of travel and drops the rest                                | every such camera, 166 |
| R7   | Speed        | Lighthouse mobile medians, three runs: performance, accessibility, best practices, SEO. Run with `SCORE_SPEED=1`                                                                                                                                | 90, 100, 100, 100      |
| R9   | Taste        | the operator signs off on the route, the wall and the player, phone and desktop                                                                                                                                                                 | the operator's yes     |

R1, R2, R3 and R8 run on every score, in a few seconds, with no network. R4 and R6 need the dev server and Chrome. R5 needs a network the city accepts. R7 needs the dev server, Chrome and three Lighthouse runs on a quiet machine. R9 is a person. Agents stop at R9 and hand the operator the route, the wall and the player.

Climb in order R0, R1, R2, R3, R4, R5, R6, R8, R7, then R9, the order of the table. The numbers are names, kept stable so FRONTIER.jsonl reads the same over time. A rung above an unmet one does not count. Speed comes after the screen is right. R9 is last because a person judges what the other rungs leave.

## Why each frontier can be reached

- **R1.** `camerasAlongRoute` says its equirectangular projection is accurate to well under a meter across a city. The reference is a different sum: chord lengths on a sphere of the same radius, 6,371,008.8 m. The six trips are real OSRM routes recorded on 2026-11-25, including the two the app already demonstrates (Stasiun Malang to Universitas Brawijaya, and Stasiun Malang to Jl. Kayutangan).
- **R2.** Each anchor is a place Nominatim already returns for that query, or for the place's ordinary name. "Stasiun Malang" is in the same response as "Jalan Stasiun", just not first. README.md names that miss. The four that miss today can be reordered or aliased, and the recording already holds each answer: Stasiun Malang, Stasiun Kota and Tugu Malang each have a result inside the radius in their own recorded response, and Kampus UB passes as an alias of "Universitas Brawijaya", whose response is recorded and whose first result is the main campus. So 22 of 22 needs no new recording. The eighteen that already hit stay as the guard.
- **R3.** The numbers are the ones in AGENTS.md and the queue. The current code already holds all six.
- **R4.** Each state is already a branch in `src/flow/route-flow-machine.ts` or `src/routes/index.tsx`. The three e2e scripts already walk the happy path on a network the city accepts. A fixture opens the same branch without the city.
- **R5.** The three scripts exist and are the flows a person takes. They pass on a network the city accepts. The cloud Linux machine of the first baseline is not one of those: the city answered HTTP 403. The operator's Mac is: on 2026-11-25 `bun run e2e` there found 40 cameras on Stasiun Malang to Universitas Brawijaya and played one live.
- **R6.** 44 px is the tap-target size in the UI ladder, and 4.5:1 is WCAG 2.2 AA. Both are bars shipping sites already meet. The home screen is the one that loads with no trip.
- **R7.** Lighthouse calls 90 performance "good". 100 on the other three does not depend on the machine the way performance does. A quiet page can hold them. The method for a later gain is in FRONTIER.md.
- **R8.** No reference has reached this one. It is a product rule: a kept camera faces the way the person is driving, within 45°. The city's own names state a facing (242 of the 251 recorded cameras say "Arah Utara" and the rest), and a corner often has one camera per direction, so the camera that shows the road ahead exists. README.md says the app matches by position only, so today it keeps all 166 and 52 of them agree. Whether "Arah Utara" names the way the lens points or the lane it watches is the operator's call. Ask before climbing this rung, and record the answer in the commit that starts it.
- **R9.** The operator is the answer key for the route, the wall and the player.

## How each rung is measured

- **R1.** `testdata/routes.json`, paths rounded to 6 decimal places. Along each trip, a probe every 500 m, seven offsets to the left of travel (0, 40, 70, 110, 160, 210, 400 m), plus one 150 m before the start and one 150 m after the end. A probe within 1 m of the buffer is not failed for membership. `first_fail` names the trip, the buffer and the probe.
- **R2.** `testdata/places.json` is the Nominatim response recorded on 2026-11-25 for the query shape `searchPlaces` uses now. The score plays that response back, so the number does not move when Nominatim does. A query passes when the first place is within `radius_m` of the anchor, and, where set, the label contains `label_has`. Changing the query shape without a new recording fails the query.
- **R3.** The score runs the queue with a fake capture and reads the two `STREAM_FILE` lines. It does not import a test.
- **R4 and R6.** `SCORE_UI=1`. States are `testdata/states.json`. UI rules cover the aside and the Leaflet controls, not map tiles. R6 has one check per visible control and text, so its total moves with the screen. Removing a control or a line of text to raise the share is a rejected attempt: compare the `--all` list of fails, not only the count.
- **The browser rungs measure the server on `BASE_URL`** (default http://localhost:1337), not the tree they run in. Start `bun run dev` from your own worktree, check that nothing else holds the port, and stop it after.
- **R5.** `SCORE_FLOWS=1`. The meter asks `BASE_URL/api/cameras` first. When the city refuses the list, R5 prints `unmeasured` with the answer it got, not a score of 0, and the flows do not run.
- **R7.** `SCORE_SPEED=1`. Median of three mobile runs of the pinned `lighthouse@13.6.0`, in the Chrome at `CHROME_PATH`, else the platform's Google Chrome. The meter refuses, and prints `unmeasured`, while the 1-minute load is over 80% of the cores, because a busy machine reads as a slow page. A gain later follows the speed method in FRONTIER.md.
- **R8.** `testdata/cameras.json` is `GET /api/cameras` recorded on 2026-11-25. Compass words, longest first: barat laut, barat daya, timur laut, tenggara, utara, selatan, timur, barat. Buffer 100 m, the buffer the home screen starts on. Which cameras lie within it, and where along the trip, comes from the R1 sphere reference, not from the app, so the total is fixed by the recording: a camera the app drops still counts. The direction of travel is the bearing of the trip's segment at that point. A case passes when the app keeps an agreeing camera or drops a disagreeing one. `first_fail` names the trip, the camera, its facing and the travel bearing.

An unmeasured rung is not a drop. Do not record one over a real number.

## What the meter cannot see yet

- **R9** is a person. No score stands in for it.
- **R5** runs only where the city answers `/api/cameras`, and it is one pass of three live scripts. A stream that stalls on a busy machine fails it once. Replay the failing script alone before working on its `first_fail`.
- **R8** prints a real number, but its frontier is a product rule that no reference has reached, and it waits on the operator's answer above.
- **R7** is a median of three runs on one machine. It tells where a page stands, not that a change made it faster. A gain needs the interleaved method in FRONTIER.md.
- Map tiles, the live player's picture and the wall's photos are outside R6. R9 judges them.

## Sources of truth

In order of trust:

1. The recorded routes in `testdata/routes.json`, and what the sphere reference computes for them.
2. The recorded Nominatim responses and anchors in `testdata/places.json`.
3. The budget in AGENTS.md: three captures, 15 minutes, 5 minutes, no video on the wall, one `STREAM_FILE`.
4. What the three e2e scripts do on a network the city accepts.
5. The code: `src/domain/cameras-along-route.ts`, `src/server/geo.ts`, `src/components/snapshotQueue.ts`.

Read a reference to see what right looks like. Never copy code from another project. An intended difference goes in the commit message, with the reason. Only the operator decides one.

## Out of scope

- Deploying, deleting a Cloudflare resource, and the relay machine. The operator does those. A deploy is `gh workflow run deploy.yml`, by hand.
- Replacing OSRM or Nominatim with a private server.
- A live player on every wall tile. One live player stays. A player per tile would hold a stream open per camera.
- Becoming an official client of the city.
