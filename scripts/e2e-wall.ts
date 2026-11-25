import { join } from "node:path";

import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
  type Request,
} from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1337";
const CHANNEL = process.env.BROWSER_CHANNEL ?? "chrome";
const ORIGIN_QUERY = process.env.ORIGIN_QUERY ?? "Stasiun Malang";
const DESTINATION_QUERY =
  process.env.DESTINATION_QUERY ?? "Universitas Brawijaya";
const ROOT = join(import.meta.dir, "..");
const MAX_CAPTURES = 3;

const MAX_ATTEMPTS = 3;
const SNAPSHOT_TIMEOUT_MS = 60_000;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

async function choosePlace(
  page: Page,
  field: "origin" | "destination",
  text: string,
) {
  await page.getByLabel(`Search ${field}`).fill(text);

  const startsWithQuery = new RegExp(
    `^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "i",
  );
  const firstResult = page
    .getByRole("listbox", { name: `${field} results` })
    .getByRole("option")
    .filter({ hasText: startsWithQuery })
    .first();
  await firstResult.waitFor({ timeout: 20_000 });
  await firstResult.click();
}

async function planRoute(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.locator(".leaflet-container").waitFor();
  await choosePlace(page, "origin", ORIGIN_QUERY);
  await choosePlace(page, "destination", DESTINATION_QUERY);
  await page.getByTestId("route-summary").waitFor({ timeout: 30_000 });
  await page
    .getByTestId("camera-list")
    .getByRole("button")
    .first()
    .waitFor({ timeout: 30_000 });
}

type StreamRequest = {
  url: string;
  stream: string;
  playlist: boolean;
  start: number;
  end?: number;
  bytes: number;
  status?: number;

  ended?: boolean;
};

function watchStreams(page: Page) {
  const log: StreamRequest[] = [];
  const byRequest = new Map<Request, StreamRequest>();
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/stream/")) return;
    const file = path.slice("/api/stream/".length);
    const entry: StreamRequest = {
      url: path,
      stream: file.split(/[_.]/)[0],
      playlist: file.endsWith(".m3u8"),
      start: Date.now(),
      bytes: 0,
    };
    log.push(entry);
    byRequest.set(request, entry);
  });
  const finish = async (request: Request) => {
    const entry = byRequest.get(request);
    if (!entry) return;
    entry.end = Date.now();
    const response = await request.response();
    entry.status = response?.status();
    entry.bytes = (await request.sizes()).responseBodySize;
    if (entry.playlist && entry.status === 200)
      entry.ended = (await response?.text())?.includes("#EXT-X-ENDLIST");
  };
  page.on("requestfinished", (request) => void finish(request));
  page.on("requestfailed", (request) => {
    const entry = byRequest.get(request);
    if (entry) entry.end = Date.now();
  });
  return {
    since(mark: number) {
      const entries = log.slice(mark);
      return {
        entries,
        playlists: entries.filter((e) => e.playlist).length,
        segments: entries.filter((e) => !e.playlist).length,
        bytes: entries.reduce((n, e) => n + e.bytes, 0),
        streams: new Set(entries.map((e) => e.stream)).size,

        peak: peakOverlap(entries),
      };
    },
    mark: () => log.length,

    verdict(stream: string) {
      const last = log.filter((e) => e.playlist && e.stream === stream).pop();
      if (!last || last.status === undefined) return "unrequested";
      if (last.status !== 200) return `HTTP ${last.status}`;
      return last.ended ? "ended" : "live";
    },
  };
}

function peakOverlap(entries: StreamRequest[]) {
  const spans = new Map<string, { start: number; end: number }>();
  for (const e of entries) {
    const span = spans.get(e.stream);
    const end = e.end ?? Date.now();
    if (span) {
      span.start = Math.min(span.start, e.start);
      span.end = Math.max(span.end, end);
    } else spans.set(e.stream, { start: e.start, end });
  }

  const handoffMs = 100;
  const edges = [...spans]
    .flatMap(([stream, s]) => [
      { at: s.start, delta: 1, stream },
      { at: Math.max(s.start + 1, s.end - handoffMs), delta: -1, stream },
    ])
    .sort((a, b) => a.at - b.at || a.delta - b.delta);
  const open = new Set<string>();
  let peak: string[] = [];
  for (const edge of edges) {
    if (edge.delta > 0) open.add(edge.stream);
    else open.delete(edge.stream);
    if (open.size > peak.length) peak = [...open];
  }
  const origin = Math.min(...[...spans.values()].map((s) => s.start));
  return {
    count: peak.length,
    detail: peak
      .map((stream) => {
        const span = spans.get(stream);
        return span
          ? `${stream.slice(0, 6)} ${span.start - origin}-${span.end - origin} ms`
          : stream;
      })
      .join(", "),
  };
}

async function watchInFlight(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { maxInFlight: number };
    w.maxInFlight = 0;
    const read = () => {
      const wall = document.querySelector("[data-captures-in-flight]");
      const n = Number(wall?.getAttribute("data-captures-in-flight") ?? 0);
      w.maxInFlight = Math.max(w.maxInFlight, n);
    };
    new MutationObserver(read).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-captures-in-flight"],
    });
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { maxInFlight: number }).maxInFlight,
    );
}

type TileInfo = {
  order: number;
  stream: string;
  alongM: number;
  name: string;
  page: number;
  active: boolean;
  snapshot: string;
  capturedAt: string | null;
  image: { src: string; width: number } | null;
};

function readTiles(page: Page): Promise<TileInfo[]> {
  return page.getByTestId("wall-page").evaluateAll((pages) =>
    pages.flatMap((p, pageIndex) =>
      [...p.querySelectorAll<HTMLElement>('[data-testid="wall-tile"]')].map(
        (tile) => {
          const img = tile.querySelector<HTMLImageElement>(
            '[data-testid="wall-snapshot"]',
          );
          return {
            order: Number(tile.dataset.order),
            stream: tile.dataset.streamId ?? "",
            alongM: Number(tile.dataset.alongM),
            name: tile.querySelector(".font-semibold")?.textContent ?? "",
            page: pageIndex,
            active: p.dataset.active === "true",
            snapshot: tile.dataset.snapshot ?? "",
            capturedAt: tile.dataset.capturedAt ?? null,
            image: img ? { src: img.src, width: img.naturalWidth } : null,
          };
        },
      ),
    ),
  );
}

async function waitForActivePage(page: Page, index: number) {
  await page.waitForFunction(
    (i) =>
      document
        .querySelectorAll('[data-testid="wall-page"]')
        .item(i)
        ?.getAttribute("data-active") === "true",
    index,
    { timeout: 10_000 },
  );
}

async function waitForActivePageSettled(page: Page) {
  await page.waitForFunction(
    () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-active="true"] [data-testid="wall-tile"]',
        ),
      ].every((t) =>
        ["captured", "offline"].includes(t.dataset.snapshot ?? ""),
      ),
    null,
    { timeout: SNAPSHOT_TIMEOUT_MS, polling: 250 },
  );
}

async function waitForAllSettled(page: Page, total: number) {
  await page
    .getByTestId("wall-snapshot-progress")
    .filter({ hasText: `Snapshots ${total}/${total}` })
    .waitFor({ timeout: SNAPSHOT_TIMEOUT_MS * 3 });
}

async function waitForScrolledTo(page: Page, index: number) {
  await page.getByTestId("wall-scroller").evaluate(
    (el, i) =>
      new Promise<void>((resolve) => {
        const check = () =>
          Math.abs(el.scrollLeft - i * el.clientWidth) < 1
            ? resolve()
            : requestAnimationFrame(check);
        check();
      }),
    index,
  );
}

async function activePageIndex(page: Page) {
  return page
    .getByTestId("wall-page")
    .evaluateAll((pages) =>
      pages.findIndex((p) => p.dataset.active === "true"),
    );
}

function mostCaptured(tiles: TileInfo[]) {
  const counts = new Map<number, number>();
  for (const t of tiles)
    if (t.snapshot === "captured")
      counts.set(t.page, (counts.get(t.page) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

function countVideos(page: Page) {
  return page.evaluate(() => document.querySelectorAll("video").length);
}

function kb(bytes: number) {
  return `${(bytes / 1024).toFixed(0)} KiB`;
}

async function waitForLiveVideo(page: Page, timeoutMs: number) {
  const video = page.getByTestId("camera-video");
  const deadline = Date.now() + timeoutMs;
  let first: { readyState: number; currentTime: number } | null = null;
  while (Date.now() < deadline) {
    const sample = await video.evaluate((v: HTMLVideoElement) => ({
      readyState: v.readyState,
      currentTime: v.currentTime,
      videoWidth: v.videoWidth,
    }));
    if (sample.readyState >= 2 && first === null) first = sample;
    if (first && sample.currentTime > first.currentTime + 1)
      return { first, latest: sample };
    await page.waitForTimeout(500);
  }
  return null;
}

async function desktop(browser: Browser) {
  console.log("# desktop 1440x900");
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const streams = watchStreams(page);
  await planRoute(page);

  const listNames = await page
    .getByTestId("camera-list")
    .getByRole("button")
    .locator("span.font-medium")
    .allInnerTexts();
  const openButton = page.getByRole("button", {
    name: /^Watch all cameras on this route/,
  });
  check(
    (await openButton.innerText()).includes(`(${listNames.length})`),
    `button offers all ${listNames.length} cameras on the route`,
  );
  const maxInFlight = await watchInFlight(page);
  const openMark = streams.mark();
  const openedAt = Date.now();
  await openButton.click();

  const wall = page.getByTestId("camera-wall");
  await wall.waitFor();
  const coverage = await wall.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const probes = [
      [2, 2],
      [w - 2, 2],
      [w / 2, h / 2],
      [2, h - 2],
      [w - 2, h - 2],
    ];
    return {
      rect: [r.left, r.top, r.width, r.height],
      viewport: [w, h],
      probesInside: probes.every(([x, y]) =>
        el.contains(document.elementFromPoint(x, y)),
      ),
    };
  });
  check(
    coverage.rect.join() === `0,0,${coverage.viewport.join()}` &&
      coverage.probesInside,
    `wall covers the viewport ${JSON.stringify(coverage)}`,
  );

  let tiles = await readTiles(page);
  const pageSize = tiles.filter((t) => t.page === 0).length;
  const pageCount = Math.max(...tiles.map((t) => t.page)) + 1;
  const total = tiles.length;
  check(pageSize === 6, `desktop page holds 6 tiles (3x2), got ${pageSize}`);
  check(
    total === listNames.length,
    `wall has every camera on the route (${total})`,
  );
  check(
    tiles.every(
      (t, i) =>
        t.order === i + 1 && (i === 0 || t.alongM >= tiles[i - 1].alongM),
    ),
    "tiles run in ascending along-route order across pages, numbered like the list",
  );
  const firstPage = tiles.filter((t) => t.page === 0);
  check(
    firstPage.every((t) => t.active) &&
      firstPage.map((t) => t.name).join("|") ===
        listNames.slice(0, pageSize).join("|"),
    `page 1 shows the ${pageSize} cameras nearest the origin: ${firstPage.map((t) => `#${t.order} km ${(t.alongM / 1000).toFixed(2)}`).join(", ")}`,
  );

  await waitForActivePageSettled(page);
  const page1Ms = Date.now() - openedAt;
  tiles = await readTiles(page);
  const page1 = tiles.filter((t) => t.page === 0);
  console.log(
    `   page 1 after ${(page1Ms / 1000).toFixed(1)} s: ${page1.map((t) => `#${t.order} ${t.snapshot} (${streams.verdict(t.stream)})`).join(", ")}`,
  );
  check(
    page1.every((t) =>
      streams.verdict(t.stream) === "live" ||
      streams.verdict(t.stream) === "ended"
        ? t.snapshot === "captured" && (t.image?.width ?? 0) > 0
        : t.snapshot === "offline" && t.image === null,
    ),
    `page 1 settles in ${(page1Ms / 1000).toFixed(1)} s: every camera with a live or ended playlist shows a captured image, every camera still missing after its retries shows no signal`,
  );

  await waitForAllSettled(page, total);
  const allMs = Date.now() - openedAt;
  const open = streams.since(openMark);
  tiles = await readTiles(page);
  const verdicts = new Map<string, number>();
  for (const t of tiles) {
    const v = streams.verdict(t.stream);
    verdicts.set(v, (verdicts.get(v) ?? 0) + 1);
  }
  const captured = tiles.filter((t) => t.snapshot === "captured");
  console.log(
    `   one wall open: ${total} cameras in ${(allMs / 1000).toFixed(1)} s; playlists ${JSON.stringify(Object.fromEntries(verdicts))}; ${captured.length} captured, ${total - captured.length} offline`,
  );
  console.log(
    `   /api/stream/ for one wall open: ${open.playlists} playlists + ${open.segments} segments = ${kb(open.bytes)} (${open.bytes} bytes) over ${open.streams} streams`,
  );
  check(
    captured.length > 0 &&
      captured.every(
        (t) =>
          ["live", "ended"].includes(streams.verdict(t.stream)) &&
          t.image?.src.startsWith("blob:") &&
          t.capturedAt,
      ),
    `${captured.length} cameras show a captured blob: JPEG with its capture time, all from live or ended playlists`,
  );
  check(
    (await countVideos(page)) === 0,
    "no <video> element on the wall at rest",
  );
  check(
    open.playlists <= total * MAX_ATTEMPTS,
    `${open.playlists} playlist requests for ${total} cameras (at most ${MAX_ATTEMPTS} attempts each)`,
  );
  const peakInFlight = await maxInFlight();
  check(
    peakInFlight === MAX_CAPTURES && open.peak.count <= MAX_CAPTURES,
    `at most ${MAX_CAPTURES} captures at once: the wall reported ${peakInFlight}, the network saw ${open.peak.count} streams loading together (${open.peak.detail})`,
  );

  const pagingMark = streams.mark();
  await page.getByRole("button", { name: "Next page" }).click();
  await waitForActivePage(page, 1);
  const indicator2 = await page.getByTestId("wall-page-indicator").innerText();
  check(
    indicator2.startsWith(
      `Cameras ${pageSize + 1}–${pageSize * 2} of ${total}`,
    ),
    `Next button moves to page 2: ${indicator2}`,
  );
  await page.keyboard.press("ArrowRight");
  await waitForActivePage(page, 2);
  check(true, "ArrowRight moves to page 3");
  await page.keyboard.press("ArrowLeft");
  await waitForActivePage(page, 1);
  check(true, "ArrowLeft moves back to page 2");

  const dots = page
    .getByRole("navigation", { name: "Wall pages" })
    .getByRole("button");
  await dots.last().click();
  await waitForActivePage(page, pageCount - 1);
  const farthest = tiles.reduce((a, b) => (b.alongM > a.alongM ? b : a));
  const farthestTile = page.locator(
    `[data-testid="wall-tile"][data-order="${farthest.order}"]`,
  );
  const scroller = page.getByTestId("wall-scroller");
  await scroller.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        const atEnd = () =>
          Math.abs(el.scrollLeft - (el.scrollWidth - el.clientWidth)) < 1;
        if (atEnd()) return resolve();
        el.addEventListener("scroll", function onScroll() {
          if (!atEnd()) return;
          el.removeEventListener("scroll", onScroll);
          resolve();
        });
      }),
  );
  const box = await farthestTile.boundingBox();
  check(
    farthest.page === pageCount - 1 &&
      box !== null &&
      box.x >= 0 &&
      box.x + box.width <= 1440,
    `the last page dot shows the camera farthest along the route: #${farthest.order} "${farthest.name}" at km ${(farthest.alongM / 1000).toFixed(2)}`,
  );
  check(
    streams.since(pagingMark).playlists === 0,
    "paging captures nothing new; snapshots refresh only on request",
  );

  const showcase = mostCaptured(tiles);
  await dots.nth(showcase).click();
  await waitForActivePage(page, showcase);
  await waitForScrolledTo(page, showcase);
  await page.screenshot({ path: join(ROOT, "screenshot-wall.png") });
  console.log(
    `   screenshot of page ${showcase + 1}: ${join(ROOT, "screenshot-wall.png")}`,
  );
  const times = await page
    .locator('[data-active="true"] [data-testid="wall-tile-time"]')
    .allInnerTexts();
  check(
    times.length > 0 &&
      times.every((t) => /^\d\d:\d\d:\d\d · (just now|\d+ min ago)$/.test(t)),
    `timestamp badges read like "${times[0]}"`,
  );

  const capturedTile = captured.find((t) => t.page === showcase);
  check(capturedTile, `page ${showcase + 1} has a captured tile to refresh`);
  const tile = page.locator(
    `[data-testid="wall-tile"][data-order="${capturedTile.order}"]`,
  );
  const refreshMark = streams.mark();
  await tile.getByRole("button", { name: /^Refresh the snapshot/ }).click();
  const during = await tile.evaluate((el) => ({
    snapshot: el.dataset.snapshot,
    image: el.querySelector("img")?.getAttribute("src"),
  }));
  check(
    (during.snapshot === "capturing" || during.snapshot === "pending") &&
      during.image === capturedTile.image?.src,
    `clicking tile #${capturedTile.order} shows "${during.snapshot}" over the old frame`,
  );
  await page.waitForFunction(
    (order) =>
      ["captured", "offline"].includes(
        document.querySelector<HTMLElement>(
          `[data-testid="wall-tile"][data-order="${order}"]`,
        )?.dataset.snapshot ?? "",
      ),
    capturedTile.order,
    { timeout: 40_000 },
  );
  const after = (await readTiles(page)).find(
    (t) => t.order === capturedTile.order,
  );
  check(
    after?.snapshot === "captured" &&
      after.capturedAt !== null &&
      capturedTile.capturedAt !== null &&
      after.capturedAt > capturedTile.capturedAt &&
      after.image?.src !== capturedTile.image?.src &&
      (after.image?.width ?? 0) > 0,
    `the refresh lands a newer frame: ${capturedTile.capturedAt} -> ${after?.capturedAt}`,
  );
  const refresh = streams.since(refreshMark);
  console.log(
    `   one tile refresh: ${refresh.playlists} playlist + ${refresh.segments} segments = ${kb(refresh.bytes)}`,
  );

  await tile.getByRole("button", { name: /^Watch camera .* live/ }).click();
  const player = page.getByRole("dialog", { name: /^Live camera/ });
  await player.waitFor();
  check(
    await wall.isVisible(),
    "the Live button opens the player over the wall",
  );
  const evidence = await waitForLiveVideo(page, 25_000);
  check(evidence, `the live player plays ${JSON.stringify(evidence)}`);
  await page.keyboard.press("Escape");
  await player.waitFor({ state: "detached" });
  check(
    (await wall.isVisible()) &&
      (await activePageIndex(page)) === showcase &&
      (await countVideos(page)) === 0,
    "Escape closes the player and returns to the same wall page, with no <video> left",
  );

  const cached = (await readTiles(page)).filter(
    (t) => t.snapshot === "captured",
  );
  const cachedStreams = new Set(cached.map((t) => t.stream));
  const reopen = async (label: string) => {
    const mark = streams.mark();
    const openedAt = Date.now();
    await openButton.click();
    await wall.waitFor();
    await page.waitForFunction(
      (orders) =>
        orders.every((order) => {
          const tile = document.querySelector<HTMLElement>(
            `[data-testid="wall-tile"][data-order="${order}"]`,
          );
          const img = tile?.querySelector("img");
          return tile?.dataset.snapshot === "captured" && img?.complete;
        }),
      cached.map((t) => t.order),
      { timeout: 5000, polling: 50 },
    );
    const shownMs = Date.now() - openedAt;
    const shownTiles = await readTiles(page);
    await waitForAllSettled(page, total);
    const cost = streams.since(mark);
    const forCached = cost.entries.filter(
      (e) => e.playlist && cachedStreams.has(e.stream),
    ).length;
    console.log(
      `   ${label}: ${cost.playlists} playlists + ${cost.segments} segments = ${kb(cost.bytes)} (${cost.bytes} bytes); the ${total - cachedStreams.size} offline cameras wait out their 5 minutes`,
    );
    check(
      forCached === 0 &&
        cost.playlists === 0 &&
        shownMs < 2000 &&
        cached.every(
          (t) =>
            shownTiles.find((s) => s.order === t.order)?.capturedAt ===
            t.capturedAt,
        ),
      `${label}: all ${cached.length} cached frames show in ${shownMs} ms, with the same capture times, and ${cost.playlists} playlist requests in total`,
    );
    return cost;
  };

  await page.keyboard.press("Escape");
  await wall.waitFor({ state: "detached" });
  await reopen("reopen");
  await page.keyboard.press("Escape");
  await wall.waitFor({ state: "detached" });

  await page.reload({ waitUntil: "networkidle" });
  await planRoute(page);
  const maxInFlightAfterReload = await watchInFlight(page);
  await reopen("after a page reload");

  const refreshAllMark = streams.mark();
  await page.getByRole("button", { name: "Refresh all" }).click();
  const progress = await page.getByTestId("wall-snapshot-progress").innerText();
  check(
    progress !== `Snapshots ${total}/${total}`,
    `Refresh all restarts the count: ${progress}`,
  );
  await waitForAllSettled(page, total);
  const again = streams.since(refreshAllMark);
  check(
    (await maxInFlightAfterReload()) === MAX_CAPTURES &&
      again.peak.count <= MAX_CAPTURES &&
      again.playlists <= total * MAX_ATTEMPTS,
    `Refresh all recaptures every camera through the same throttle: ${again.playlists} playlists + ${again.segments} segments = ${kb(again.bytes)}, peak ${again.peak.count} streams (${again.peak.detail})`,
  );

  await page.keyboard.press("Escape");
  await wall.waitFor({ state: "detached" });
  check(
    await page.getByTestId("route-summary").isVisible(),
    "Escape closes the wall and the route stays",
  );
  check(
    pageErrors.length === 0,
    `no uncaught page errors ${pageErrors.length ? JSON.stringify(pageErrors) : ""}`,
  );
  await context.close();
}

