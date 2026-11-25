# LOOP: one hill-climb iteration

Repeat until every rung in GOAL.md is at its frontier.

1. **Measure.** `git pull --rebase`, then `scripts/score --no-gate > /tmp/score.json`. Add `SCORE_UI=1` when `bun run dev` is up, `SCORE_SPEED=1` for R7, and `SCORE_FLOWS=1` only on a network the city accepts. Compare it with the last lines of FRONTIER.jsonl. `--all` lists every failing case, not only the first. An unmeasured rung is not a drop.
2. **Pick the lowest rung below its frontier that your folder can move.** Work on the `first_fail` the score names. Skip anything FRONTIER.jsonl already rejected, unless you have a new reason.
3. **Find the cause, not the symptom.** For R1, compare the probe with the sphere reference in `scripts/frontier/geometry.ts`. For R2, read the recorded response in `testdata/places.json` and the anchor. For R3, read the queue and `STREAM_FILE`. For R4, open `/?fixture=<id>`. For R6, the failing check names the control. For R8, the camera name and the bearing. Do not guess.
4. **Fix it with a check that fails before and passes after.** Use the recorded input. Compare against the reference, not against a copy of this code. A new state in R4 is a fixture, not a test that restates the component. Do not edit `scripts/frontier` to make a number go up.
5. **Gate.** `scripts/verify.sh` passes. Never silence a check or weaken a test: change the code until it passes.
6. **Prove it went up.** Score again. If any measured rung went down, revert. For R7, follow the speed method in FRONTIER.md.
7. **Record and push.** Append one line to FRONTIER.jsonl and update the table in FRONTIER.md. Commit with `type(scope): summary`. Name the rung, the old score, the new score and the cause. Then `git pull --rebase && scripts/verify.sh && git push` on your own branch.

Do not push to main. The operator merges. A deploy is `gh workflow run deploy.yml`, by hand.

Log a rejected attempt too, with `"accepted": false` and the numbers, so no one retries it.

## Folders

Give each agent one folder, and never two agents one folder.

| Folder                                                           | Rungs it moves                                                                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/domain`                                                     | R1, and R8 once `testdata/cameras.json` exists                                                                               |
| `src/server`                                                     | R2. The stream proxy's `STREAM_FILE` is the R3 pattern. `relay/` must stay equal to it. Ask the lead before editing `relay/` |
| `src/components`                                                 | R3 (the queue and the wall) and R6                                                                                           |
| `src/routes`, `src/flow`, `src/places`                           | R4, and the product behavior R5 drives                                                                                       |
| `scripts/e2e.ts`, `scripts/e2e-wall.ts`, `scripts/e2e-places.ts` | R5                                                                                                                           |

`scripts/frontier` is the meter. Nobody edits it to pass. R7 belongs to whoever owns the file the profile names. `testdata/` and the frontier files are shared.

## Working beside other agents

- Own one folder. Never edit a folder another agent owns. Ask the lead instead.
- Work in your own git worktree. Rebase before every push. On a conflict in someone else's change, keep theirs and redo yours on top.
- Everyone appends FRONTIER.jsonl. `.gitattributes` merges it by keeping both sides. In FRONTIER.md, keep both sides by hand.
- Keep slices small and push often. Unpushed work is lost when an agent dies.
- One browser run at a time on a machine (R4, R6, R7, and R5). R7 is three Lighthouse runs. Do not run it beside a build.
- City flows (R5, and recording R8) run only where `cctv.malangkota.go.id` answers. A 403 stays unmeasured.
- End every session with nothing unpushed, and stop the dev server you started.
