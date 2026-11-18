/**
 * Records a walkthrough of the live app, then edits it with Remotion (video/)
 * into a square, captioned MP4 for social feeds: pick a trip, get the route
 * and its cameras, watch them all on the wall from start to destination, and
 * play one live. Starts from an empty browser profile, so the wall captures
 * every snapshot on camera. A camera that will not play is cut, not faked.
 *
 *   bun run dev                   # in another terminal
 *   bun run demo:record           # BASE_URL defaults to http://localhost:1337
 *
 * The footage is real: Chrome's screencast of the app at 2x. Alongside it,
 * recordings/timeline.json says when each caption starts, which spans are
 * waits on the network (played 12x), and what the camera zooms to.
 *
 * ORIGIN_QUERY, ORIGIN_MATCH, DESTINATION_QUERY and DESTINATION_MATCH pick the
 * trip; the *_MATCH values choose among the search results. Needs ffmpeg.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Locator, type Page } from "playwright";

import type { Box, Timeline } from "../video/src/timeline";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1337";
const ORIGIN_QUERY = process.env.ORIGIN_QUERY ?? "Stasiun Malang Bangunan Baru";
const ORIGIN_MATCH = process.env.ORIGIN_MATCH ?? "Stasiun Malang Bangunan Baru";
const DESTINATION_QUERY = process.env.DESTINATION_QUERY ?? "Kayutangan";
const DESTINATION_MATCH = process.env.DESTINATION_MATCH ?? "Jl. Kayutangan";
const ROOT = join(import.meta.dir, "..");
const RECORDINGS = join(ROOT, "recordings");
const OUT_FILE = join(RECORDINGS, process.env.OUT_NAME ?? "demo.mp4");

/** The app's window: the 1080x880 area under the caption band, at 1.25x zoom. */
const VIEWPORT = { width: 864, height: 704 };
const SCALE = 2;
/** Near the station, for the automatic "my location" start. */
const GPS = { latitude: -7.9775, longitude: 112.6372 };

const timeline: Timeline = {
  viewport: VIEWPORT,
  totalS: 0,
  captions: [],
  waits: [],
  cuts: [],
  focus: [],
};
let recordingStart = 0;
const elapsedS = () => (Date.now() - recordingStart) / 1000;

/** A cursor dot, since the screencast does not show the real pointer. */
function cursorDot() {
  const install = () => {
    const cursor = document.createElement("div");
    cursor.style.cssText =
      "position:fixed;left:-40px;top:-40px;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:rgba(249,115,22,.6);border:2px solid #fff;z-index:2147483647;pointer-events:none;transition:transform .12s;box-shadow:0 0 0 1px rgba(0,0,0,.3)";
    document.body.append(cursor);
    window.addEventListener("mousemove", (e: MouseEvent) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
    });
    window.addEventListener("mousedown", () => {
      cursor.style.transform = "scale(.7)";
    });
    window.addEventListener("mouseup", () => {
      cursor.style.transform = "";
    });
  };
  if (document.body) install();
  else addEventListener("DOMContentLoaded", install);
}

/** Shows `title` (and `detail`) in the band from now until the next caption. */
function caption(title: string, detail?: string) {
  timeline.captions.push({ title, detail, at: elapsedS() });
  console.log(`${elapsedS().toFixed(1).padStart(6)} s  ${title}`);
}

/** Zooms the video onto the area the targets cover, or back out to the whole window. */
async function focus(...targets: Locator[]) {
  let box: Box | null = null;
  for (const target of targets) {
    const b = await target.boundingBox().catch(() => null);
    if (!b) continue;
    const x = b.x / VIEWPORT.width;
    const y = b.y / VIEWPORT.height;
    const right = (b.x + b.width) / VIEWPORT.width;
    const bottom = (b.y + b.height) / VIEWPORT.height;
    box = box
      ? {
          x: Math.min(box.x, x),
          y: Math.min(box.y, y),
          w: Math.max(box.x + box.w, right) - Math.min(box.x, x),
          h: Math.max(box.y + box.h, bottom) - Math.min(box.y, y),
        }
      : { x, y, w: right - x, h: bottom - y };
  }
  timeline.focus.push({ at: elapsedS(), box });
}

/** Runs a wait on the network that the video fast-forwards. */
async function fast<T>(work: () => Promise<T>): Promise<T> {
  const start = elapsedS();
  try {
    return await work();
  } finally {
    timeline.waits.push([start, elapsedS()]);
  }
}

