import { readFileSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Page } from "playwright";

type State = { id: string; text: string };
type Check = { name: string; ok: boolean };

const HOW =
  "SCORE_UI=1 with bun run dev on BASE_URL (default http://localhost:1337). Chrome is the channel in BROWSER_CHANNEL, default chrome.";

function pack(checks: Check[], all: boolean) {
  const fails = checks.filter((check) => !check.ok).map((check) => check.name);
  return {
    pass: checks.length - fails.length,
    total: checks.length,
    first_fail: fails[0] ?? "",
    ...(all ? { fails } : {}),
  };
}

async function readHome(page: Page, viewport: "phone" | "desktop") {
  return page.evaluate((which) => {
    const linear = (value: string) => {
      const rgb = value.match(
        /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/,
      );
      if (rgb) {
        const channel = (c: string) => {
          const s = Number(c) / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return {
          r: channel(rgb[1] ?? "0"),
          g: channel(rgb[2] ?? "0"),
          b: channel(rgb[3] ?? "0"),
          a: rgb[4] === undefined ? 1 : Number(rgb[4]),
        };
      }
      const oklch = value.match(
        /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/,
      );
      if (!oklch) return null;
      const L = Number(oklch[1]);
      const C = Number(oklch[2]);
      const hue = (Number(oklch[3]) * Math.PI) / 180;
      const aLab = C * Math.cos(hue);
      const bLab = C * Math.sin(hue);
      const l_ = L + 0.3963377774 * aLab + 0.2158037573 * bLab;
      const m_ = L - 0.1055613458 * aLab - 0.0638541728 * bLab;
      const s_ = L - 0.0894841775 * aLab - 1.291485548 * bLab;
      const l = l_ ** 3;
      const m = m_ ** 3;
      const s = s_ ** 3;
      const alpha =
        oklch[4] === undefined
          ? 1
          : oklch[4].endsWith("%")
            ? Number(oklch[4]) / 100
            : Number(oklch[4]);
      return {
        r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        a: alpha,
      };
    };
    const luminance = (color: { r: number; g: number; b: number }) =>
      0.2126 * Math.min(1, Math.max(0, color.r)) +
      0.7152 * Math.min(1, Math.max(0, color.g)) +
      0.0722 * Math.min(1, Math.max(0, color.b));
    const visible = (el: Element) => {
      const style = getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      ) {
        return false;
      }
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const backdrop = (el: Element) => {
      const layers: { r: number; g: number; b: number; a: number }[] = [];
      let node: Element | null = el;
      while (node) {
        const bg = linear(getComputedStyle(node).backgroundColor);
        if (bg && bg.a > 0) layers.push(bg);
        if (bg && bg.a >= 1) break;
        node = node.parentElement;
      }
      let acc = { r: 1, g: 1, b: 1, a: 1 };
      for (let i = layers.length - 1; i >= 0; i--) {
        const src = layers[i];
        if (!src) continue;
        const a = src.a + acc.a * (1 - src.a);
        acc = {
          r: (src.r * src.a + acc.r * acc.a * (1 - src.a)) / (a || 1),
          g: (src.g * src.a + acc.g * acc.a * (1 - src.a)) / (a || 1),
          b: (src.b * src.a + acc.b * acc.a * (1 - src.a)) / (a || 1),
          a,
        };
      }
      return acc;
    };
    const nameOf = (el: Element) => {
      const labelled = el.getAttribute("aria-labelledby");
      const fromLabel = labelled
        ? labelled
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
        : "";
      return (
        el.getAttribute("aria-label") ||
        fromLabel ||
        (el.getAttribute("title") ?? "") ||
        (el.textContent ?? "")
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
    };
    const scope = [
      ...document.querySelectorAll("aside *, .leaflet-control-container *"),
    ];
    const controls = scope.filter((el) => {
      const tag = el.tagName;
      return (
        tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "SELECT"
      );
    });
    const targets: { name: string; ok: boolean }[] = [];
    const names: { name: string; ok: boolean }[] = [];
    const seen = new Set<Element>();
    for (const el of controls) {
      if (!visible(el) || seen.has(el)) continue;
      seen.add(el);
      const box = el.getBoundingClientRect();
      const label = nameOf(el) || el.tagName.toLowerCase();
      names.push({ name: `${which} name "${label}"`, ok: nameOf(el) !== "" });
      targets.push({
        name: `${which} target "${label}" ${Math.round(box.width)}x${Math.round(box.height)}`,
        ok: box.width >= 44 && box.height >= 44,
      });
    }
    const texts: { name: string; ok: boolean }[] = [];
    const clipped: string[] = [];
    for (const el of scope) {
      if (!visible(el)) continue;
      const own = [...el.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (own !== "") {
        const style = getComputedStyle(el);
        const fg = linear(style.color);
        const size = Number.parseFloat(style.fontSize);
        const weight = Number.parseInt(style.fontWeight, 10);
        const large = size >= 24 || (size >= 18.67 && weight >= 700);
        const bg = backdrop(el);
        const painted = fg
          ? {
              r: fg.r * fg.a + bg.r * (1 - fg.a),
              g: fg.g * fg.a + bg.g * (1 - fg.a),
              b: fg.b * fg.a + bg.b * (1 - fg.a),
            }
          : null;
        const ratio =
          painted === null
            ? 0
            : (Math.max(luminance(painted), luminance(bg)) + 0.05) /
              (Math.min(luminance(painted), luminance(bg)) + 0.05);
        texts.push({
          name:
            painted === null
              ? `${which} contrast unparsed "${style.color}" "${own.slice(0, 40)}"`
              : `${which} contrast ${ratio.toFixed(2)} "${own.slice(0, 40)}"`,
          ok: painted !== null && ratio >= (large ? 3 : 4.5),
        });
      }
      const style = getComputedStyle(el);
      if (
        (style.overflowX === "hidden" ||
          style.overflowX === "clip" ||
          style.overflowX === "auto") &&
        el.scrollWidth > el.clientWidth + 2
      ) {
        clipped.push(
          (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
        );
      }
    }
    const boxes = [...seen].map((el) => ({
      name: nameOf(el) || el.tagName.toLowerCase(),
      box: el.getBoundingClientRect(),
    }));
    let overlap = "";
    for (let i = 0; i < boxes.length && overlap === ""; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b) continue;
        const width =
          Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
        const height =
          Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
        if (width <= 4 || height <= 4) continue;
        const aInB =
          a.box.left >= b.box.left - 2 &&
          a.box.right <= b.box.right + 2 &&
          a.box.top >= b.box.top - 2 &&
          a.box.bottom <= b.box.bottom + 2;
        const bInA =
          b.box.left >= a.box.left - 2 &&
          b.box.right <= a.box.right + 2 &&
          b.box.top >= a.box.top - 2 &&
          b.box.bottom <= a.box.bottom + 2;
        if (!aInB && !bInA)
          overlap = `${which} overlap "${a.name}" and "${b.name}"`;
      }
    }
    return {
      targets,
      names,
      texts,
      clipped: clipped[0] ?? "",
      overlap,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      page: {
        lang: document.documentElement.lang,
        title: document.title,
        h1: document.querySelectorAll("h1").length,
        viewport:
          document
            .querySelector('meta[name="viewport"]')
            ?.getAttribute("content") ?? "",
      },
    };
  }, viewport);
}

export async function browser(root: string, all: boolean) {
  if (process.env.SCORE_UI !== "1") {
    const skipped = { score: "unmeasured", how: HOW };
    return { R4: skipped, R6: skipped };
  }
  const base = process.env.BASE_URL ?? "http://localhost:1337";
  const up = await fetch(base, { signal: AbortSignal.timeout(20_000) }).then(
    (response) => response.ok || response.status < 500,
    (error: unknown) => error,
  );
  if (up !== true) {
    const why = `SCORE_UI=1 but ${base} did not answer (${up instanceof Error ? up.message : "not ok"}). ${HOW}`;
    return {
      R4: { score: "unmeasured", why },
      R6: { score: "unmeasured", why },
    };
  }

  const states = JSON.parse(
    readFileSync(join(root, "testdata/states.json"), "utf8"),
  ) as State[];
  const browserApp = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL ?? "chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browserApp.newPage();
    const stateChecks: Check[] = [];
    for (const state of states) {
      const errors: string[] = [];
      const onError = (error: Error) => errors.push(error.message);
      page.on("pageerror", onError);
      await page.goto(`${base}/?fixture=${encodeURIComponent(state.id)}`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.locator("h1").waitFor({ timeout: 20_000 });
      const marker = await page.locator(`[data-fixture="${state.id}"]`).count();
      const text = await page.locator("body").innerText();
      page.off("pageerror", onError);
      const shown =
        marker === 1 && text.includes(state.text) && errors.length === 0;
      stateChecks.push({
        name: shown
          ? state.id
          : `${state.id}: ${errors[0] ?? (marker !== 1 ? "no data-fixture" : `page does not show "${state.text}"`)}`,
        ok: shown,
      });
    }

    const home = await (async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.locator("h1").waitFor({ timeout: 20_000 });
      await page.locator(".leaflet-container").waitFor({ timeout: 20_000 });
      const phone = await readHome(page, "phone");
      await page.emulateMedia({ colorScheme: "dark" });
      const darkBg = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      await page.emulateMedia({ colorScheme: "light" });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator(".leaflet-container").waitFor({ timeout: 20_000 });
      const desktop = await readHome(page, "desktop");
      return { phone, desktop, darkBg };
    })();

    const checks: Check[] = [];
    const meta = home.phone.page.viewport;
    const maxScale = meta.match(/maximum-scale\s*=\s*([0-9.]+)/i);
    const zoomLocked =
      /user-scalable\s*=\s*(no|0)/i.test(meta) ||
      (maxScale !== null && Number(maxScale[1]) < 2);
    checks.push(
      { name: "html lang", ok: home.phone.page.lang !== "" },
      { name: "document title", ok: home.phone.page.title !== "" },
      {
        name: `one h1 (found ${home.phone.page.h1})`,
        ok: home.phone.page.h1 === 1,
      },
      { name: "viewport allows zoom", ok: !zoomLocked },
    );
    const dark = home.darkBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    const darkLum = dark
      ? (() => {
          const channel = (c: number) => {
            const s = c / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return (
            0.2126 * channel(Number(dark[1])) +
            0.7152 * channel(Number(dark[2])) +
            0.0722 * channel(Number(dark[3]))
          );
        })()
      : 1;
    checks.push({
      name: `dark scheme body luminance ${darkLum.toFixed(2)} (${home.darkBg})`,
      ok: darkLum < 0.2,
    });
    for (const [which, shot] of [
      ["phone", home.phone],
      ["desktop", home.desktop],
    ] as const) {
      checks.push(
        { name: `${which} no horizontal overflow`, ok: !shot.overflow },
        {
          name:
            shot.clipped === ""
              ? `${which} no clipped text`
              : `${which} clipped "${shot.clipped}"`,
          ok: shot.clipped === "",
        },
        {
          name:
            shot.overlap === ""
              ? `${which} no overlapping controls`
              : shot.overlap,
          ok: shot.overlap === "",
        },
      );
      checks.push(...shot.names, ...shot.targets, ...shot.texts);
    }
    return { R4: pack(stateChecks, all), R6: pack(checks, all) };
  } finally {
    await browserApp.close();
  }
}
