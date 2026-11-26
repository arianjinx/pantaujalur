import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { camerasAlongRoute } from "../../src/domain/cameras-along-route";
import type { Camera, LatLng, Route } from "../../src/domain/types";
import { reference } from "./geometry";

const COMPASS: [RegExp, number][] = [
  [/\bbarat laut\b/i, 315],
  [/\bbarat daya\b/i, 225],
  [/\btimur laut\b/i, 45],
  [/\btenggara\b/i, 135],
  [/\butara\b/i, 0],
  [/\bselatan\b/i, 180],
  [/\btimur\b/i, 90],
  [/\bbarat\b/i, 270],
];

const EARTH_RADIUS_M = 6_371_008.8;
const BUFFER_M = 100;
const AGREE_DEG = 45;
const TOLERANCE_M = 1;

function haversine(a: LatLng, b: LatLng) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearing(a: LatLng, b: LatLng) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function travelBearing(path: LatLng[], alongM: number) {
  let walked = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = haversine(path[i], path[i + 1]);
    if (walked + segment >= alongM || i === path.length - 2)
      return bearing(path[i], path[i + 1]);
    walked += segment;
  }
  return 0;
}

function facing(name: string) {
  for (const [pattern, deg] of COMPASS) if (pattern.test(name)) return deg;
  return null;
}

function angleBetween(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function direction(root: string, all: boolean) {
  const file = join(root, "testdata/cameras.json");
  if (!existsSync(file)) {
    return {
      score: "unmeasured",
      first_fail: "",
      why: "testdata/cameras.json is not there. Record GET /api/cameras on a network cctv.malangkota.go.id accepts, as { cameras: Camera[] }.",
    };
  }
  const cameras = (
    JSON.parse(readFileSync(file, "utf8")) as { cameras: Camera[] }
  ).cameras;
  const trips = (
    JSON.parse(readFileSync(join(root, "testdata/routes.json"), "utf8")) as {
      trips: {
        id: string;
        path: LatLng[];
        distance_m: number;
        duration_s: number;
      }[];
    }
  ).trips;
  const named = cameras.flatMap((camera) => {
    const deg = facing(camera.name);
    return deg === null ? [] : [{ camera, deg }];
  });
  const fails: string[] = [];
  let total = 0;
  let agreeing = 0;
  for (const trip of trips) {
    const route: Route = {
      path: trip.path,
      distanceM: trip.distance_m,
      durationS: trip.duration_s,
    };
    const kept = new Set(
      camerasAlongRoute(route, cameras, BUFFER_M).map((hit) => hit.camera.id),
    );
    for (const { camera, deg } of named) {
      const near = reference(trip.path, camera.position);
      if (near.offsetM > BUFFER_M - TOLERANCE_M) continue;
      total++;
      const travel = travelBearing(trip.path, near.alongM);
      const agrees = angleBetween(deg, travel) <= AGREE_DEG;
      if (agrees) agreeing++;
      if (agrees === kept.has(camera.id)) continue;
      fails.push(
        `${trip.id}: ${agrees ? "dropped" : "kept"} ${camera.name}, it faces ${deg}° and the route there travels ${Math.round(travel)}°`,
      );
    }
  }
  if (total === 0) {
    return {
      score: "unmeasured",
      first_fail: "",
      why: "testdata/cameras.json has no camera whose name states a facing within 100 m of a recorded trip",
    };
  }
  return {
    pass: total - fails.length,
    total,
    agreeing,
    first_fail: fails[0] ?? "",
    ...(all ? { fails } : {}),
  };
}