/** Glides the cursor to the element and clicks it, so the video shows what was pressed. */
async function press(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("Nothing to click");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 15,
  });
  await page.waitForTimeout(150);
  await target.click();
}

function section(page: Page, field: "origin" | "destination") {
  return page.getByRole("region", {
    name: field === "origin" ? "From" : "To",
  });
}

async function choosePlace(
  page: Page,
  field: "origin" | "destination",
  query: string,
  match: string,
) {
  const input = page.getByLabel(`Search ${field}`);
  await press(page, input);
  await input.pressSequentially(query, { delay: 45 });
  const results = page.getByRole("listbox", { name: `${field} results` });
  const options = results.getByRole("option");
  await fast(() => options.first().waitFor({ timeout: 20_000 }));
  await focus(section(page, field), results);
  await page.waitForTimeout(700);
  const wanted = options.filter({ hasText: match }).first();
  await press(page, (await wanted.count()) ? wanted : options.first());
}

/** Waits until a live video's clock moves, or gives up after `timeoutMs`. */
async function waitForPlayback(page: Page, timeoutMs: number) {
  const video = page.getByTestId("camera-video");
  const deadline = Date.now() + timeoutMs;
  let start: number | null = null;
  while (Date.now() < deadline) {
    const t = await video
      .evaluate((v: HTMLVideoElement) =>
        v.readyState >= 2 ? v.currentTime : null,
      )
      .catch(() => null);
    if (t !== null && start === null) start = t;
    if (start !== null && t !== null && t > start + 0.3) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function wallSettled(page: Page, timeoutMs: number) {
  await page
    .waitForFunction(
      () =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '[data-active="true"] [data-testid="wall-tile"]',
          ),
        ].every((t) =>
          ["captured", "offline"].includes(t.dataset.snapshot ?? ""),
        ),
      null,
      { timeout: timeoutMs, polling: 250 },
    )
    .catch(() => {});
}

/** Opens a camera's live player and waits for it to play; a camera that does not play is cut from the video. */
async function watchLive(page: Page, liveButtons: Locator[]) {
  const player = page.getByRole("dialog", { name: /^Live camera/ });
  for (const button of liveButtons) {
    const tryStart = elapsedS();
    await press(page, button);
    await player.waitFor();
    await page.waitForTimeout(300);
    await focus(page.getByTestId("camera-video"));
    if (await fast(() => waitForPlayback(page, 25_000))) {
      await page.waitForTimeout(4000);
      await page.keyboard.press("Escape");
      return;
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await focus();
    timeline.cuts.push([tryStart, elapsedS()]);
  }
}

/** The active wall page's tiles: how many show a photo, and the streams still running. */
function wallPage(page: Page) {
  return page
    .locator('[data-active="true"] [data-testid="wall-tile"]')
    .evaluateAll((tiles) => ({
      photos: tiles.filter(
        (t) => (t as HTMLElement).dataset.snapshot === "captured",
      ).length,
      live: tiles
        .filter(
          (t) =>
            t.querySelector('[data-testid="wall-tile-status"]')?.textContent ===
            "Snapshot",
        )
        .map((t) => (t as HTMLElement).dataset.streamId ?? ""),
    }));
}

async function walkthrough(page: Page) {
  caption("PantauJalur", "Check the traffic on your route before you leave");
  await focus();
  await fast(async () => {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator(".leaflet-container").waitFor();
  });
  await page.mouse.move(VIEWPORT.width * 0.7, VIEWPORT.height / 2);
  await page.waitForTimeout(2500);

  caption("Pick where you're going", "From your GPS or any place in Malang");
  await focus(section(page, "origin"), section(page, "destination"));
  await choosePlace(page, "origin", ORIGIN_QUERY, ORIGIN_MATCH);
  await focus(section(page, "origin"), section(page, "destination"));
  await choosePlace(page, "destination", DESTINATION_QUERY, DESTINATION_MATCH);
  await focus();
  await fast(() =>
    page.getByTestId("route-summary").waitFor({ timeout: 30_000 }),
  );
  const cameraButtons = page.getByTestId("camera-list").getByRole("button");
  await fast(() => cameraButtons.first().waitFor({ timeout: 30_000 }));

  caption(
    "Get the fastest route",
    `…and the ${await cameraButtons.count()} city traffic cameras along it`,
  );
  await focus(page.locator(".leaflet-container"));
  await page.waitForTimeout(3500);
  await focus();

  caption("Watch them all at once", "From your start to your destination");
  await press(
    page,
    page.getByRole("button", { name: /^Watch all cameras on this route/ }),
  );
  await page.getByTestId("camera-wall").waitFor();
  await page.waitForTimeout(1500);

  // Page along the route toward the destination, then settle on the page with
  // the most to see. The wall captures the page on screen first, so each page
  // fills in while it is shown.
  caption(
    "Swipe toward your destination",
    "Nearest cameras first, farthest last",
  );
  const next = page.getByRole("button", { name: "Next page" });
  const pages = [await wallPage(page)];
  while (await next.isEnabled()) {
    await press(page, next);
    await fast(() => wallSettled(page, 45_000));
    await page.waitForTimeout(900);
    pages.push(await wallPage(page));
  }
  const best = pages.reduce(
    (bestIndex, p, i) =>
      p.live.length * 10 + p.photos >
      pages[bestIndex].live.length * 10 + pages[bestIndex].photos
        ? i
        : bestIndex,
    0,
  );
  for (let i = pages.length - 1; i > best; i--) {
    await press(page, page.getByRole("button", { name: "Previous page" }));
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);

  caption("Tap one to watch it live", "Straight from the city's CCTV");
  // The best page's running streams first, then the rest of the route's.
  const live = [
    ...new Set([
      ...(await wallPage(page)).live,
      ...pages.flatMap((p) => p.live),
    ]),
  ];
  await watchLive(
    page,
    live.map((id) =>
      page
        .locator(`[data-testid="wall-tile"][data-stream-id="${id}"]`)
        .getByRole("button", { name: /live/i }),
    ),
  );
  await focus();
  await page.waitForTimeout(1500);

  caption("PantauJalur", "Open source · run it yourself");
  await page.waitForTimeout(3500);
}

function run(cmd: string[], cwd = ROOT) {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "pipe" });
  if (result.exitCode !== 0)
    throw new Error(`${cmd.join(" ")}\n${result.stderr.toString()}`);
}