async function swipeLeft(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.synthesizeScrollGesture", {
    x: 300,
    y: 400,
    xDistance: -240,
    yDistance: 0,
    gestureSourceType: "touch",
    speed: 1200,
  });
}

async function phone(browser: Browser) {
  console.log("# phone 390x844");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const streams = watchStreams(page);
  await page.clock.install();
  await planRoute(page);
  const openButton = page.getByRole("button", {
    name: /^Watch all cameras on this route/,
  });
  await openButton.click();
  const wall = page.getByTestId("camera-wall");
  await wall.waitFor();

  const tiles = await readTiles(page);
  const phonePageSize = tiles.filter((t) => t.page === 0).length;
  check(
    phonePageSize === 3,
    `three stacked tiles per page on a tall phone, got ${phonePageSize}`,
  );
  const pageWidth = await page
    .getByTestId("wall-page")
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);
  check(pageWidth === 390, `a page is one viewport wide (${pageWidth}px)`);

  await swipeLeft(context, page);
  await waitForActivePage(page, 1);
  const phoneIndicator = await page
    .getByTestId("wall-page-indicator")
    .innerText();
  check(
    phoneIndicator.startsWith(
      `Cameras ${phonePageSize + 1}–${phonePageSize * 2} of ${tiles.length}`,
    ),
    `a touch swipe left snaps to page 2: ${phoneIndicator}`,
  );

  const dots = page
    .getByRole("navigation", { name: "Wall pages" })
    .getByRole("button");
  const jumpTo = Math.min(5, Math.floor((tiles.length - 1) / phonePageSize));
  const jumpMark = streams.mark();

  const startedBefore = new Set(
    await page.evaluate((index) => {
      const started = [
        ...document.querySelectorAll<HTMLElement>('[data-testid="wall-tile"]'),
      ]
        .filter((t) => t.dataset.snapshot !== "pending")
        .map((t) => t.dataset.streamId ?? "");
      const dots = document.querySelectorAll<HTMLElement>(
        'nav[aria-label="Wall pages"] button',
      );
      dots[index].click();
      return started;
    }, jumpTo),
  );
  await waitForActivePage(page, jumpTo);
  await waitForActivePageSettled(page);
  const target = tiles.filter((t) => t.page === jumpTo).map((t) => t.stream);
  const startedAfter = [
    ...new Set(
      streams
        .since(jumpMark)
        .entries.map((e) => e.stream)
        .filter((id) => !startedBefore.has(id)),
    ),
  ];
  const expected = target.filter((id) => !startedBefore.has(id));
  check(
    expected.length > 0 &&
      startedAfter.slice(0, expected.length).join() === expected.join(),
    `jumping to page ${jumpTo + 1} captures its ${expected.length} waiting cameras next, ahead of the pages before it`,
  );

  await waitForAllSettled(page, tiles.length);
  const showcase = mostCaptured(await readTiles(page));
  await dots.nth(showcase).click();
  await waitForActivePage(page, showcase);
  await waitForScrolledTo(page, showcase);
  await page.screenshot({ path: join(ROOT, "screenshot-wall-phone.png") });
  console.log(
    `   screenshot of page ${showcase + 1}: ${join(ROOT, "screenshot-wall-phone.png")}`,
  );
  check(
    (await countVideos(page)) === 0,
    "no <video> element on the phone wall at rest",
  );

  await page.getByRole("button", { name: "Close" }).click();
  await wall.waitFor({ state: "detached" });
  check(true, "Close button closes the wall");

  await openButton.click();
  await wall.waitFor();
  await waitForAllSettled(page, tiles.length);
  const before = (await readTiles(page)).filter(
    (t) => t.snapshot === "captured",
  );
  const staleMark = streams.mark();
  await page.clock.fastForward("16:00");
  await page
    .getByTestId("wall-tile-status")
    .filter({ hasText: "Stale" })
    .first()
    .waitFor({ timeout: 5000 });
  const staleBadges = await page
    .getByTestId("wall-tile-status")
    .filter({ hasText: "Stale" })
    .count();
  await waitForAllSettled(page, tiles.length);
  const recaptured = streams.since(staleMark);
  const afterStale = await readTiles(page);
  const renewed = before.filter((t) => {
    const now = afterStale.find((a) => a.order === t.order);
    return (
      now?.capturedAt &&
      t.capturedAt &&
      Date.parse(now.capturedAt) - Date.parse(t.capturedAt) >= 15 * 60_000
    );
  });
  check(
    staleBadges > 0 &&
      before.every((t) =>
        recaptured.entries.some((e) => e.playlist && e.stream === t.stream),
      ) &&
      renewed.length > 0,
    `16 minutes later, the open wall marks ${staleBadges} frames "Stale" and asks for all ${before.length} again; ${renewed.length} came back newer (${recaptured.playlists} playlists, ${kb(recaptured.bytes)})`,
  );
  await page.getByRole("button", { name: "Close" }).click();
  await wall.waitFor({ state: "detached" });

  check(
    pageErrors.length === 0,
    `no uncaught page errors ${pageErrors.length ? JSON.stringify(pageErrors) : ""}`,
  );
  await context.close();
}

