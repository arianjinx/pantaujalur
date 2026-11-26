# Frontier

The current score for each rung, then the evidence for every step, newest first. FRONTIER.jsonl holds the same steps as one JSON line each, including rejected attempts.

| Rung | Name         | Score                                                           | Frontier                                     | Commit  |
| ---- | ------------ | --------------------------------------------------------------- | -------------------------------------------- | ------- |
| R0   | Gate         | yes                                                             | yes                                          | 55bd8ac |
| R1   | Geometry     | 1881/1881 (max error 0.0116 m offset, 0.0688 m along)           | every probe                                  | 55bd8ac |
| R2   | Place search | 18/22                                                           | 22/22                                        | 55bd8ac |
| R3   | City budget  | 6/6                                                             | 6/6                                          | 55bd8ac |
| R4   | States       | 0/12                                                            | 12/12                                        | 55bd8ac |
| R5   | Flows        | 2/3 (a different script failed in each of two runs, under load) | 3/3                                          | 55bd8ac |
| R6   | UI rules     | 58/77                                                           | every check                                  | 55bd8ac |
| R8   | Direction    | 52/166 (every camera kept, the 114 facing away too)             | 166/166, once the operator confirms the rule | 55bd8ac |
| R7   | Speed        | 50, 100, 92, 91 (1 of 4 at the bar)                             | 90, 100, 100, 100                            | 55bd8ac |
| R9   | Taste        | manual                                                          | the operator's yes                           | 55bd8ac |

The scaffold commit is the one that adds this file. `scripts/score` printed `3e4a05a+dirty` because the ledger was not committed yet. The measured tree is that commit's tree. The swarm remeasure at `8ef982e` is on `origin/cursor/swarm-frontier-ac5c`; main squashed it into `fc1d2b9`, whose `src`, `relay` and `testdata` are the same.

## Speed method

A speed number counts only when measured this way:

- Same machine, idle host. The first baseline was Linux 6.12, 4 cores, load 0.66, Chrome, Lighthouse's mobile simulation. The 2026-11-25 review baseline was a 10-core Mac, load 6.06, Chrome 158, `lighthouse@13.6.0`. The meter refuses a run while the 1-minute load is over 80% of the cores.
- The ceiling is 100 in every category. Lighthouse scores no higher.
- Baseline and candidate run interleaved (A B, B A, A B, …), at least 6 pairs. A single median of 3, as here, is the baseline, not a claim that a change is faster.
- Report the median and a paired 95% confidence interval for the change. Accept only if the whole interval is a gain and no other rung drops by more than 3%.
- Record the exact command, both commits, and the hardware.

## Evidence

### 2026-11-25 frontier review remeasure

- Commands, on `55bd8ac` with a clean tree and `bun run dev` from the same worktree: `scripts/verify.sh`, then `SCORE_UI=1 SCORE_FLOWS=1 SCORE_SPEED=1 scripts/score --all` (66 s), then `SCORE_SPEED=1 scripts/score --no-gate` once the load fell. Machine: `darwin 27.2.0`, 10 cores, other sessions running beside it (load 13.3 at the first run, 6.06 at the Lighthouse runs).
- R0: yes. `bun run lint` clean, `bun check` clean, `bun test` 77 pass and 0 fail (88 at the first baseline, before the swarm pass cut the tests the meter covers), the build finished, `verify: green`.
- R1: 1881/1881, unchanged. R2: 18/22, the same four misses. R3: 6/6.
- R4: 0/12, `first-visit: no data-fixture`. R6: 58/77, the same 19 fails as the first baseline: the dark scheme and 18 targets under 44 px.
- R5: 2/3, measured for the first time. This Mac's dev server got the city's list (`GET /api/cameras` 200, 251 cameras). In the review run `e2e:wall` failed: `page 1 settles in 41.6 s: every camera with a live or ended playlist shows a captured image, every camera still missing after its retries shows no signal`. In an earlier run on the uncommitted tree, `e2e` failed instead, and `bun run e2e` alone then passed in 7.6 s, with 40 cameras on Stasiun Malang to Universitas Brawijaya and one playing live. Both failures came at a load of 10 to 14.
- R7: performance 50, accessibility 100, best practices 92, SEO 91, the same in all three runs. 1 of 4 at the bar. The first try was refused at a load of 8.51 on 10 cores, as the meter now does.
- R8: 52/166, measured for the first time from `testdata/cameras.json` (251 cameras, 242 naming a facing). 166 trip and camera pairs lie within 100 m by the sphere reference. The app keeps all of them, and 52 face within 45° of travel. `first_fail`: `stasiun-ub: kept Jl. Semeru Arah Barat, it faces 270° and the route there travels 352°`.
- R9: manual.
- Not verified: R8's rule itself, which waits on the operator; R7 on the built Worker; R5 on a quiet machine.