const frames = await mkdtemp(join(tmpdir(), "pantaujalur-frames-"));
try {
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    geolocation: GPS,
    permissions: ["geolocation"],
  });
  await context.addInitScript(cursorDot);
  const page = await context.newPage();

  // Chrome's screencast sends a JPEG whenever the page repaints, stamped with its time.
  const shots: { file: string; at: number }[] = [];
  const writes: Promise<void>[] = [];
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = join(frames, `${String(shots.length).padStart(6, "0")}.jpg`);
    shots.push({ file, at: (metadata.timestamp ?? Date.now() / 1000) * 1000 });
    writes.push(writeFile(file, Buffer.from(data, "base64")));
    void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  recordingStart = Date.now();
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 92,
    maxWidth: VIEWPORT.width * SCALE,
    maxHeight: VIEWPORT.height * SCALE,
  });
  try {
    await walkthrough(page);
  } finally {
    timeline.totalS = elapsedS();
    await cdp.send("Page.stopScreencast").catch(() => {});
    await browser.close();
    await Promise.all(writes);
  }

  // Each frame stays on screen until the next one: a constant 30 fps clip in recording time.
  const end = recordingStart + timeline.totalS * 1000;
  const list = shots.map((shot, i) => {
    const start = i === 0 ? recordingStart : shot.at;
    const until = shots[i + 1]?.at ?? end;
    return `file '${shot.file}'\nduration ${Math.max(0.001, (until - start) / 1000).toFixed(4)}`;
  });
  list.push(`file '${shots.at(-1)?.file}'`);
  await writeFile(join(frames, "list.txt"), `${list.join("\n")}\n`);
  run([
    "ffmpeg",
    "-y",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    join(frames, "list.txt"),
    "-vf",
    `fps=30,scale=${VIEWPORT.width * SCALE}:${VIEWPORT.height * SCALE}`,
    "-c:v",
    "libx264",
    "-crf",
    "14",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p",
    join(RECORDINGS, "raw.mp4"),
  ]);
  await writeFile(
    join(RECORDINGS, "timeline.json"),
    JSON.stringify(timeline, null, 2),
  );
  console.log(
    `recorded ${timeline.totalS.toFixed(1)} s in ${shots.length} frames`,
  );
} finally {
  await rm(frames, { recursive: true, force: true });
}

run(
  [
    "bunx",
    "remotion",
    "render",
    "src/index.ts",
    "Demo",
    OUT_FILE,
    "--public-dir",
    RECORDINGS,
    "--log",
    "error",
  ],
  join(ROOT, "video"),
);
console.log(OUT_FILE);
