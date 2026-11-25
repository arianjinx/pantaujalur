# Goal: the fastest driving route between two places in Malang, every public camera the buffer rules put on it, the place a person meant at the top of search, and a home screen that meets the UI and speed bars, with the wall inside its snapshot budget

pantaujalur climbs a ladder. Each rung has a number that only goes up, printed by `scripts/score`. A rung counts only when `scripts/verify.sh` passes on the same commit.

| Rung | Name         | Score (higher is better)                                                                                                                                                                                                                        | Frontier           |
| ---- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| R0   | Gate         | `scripts/verify.sh` passes: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`                                                                                                                                                | yes                |
| R1   | Geometry     | probes on the six recorded OSRM trips, at the 50, 100 and 200 m buffers, where `camerasAlongRoute` agrees with the sphere reference within 1 m, and the kept list stays ordered along the route                                                 | every probe        |
| R2   | Place search | tracked queries whose first result is the recorded place                                                                                                                                                                                        | every query, 22    |
| R3   | City budget  | the six budget rules: 3 captures at once, a live frame again after 15 min, an ended stream again after 5 min, no `<video>` on the wall, one `STREAM_FILE` in the proxy and the relay, and that pattern's accept and reject list                 | 6 of 6             |
| R4   | States       | states in `testdata/states.json` that open from `/?fixture=<id>` with `data-fixture` and their text, and no page error                                                                                                                          | every state, 12    |
| R5   | Flows        | `bun run e2e`, `bun run e2e:wall` (desktop and phone) and `bun run e2e:places` pass. Run with `SCORE_FLOWS=1`                                                                                                                                   | 3 of 3             |
| R6   | UI rules     | checks on the home screen at 390×844 and 1440×900: named controls, 44×44 px targets, contrast 4.5:1 (3:1 for large text), no clipped text, no overflow, no overlapping controls, zoom allowed, one h1, and a dark scheme. Run with `SCORE_UI=1` | every check        |
| R7   | Speed        | Lighthouse mobile medians, three runs: performance, accessibility, best practices, SEO. Run with `SCORE_SPEED=1`                                                                                                                                | 90, 100, 100, 100  |
| R8   | Direction    | kept cameras, at the 100 m buffer, whose name states a compass facing and whose facing is within 45° of the direction of travel. Needs `testdata/cameras.json`                                                                                  | every such camera  |
| R9   | Taste        | the operator signs off on the route, the wall and the player, phone and desktop                                                                                                                                                                 | the operator's yes |

R1, R2 and R3 run on every score, in about a second, with no network. R4 and R6 need the dev server and Chrome. R5 needs a network the city accepts. R7 needs the dev server and three Lighthouse runs. R8 waits on a recorded camera list. R9 is a person. Agents stop at R9 and hand the operator the route, the wall and the player.

Climb in order R0, R1, R2, R3, R4, R5, R6, R8, R7, then R9. A rung above an unmet one does not count. Speed comes after the screen is right. R9 is last because a person judges what the other rungs leave.

## Why each frontier can be reached

- **R1.** `camerasAlongRoute` says its equirectangular projection is accurate to well under a meter across a city. The reference is a different sum: chord lengths on a sphere of the same radius, 6,371,008.8 m. The six trips are real OSRM routes recorded on 2026-11-25, including the two the app already demonstrates (Stasiun Malang to Universitas Brawijaya, and Stasiun Malang to Jl. Kayutangan).
- **R2.** Each anchor is a place Nominatim already returns for that query, or for the place's ordinary name. "Stasiun Malang" is in the same response as "Jalan Stasiun", just not first. README.md names that miss. The four that miss today can be reordered or aliased. The eighteen that already hit stay as the guard.
- **R3.** The numbers are the ones in AGENTS.md and the queue. The current code already holds all six.
- **R4.** Each state is already a branch in `src/flow/route-flow-machine.ts` or `src/routes/index.tsx`. The three e2e scripts already walk the happy path on a network the city accepts. A fixture opens the same branch without the city.
- **R5.** The three scripts exist and are the flows a person takes. They pass on a network the city accepts. `docs/cursor-cloud.md` says this network is not one of those.
- **R6.** 44 px is the tap-target size in the UI ladder, and 4.5:1 is WCAG 2.2 AA. Both are bars shipping sites already meet. The home screen is the one that loads with no trip.
- **R7.** Lighthouse calls 90 performance "good". 100 on the other three does not depend on the machine the way performance does. A quiet page can hold them. The method for a later gain is in FRONTIER.md.
- **R8.** The city's own camera names state a facing ("Arah Utara" and the rest). The rule is that a kept camera faces the way the person is driving, within 45°. README.md says the app matches by position only. The rung waits until a camera list is recorded.
- **R9.** The screenshots in `docs/route.jpg` and `docs/wall.jpg` are the current look. The operator is the answer key.

## How each rung is measured

- **R1.** `testdata/routes.json`, paths rounded to 6 decimal places. Along each trip, a probe every 500 m, seven offsets to the left of travel (0, 40, 70, 110, 160, 210, 400 m), plus one 150 m before the start and one 150 m after the end. A probe within 1 m of the buffer is not failed for membership. `first_fail` names the trip, the buffer and the probe.
- **R2.** `testdata/places.json` is the Nominatim response recorded on 2026-11-25 for the query shape `searchPlaces` uses now. The score plays that response back, so the number does not move when Nominatim does. A query passes when the first place is within `radius_m` of the anchor, and, where set, the label contains `label_has`. Changing the query shape without a new recording fails the query.
- **R3.** The score runs the queue with a fake capture and reads the two `STREAM_FILE` lines. It does not import a test.
- **R4 and R6.** `SCORE_UI=1`. States are `testdata/states.json`. UI rules cover the aside and the Leaflet controls, not map tiles.
- **R5.** `SCORE_FLOWS=1`. A 403 from the city is not a score of 0. Leave the rung unmeasured and say so.
- **R7.** `SCORE_SPEED=1`. Median of three mobile runs. A gain later follows the speed method in FRONTIER.md.
- **R8.** Compass words, longest first: barat laut, barat daya, timur laut, tenggara, utara, selatan, timur, barat. Buffer 100 m, the buffer the home screen starts on.

An unmeasured rung is not a drop. Do not record one over a real number.

## Sources of truth

In order of trust:

1. The recorded routes in `testdata/routes.json`, and what the sphere reference computes for them.
2. The recorded Nominatim responses and anchors in `testdata/places.json`.
3. The budget in AGENTS.md: three captures, 15 minutes, 5 minutes, no video on the wall, one `STREAM_FILE`.
4. What the three e2e scripts do on a network the city accepts.
5. The code: `src/domain/cameras-along-route.ts`, `src/server/geo.ts`, `src/components/snapshotQueue.ts`.

Read a reference to see what right looks like. Never copy code from another project. Every intended difference goes in `docs/DEVIATIONS.md`, with the reason. Only the operator adds an entry.

## Out of scope

- Deploying, deleting a Cloudflare resource, and the relay machine. The operator does those. A push to main deploys.
- Replacing OSRM or Nominatim with a private server.
- A live player on every wall tile. See `docs/DEVIATIONS.md`.
- Becoming an official client of the city.
