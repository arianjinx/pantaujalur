import { z } from "zod";

import type { LatLng, Place, Route } from "#/domain/types";

// Public demo servers: rate-limited and not for production use.
const OSRM_URL = "https://router.project-osrm.org";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "malang-cctv-route-poc/0.1";
const MALANG_VIEWBOX = "112.55,-7.90,112.72,-8.05";

const OsrmResponse = z.object({
  code: z.string(),
  routes: z
    .array(
      z.object({
        distance: z.number(),
        duration: z.number(),
        geometry: z.object({
          coordinates: z.array(z.tuple([z.number(), z.number()])),
        }),
      }),
    )
    .optional(),
});

export async function fastestDrivingRoute(
  origin: LatLng,
  destination: LatLng,
): Promise<Route> {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=false`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  const body = OsrmResponse.parse(await response.json());
  const route = body.routes?.[0];
  if (body.code !== "Ok" || route === undefined) {
    throw new Error(`No driving route found (${body.code})`);
  }
  return {
    path: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
    distanceM: route.distance,
    durationS: route.duration,
  };
}

const NominatimPlace = z.object({
  display_name: z.string(),
  lat: z.string().transform(Number),
  lon: z.string().transform(Number),
});

async function nominatim(
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const query = new URLSearchParams({
    format: "jsonv2",
    "accept-language": "id,en",
    ...params,
  });
  const response = await fetch(`${NOMINATIM_URL}/${path}?${query}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok)
    throw new Error(`Place search failed (HTTP ${response.status})`);
  return response.json();
}

export async function searchPlaces(text: string): Promise<Place[]> {
  const body = await nominatim("search", {
    q: text,
    limit: "5",
    countrycodes: "id",
    viewbox: MALANG_VIEWBOX,
    bounded: "0",
  });
  return z
    .array(NominatimPlace)
    .parse(body)
    .map((place) => ({
      label: shortLabel(place.display_name),
      position: { lat: place.lat, lng: place.lon },
      source: "search" as const,
    }));
}

/** A short human label for a point, or null when Nominatim has none. */
export async function describePoint(position: LatLng): Promise<string | null> {
  const body = await nominatim("reverse", {
    lat: String(position.lat),
    lon: String(position.lng),
    zoom: "17",
  });
  const parsed = NominatimPlace.safeParse(body);
  return parsed.success ? shortLabel(parsed.data.display_name) : null;
}

function shortLabel(displayName: string): string {
  return displayName.split(", ").slice(0, 4).join(", ");
}
