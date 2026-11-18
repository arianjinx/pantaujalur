import { join } from "node:path";

/**
 * Drives the saved-places loop at phone size in a headless browser: plan a
 * trip, save its ends as "Home" and "Work", reload, then take the trip again
 * with one tap on the "Home → Work" chip.
 *
 *   bun dev                       # in another terminal (alchemy dev, workerd)
 *   bun run e2e:places            # BASE_URL defaults to http://localhost:1337
 *
 * Uses the installed Google Chrome by default; set BROWSER_CHANNEL=chromium to
 * use Playwright's bundled browser instead.
 */
import { chromium, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:1337";
const CHANNEL = process.env.BROWSER_CHANNEL ?? "chrome";
const ORIGIN_QUERY = "Stasiun Malang";
const DESTINATION_QUERY = "Universitas Brawijaya";
const SCREENSHOT = join(import.meta.dir, "..", "screenshot-places.png");

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
  // Nominatim can rank a street that merely contains the words first ("Jalan Stasiun ...").
  const firstResult = page
    .getByRole("listbox", { name: `${field} results` })
    .getByRole("option")
    .filter({ hasText: new RegExp(`^${text}`, "i") })
    .first();
  await firstResult.waitFor({ timeout: 15_000 });
  console.log(`   ${field}: ${await firstResult.innerText()}`);
  await firstResult.click();
}

async function saveAs(
  page: Page,
  field: "origin" | "destination",
  name: string,
) {
  const section = page.getByRole("region", {
    name: field === "origin" ? "From" : "To",
  });
  await section.getByRole("button", { name: `Save ${field} as…` }).click();
  await section
    .getByRole("form", { name: `Save ${field}` })
    .getByRole("button", { name, exact: true })
    .click();
  await section.getByTestId("saved-name").filter({ hasText: name }).waitFor();
  check(true, `${field} saved as "${name}"`);
}

async function expectRouteWithCameras(page: Page) {
  const summary = page.getByTestId("route-summary");
  await summary.waitFor({ timeout: 30_000 });
  const routeLine = page.locator('path.leaflet-interactive[stroke="#2563eb"]');
  await routeLine.waitFor({ timeout: 10_000 });
  const cameraButtons = page.getByTestId("camera-list").getByRole("button");
  await cameraButtons.first().waitFor({ timeout: 30_000 });
  return {
    summary: await summary.innerText(),
    cameras: await cameraButtons.count(),
  };
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text()))
      pageErrors.push(message.text());
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.locator(".leaflet-container").waitFor();
  check(
    (await page.getByRole("region", { name: "Your trips" }).count()) === 0,
    "a first visit shows no trips",
  );

  await choosePlace(page, "origin", ORIGIN_QUERY);
  await choosePlace(page, "destination", DESTINATION_QUERY);
  const planned = await expectRouteWithCameras(page);
  check(true, `route planned: ${planned.summary}, ${planned.cameras} cameras`);

  await saveAs(page, "origin", "Home");
  await saveAs(page, "destination", "Work");

  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".leaflet-container").waitFor();
  check(
    (await page.getByTestId("route-summary").count()) === 0,
    "after a reload no route is shown yet",
  );

  const trips = page.getByRole("region", { name: "Your trips" });
  const chip = trips.getByRole("button", { name: "Home → Work", exact: true });
  await chip.waitFor({ timeout: 5_000 });
  check(true, 'a "Home → Work" chip is shown after the reload');

  await chip.click();
  const retaken = await expectRouteWithCameras(page);
  check(
    retaken.cameras === planned.cameras,
    `tapping the chip drew the route with ${retaken.cameras} cameras (${retaken.summary})`,
  );
  check(
    (await page.getByTestId("saved-name").allInnerTexts()).join(",") ===
      "Home,Work",
    "the fields show Home and Work",
  );

  await page.getByLabel("Search origin").focus();
  const suggestions = page
    .getByRole("listbox", { name: "origin suggestions" })
    .getByRole("option");
  await suggestions.first().waitFor({ timeout: 5_000 });
  const first = await suggestions.first().innerText();
  check(
    /^\W*Home\b/.test(first),
    `focusing the empty origin field lists Home first ("${first.replace(/\s+/g, " ")}")`,
  );

  await page.screenshot({ path: SCREENSHOT });
  console.log(`   screenshot: ${SCREENSHOT}`);

  check(
    pageErrors.length === 0,
    `no page errors or hydration mismatches ${pageErrors.length ? JSON.stringify(pageErrors) : ""}`,
  );
} finally {
  await browser.close();
}