async function edgeCases(browser: Browser) {
  console.log("# phone, fresh storage: abort on close, and a proxy that fails");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const streams = watchStreams(page);
  await planRoute(page);
  const openButton = page.getByRole("button", {
    name: /^Watch all cameras on this route/,
  });
  const wall = page.getByTestId("camera-wall");

  await openButton.click();
  await wall.waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-captures-in-flight]")
        ?.getAttribute("data-captures-in-flight") === "3",
  );
  await page.getByRole("button", { name: "Close" }).click();
  await wall.waitFor({ state: "detached" });
  const closedMark = streams.mark();
  await page.waitForTimeout(3000);
  const afterClose = streams.since(closedMark);
  check(
    afterClose.entries.length === 0,
    `closing the wall mid-capture aborts the queue: ${afterClose.entries.length} stream requests in the 3 s after close`,
  );

  await page.route("**/api/stream/**", (route) =>
    route.fulfill({
      status: 502,
      body: "Could not open a CCTV session: HTTP 403, server cloudflare",
    }),
  );
  await openButton.click();
  await wall.waitFor();
  await waitForActivePageSettled(page);
  const failed = (await readTiles(page)).filter((t) => t.active);
  const unavailable = await page
    .locator('[data-active="true"] [data-testid="wall-tile"]')
    .getByTestId("wall-tile-status")
    .filter({ hasText: "No signal" })
    .count();
  check(
    failed.every((t) => t.snapshot === "offline") &&
      unavailable === failed.length,
    `a proxy answering 502 leaves every tile at "No signal" after its retries, with no spinner: ${failed.map((t) => `#${t.order} ${t.snapshot}`).join(", ")}`,
  );
  await page.unroute("**/api/stream/**");
  await page.getByRole("button", { name: "Close" }).click();
  await wall.waitFor({ state: "detached" });

  check(
    pageErrors.length === 0,
    `no uncaught page errors ${pageErrors.length ? JSON.stringify(pageErrors) : ""}`,
  );
  await context.close();
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true });
try {
  await desktop(browser);
  await phone(browser);
  await edgeCases(browser);
} finally {
  await browser.close();
}
