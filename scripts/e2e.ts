import { join } from "node:path";

import { chromium, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1337";
const CHANNEL = process.env.BROWSER_CHANNEL ?? "chrome";
const ORIGIN_QUERY = process.env.ORIGIN_QUERY ?? "Stasiun Malang";
const DESTINATION_QUERY =
  process.env.DESTINATION_QUERY ?? "Universitas Brawijaya";
const MAX_CAMERAS_TO_TRY = 8;
const ROOT = join(import.meta.dir, "..");

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
  await firstResult.waitFor({ timeout: 15_000 });
  const label = await firstResult.innerText();
  await firstResult.click();
  console.log(`   ${field}: ${label}`);
}

async function waitForLiveVideo(page: Page, timeoutMs: number) {
  const video = page.getByTestId("camera-video");
  const deadline = Date.now() + timeoutMs;
  let first: { readyState: number; currentTime: number } | null = null;
  while (Date.now() < deadline) {
    const offline = await page
      .getByText(/offline right now|could not be loaded/)
      .count();
    if (offline > 0) return null;
    const sample = await video.evaluate((v: HTMLVideoElement) => ({
      readyState: v.readyState,
      currentTime: v.currentTime,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
    }));
    if (sample.readyState >= 2 && first === null) first = sample;
    if (first && sample.currentTime > first.currentTime + 1)
      return { first, latest: sample };
    await page.waitForTimeout(500);
  }
  return null;
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.locator(".leaflet-container").waitFor();
  check(true, "map rendered on the client");

  await choosePlace(page, "origin", ORIGIN_QUERY);
  await choosePlace(page, "destination", DESTINATION_QUERY);

  const summary = page.getByTestId("route-summary");
  await summary.waitFor({ timeout: 30_000 });
  check(true, `route found: ${await summary.innerText()}`);

  const routeLine = page.locator('path.leaflet-interactive[stroke="#2563eb"]');
  check((await routeLine.count()) === 1, "route polyline drawn on the map");

  const cameraButtons = page.getByTestId("camera-list").getByRole("button");
  await cameraButtons.first().waitFor({ timeout: 30_000 });
  const cameraCount = await cameraButtons.count();
  check(cameraCount > 0, `${cameraCount} cameras listed along the route`);
  const highlighted = await page
    .locator('path.leaflet-interactive[fill="#f97316"]')
    .count();
  check(
    highlighted === cameraCount,
    `${highlighted} on-route cameras highlighted on the map`,
  );

  await page.screenshot({ path: join(ROOT, "screenshot.png") });
  console.log(`   screenshot: ${join(ROOT, "screenshot.png")}`);

  let played = false;
  for (
    let i = 0;
    i < Math.min(cameraCount, MAX_CAMERAS_TO_TRY) && !played;
    i++
  ) {
    const name = (
      await cameraButtons.nth(i).locator("span.font-medium").innerText()
    ).trim();
    await cameraButtons.nth(i).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const evidence = await waitForLiveVideo(page, 25_000);
    if (evidence) {
      check(
        true,
        `camera #${i + 1} "${name}" plays: ${JSON.stringify(evidence)}`,
      );
      await page.screenshot({ path: join(ROOT, "screenshot-player.png") });
      console.log(`   screenshot: ${join(ROOT, "screenshot-player.png")}`);
      played = true;
    } else {
      console.log(
        `   camera #${i + 1} "${name}" did not play; trying the next one`,
      );
    }
    await dialog.getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "detached" });
  }
  check(played, "at least one camera on the route streamed live video");
  check(
    pageErrors.length === 0,
    `no uncaught page errors ${pageErrors.length ? JSON.stringify(pageErrors) : ""}`,
  );
} finally {
  await browser.close();
}