### 2026-11-25 swarm remeasure

- Command: `scripts/verify.sh`, then `scripts/score --no-gate`. Commit `8ef982e`. Machine: `cursor linux 6.12.113+`, load 0.57.
- R0: `scripts/verify.sh` exited 0 and printed `verify: green`. The score run used `--no-gate`, so its R0 field is `skipped` and is not the gate result.
- R1: 1881/1881. `first_fail` empty. Max offset 0.011594200691916967 m, max along 0.06884625218481233 m.
- R2: 18/22. `first_fail`: Stasiun Malang, first is "Jalan Stasiun Blimbing, Purwodadi, Kota Malang, Blimbing", 4196 m from Stasiun Malang on Jalan Trunojoyo, not Jalan Stasiun, and the label does not contain "Stasiun Malang".
- R3: 6/6. `first_fail` empty.
- Not remeasured: R4, R5, R6, R7, R8. R9 stays manual.

### 2026-11-25 scaffold baseline

- Command: `scripts/verify.sh`, then `SCORE_UI=1 SCORE_SPEED=1 scripts/score` with `bun run dev` on http://localhost:1337. Machine: `cursor linux 6.12.113+`, 4 cores, load 0.66 at the Lighthouse runs.
- Gate: `scripts/verify.sh` exited 0. Lint reported no problems, the format check passed, `bun check` reported no type errors, `bun test` reported 88 pass and 0 fail, the build finished, and the last line was `verify: green`.
- R1: 1881/1881. Largest gap to the sphere reference was 0.0116 m of offset and 0.0688 m along.
- R2: 18/22. The four misses, from the recorded Nominatim responses:
  - Stasiun Malang: first is Jalan Stasiun Blimbing, 4196 m from the station, and the label does not contain "Stasiun Malang".
  - Stasiun Kota: the same street, 4196 m away.
  - Tugu Malang: Jalan Tugu in the kabupaten, 4753 m from Jalan Tugu in the city.
  - Kampus UB: Stadion UB at campus 2, 3116 m from the main campus. That campus is not in the five recorded hits, so reordering this response cannot pass it.
- R3: 6/6.
- R4: 0/12. `/?fixture=first-visit` renders the home screen and does not set `data-fixture`.
- R5: unmeasured. `GET /api/cameras` answered 502 with `Could not open a CCTV session: HTTP 403, server nginx, no cookies`. The flows were not run, and this is not a score of 0.
- R6: 58/77 on the home screen, location permission denied, camera list showing that error. Phone 390×844 and desktop 1440×900. Contrast, accessible names, overflow, clipped text and overlap passed. The dark scheme did not (body stayed `rgb(255, 255, 255)`, luminance 1.00). Eighteen targets are under 44 px: "Use my location" 108×26, "Pick on map" 87×26, the two search fields about 360×38, Leaflet zoom 30×30, and the attribution links 51×14 and 85×14, each at both sizes.
- R7: median of three mobile Lighthouse runs. Performance 48, 49, 48, median 48. Accessibility 100. Best practices 92. SEO 91. One of four categories is at the bar. A run that scored 47, beside these three, reported LCP 65.6 s, speed index 24.4 s, total blocking time 720 ms, first contentful paint 1.2 s, a favicon 404, images served below their displayed size, and no meta description.
- R8: unmeasured. There is no `testdata/cameras.json`. The city session call returned HTTP 403, so the list was not recorded.
- R9: manual.
- Not verified: the three person flows, a recorded camera list, and the operator's eye. Map tiles are outside the R6 contrast and target checks.
