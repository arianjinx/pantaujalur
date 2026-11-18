import type { Camera, CameraOnRoute, LatLng, Route } from "./types";

const EARTH_RADIUS_M = 6_371_008.8;
const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_M;

type Point = { x: number; y: number };

/**
 * Cameras within `bufferM` of the route, ordered by distance along the route.
 * Uses an equirectangular projection around the route's mean latitude, which is
 * accurate to well under a meter across a city.
 */
export function camerasAlongRoute(
  route: Route,
  cameras: readonly Camera[],
  bufferM = 75,
): CameraOnRoute[] {
  if (route.path.length < 2) return [];

  const meanLat =
    route.path.reduce((sum, p) => sum + p.lat, 0) / route.path.length;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180);
  const project = (p: LatLng): Point => ({
    x: p.lng * mPerDegLng,
    y: p.lat * M_PER_DEG_LAT,
  });

  const path = route.path.map(project);
  const bbox = boundingBox(path, bufferM);

  const segmentStartAlong: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    segmentStartAlong.push(
      segmentStartAlong[i - 1] + distance(path[i - 1], path[i]),
    );
  }

  const result: CameraOnRoute[] = [];
  for (const camera of cameras) {
    const c = project(camera.position);
    if (
      c.x < bbox.minX ||
      c.x > bbox.maxX ||
      c.y < bbox.minY ||
      c.y > bbox.maxY
    )
      continue;

    let best: { offsetM: number; alongM: number } | null = null;
    for (let i = 0; i < path.length - 1; i++) {
      const { offsetM, t, length } = projectOntoSegment(
        c,
        path[i],
        path[i + 1],
      );
      if (best === null || offsetM < best.offsetM) {
        best = { offsetM, alongM: segmentStartAlong[i] + t * length };
      }
    }
    if (best !== null && best.offsetM <= bufferM)
      result.push({ camera, ...best });
  }

  return result.sort((a, b) => a.alongM - b.alongM);
}

function projectOntoSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0, 1);
  const offsetM = distance(p, { x: a.x + t * dx, y: a.y + t * dy });
  return { offsetM, t, length: Math.sqrt(lengthSq) };
}

function boundingBox(points: Point[], padding: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
