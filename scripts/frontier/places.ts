import { readFileSync } from "node:fs";
import { join } from "node:path";

import { searchPlaces } from "../../src/server/geo";

type Query = {
  q: string;
  place: string;
  anchor: { lat: number; lng: number };
  radius_m: number;
  label_has?: string;
  response: { display_name: string; lat: string; lon: string }[];
};

const EARTH_RADIUS_M = 6_371_008.8;

function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function paramsMatch(url: URL, expected: Record<string, string>) {
  for (const [key, value] of Object.entries(expected)) {
    if (url.searchParams.get(key) !== value) return false;
  }
  return true;
}

export async function places(root: string, all: boolean) {
  const file = JSON.parse(
    readFileSync(join(root, "testdata/places.json"), "utf8"),
  ) as {
    params: Record<string, string>;
    queries: Query[];
  };
  const byQuery = new Map(file.queries.map((query) => [query.q, query]));
  const original = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input
          : input.url,
    );
    if (!url.hostname.endsWith("nominatim.openstreetmap.org"))
      return original(input, init);
    const query = byQuery.get(url.searchParams.get("q") ?? "");
    if (!query || !paramsMatch(url, file.params)) {
      return new Response(
        "recorded response is for the Nominatim query shape in testdata/places.json",
        {
          status: 404,
        },
      );
    }
    return new Response(JSON.stringify(query.response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const fails: string[] = [];
  try {
    for (const query of file.queries) {
      let label = "";
      let meters = Infinity;
      try {
        const [first] = await searchPlaces(query.q);
        if (!first) {
          fails.push(`${query.q}: no result (wanted ${query.place})`);
          continue;
        }
        label = first.label;
        meters = haversine(first.position, query.anchor);
        const near = meters <= query.radius_m;
        const named =
          query.label_has === undefined ||
          first.label.toLowerCase().includes(query.label_has.toLowerCase());
        if (near && named) continue;
        const why = [
          near ? "" : `${Math.round(meters)} m from ${query.place}`,
          named ? "" : `label does not contain "${query.label_has}"`,
        ]
          .filter(Boolean)
          .join(", ");
        fails.push(`${query.q}: first is "${label}", ${why}`);
      } catch (error) {
        fails.push(
          `${query.q}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    globalThis.fetch = original;
  }

  return {
    pass: file.queries.length - fails.length,
    total: file.queries.length,
    first_fail: fails[0] ?? "",
    ...(all ? { fails } : {}),
  };
}
