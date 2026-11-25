import { readFileSync } from "node:fs";
import { join } from "node:path";

import { camerasAlongRoute } from "../../src/domain/cameras-along-route";
import type { Camera, LatLng, Route } from "../../src/domain/types";

const EARTH_RADIUS_M = 6_371_008.8;
const BUFFERS_M = [50, 100, 200] as const;
const SAMPLE_M = 500;
const OFFSETS_M = [0, 40, 70, 110, 160, 210, 400];
const TOLERANCE_M = 1;

type Trip = {
  id: string;
  path: LatLng[];
  distance_m: number;
  duration_s: number;
};

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

function ecef(p: LatLng) {
  const lat = toRad(p.lat);
  const lng = toRad(p.lng);
  return {
    x: EARTH_RADIUS_M * Math.cos(lat) * Math.cos(lng),
    y: EARTH_RADIUS_M * Math.cos(lat) * Math.sin(lng),
    z: EARTH_RADIUS_M * Math.sin(lat),
  };
}

function chordToArc(chord: number) {
  return (
    2 * EARTH_RADIUS_M * Math.asin(Math.min(1, chord / (2 * EARTH_RADIUS_M)))
  );
}

function haversine(a: LatLng, b: LatLng) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearing(a: LatLng, b: LatLng) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function destination(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceM: number,
): LatLng {
  const delta = distanceM / EARTH_RADIUS_M;
  const theta = toRad(bearingDeg);
  const lat1 = toRad(lat);
  const lng1 = toRad(lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) +
      Math.cos(lat1) * Math.sin(delta) * Math.cos(theta),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 };
}

function projectSegment(p: LatLng, a: LatLng, b: LatLng) {
  const point = ecef(p);
  const start = ecef(a);
  const end = ecef(b);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  const raw =
    lengthSq === 0
      ? 0
      : ((point.x - start.x) * dx +
          (point.y - start.y) * dy +
          (point.z - start.z) * dz) /
        lengthSq;
  const t = Math.min(1, Math.max(0, raw));
  const projected = {
    x: start.x + t * dx,
    y: start.y + t * dy,
    z: start.z + t * dz,
  };
  return {
    offsetM: chordToArc(
      Math.hypot(
        point.x - projected.x,
        point.y - projected.y,
        point.z - projected.z,
      ),
    ),
    alongM: chordToArc(
      Math.hypot(
        projected.x - start.x,
        projected.y - start.y,
        projected.z - start.z,
      ),
    ),
  };
}

function segmentLength(a: LatLng, b: LatLng) {
  const start = ecef(a);
  const end = ecef(b);
  return chordToArc(
    Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z),
  );
}

export function reference(path: LatLng[], point: LatLng) {
  let best: { offsetM: number; alongM: number } | null = null;
  let walked = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = projectSegment(point, path[i], path[i + 1]);
    const alongM = walked + segment.alongM;
    if (best === null || segment.offsetM < best.offsetM) {
      best = { offsetM: segment.offsetM, alongM };
    }
    walked += segmentLength(path[i], path[i + 1]);
  }
  return best ?? { offsetM: Infinity, alongM: 0 };
}

function samples(path: LatLng[]) {
  let length = 0;
  for (let i = 0; i < path.length - 1; i++)
    length += haversine(path[i], path[i + 1]);
  const distances = [0];
  for (let d = SAMPLE_M; d < length; d += SAMPLE_M) distances.push(d);
  if (length > 0) distances.push(length);

  const out: { at: LatLng; bearingDeg: number }[] = [];
  for (const distance of distances) {
    let walked = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = haversine(path[i], path[i + 1]);
      if (walked + segment >= distance - 1e-6 || i === path.length - 2) {
        const bearingDeg = bearing(path[i], path[i + 1]);
        const into =
          segment === 0
            ? 0
            : Math.min(1, Math.max(0, (distance - walked) / segment));
        out.push({
          at: destination(path[i].lat, path[i].lng, bearingDeg, segment * into),
          bearingDeg,
        });
        break;
      }
      walked += segment;
    }
  }
  return out;
}

function probe(id: string, position: LatLng): Camera {
  return {
    id,
    name: id,
    streamId: "1",
    address: "",
    district: "KLOJEN",
    position,
  };
}

export function geometry(root: string, all: boolean) {
  const file = JSON.parse(
    readFileSync(join(root, "testdata/routes.json"), "utf8"),
  ) as {
    trips: Trip[];
  };
  const fails: string[] = [];
  let total = 0;
  let maxOffsetM = 0;
  let maxAlongM = 0;

  for (const trip of file.trips) {
    if (trip.path.length < 2) {
      total++;
      fails.push(`${trip.id}: route has fewer than 2 points`);
      continue;
    }
    const route: Route = {
      path: trip.path,
      distanceM: trip.distance_m,
      durationS: trip.duration_s,
    };
    const cameras: Camera[] = [];
    const expected = new Map<string, { offsetM: number; alongM: number }>();
    let n = 0;
    for (const sample of samples(trip.path)) {
      for (const offset of OFFSETS_M) {
        const id = `${trip.id}-${n}`;
        n++;
        const position = destination(
          sample.at.lat,
          sample.at.lng,
          (sample.bearingDeg - 90 + 360) % 360,
          offset,
        );
        cameras.push(probe(id, position));
        expected.set(id, reference(trip.path, position));
      }
    }
    const firstBearing = bearing(trip.path[0], trip.path[1]);
    const lastBearing = bearing(
      trip.path[trip.path.length - 2],
      trip.path[trip.path.length - 1],
    );
    const ends: [string, LatLng][] = [
      [
        `${trip.id}-before`,
        destination(
          trip.path[0].lat,
          trip.path[0].lng,
          (firstBearing + 180) % 360,
          150,
        ),
      ],
      [
        `${trip.id}-after`,
        destination(
          trip.path[trip.path.length - 1].lat,
          trip.path[trip.path.length - 1].lng,
          lastBearing,
          150,
        ),
      ],
    ];
    for (const [id, position] of ends) {
      cameras.push(probe(id, position));
      expected.set(id, reference(trip.path, position));
    }

    for (const buffer of BUFFERS_M) {
      const got = camerasAlongRoute(route, cameras, buffer);
      const byId = new Map(got.map((hit) => [hit.camera.id, hit]));
      for (const camera of cameras) {
        total++;
        const want = expected.get(camera.id);
        if (!want) continue;
        const hit = byId.get(camera.id);
        const borderline = Math.abs(want.offsetM - buffer) <= TOLERANCE_M;
        if (!borderline && want.offsetM <= buffer - TOLERANCE_M && !hit) {
          fails.push(
            `${trip.id} ${buffer} m: missing ${camera.id}, reference offset ${want.offsetM.toFixed(1)} m`,
          );
          continue;
        }
        if (!borderline && want.offsetM >= buffer + TOLERANCE_M && hit) {
          fails.push(
            `${trip.id} ${buffer} m: kept ${camera.id} at ${hit.offsetM.toFixed(1)} m, reference offset ${want.offsetM.toFixed(1)} m`,
          );
          continue;
        }
        if (!hit) continue;
        const dOffset = Math.abs(hit.offsetM - want.offsetM);
        const dAlong = Math.abs(hit.alongM - want.alongM);
        maxOffsetM = Math.max(maxOffsetM, dOffset);
        maxAlongM = Math.max(maxAlongM, dAlong);
        if (dOffset > TOLERANCE_M || dAlong > TOLERANCE_M) {
          fails.push(
            `${trip.id} ${buffer} m: ${camera.id} differs by ${dOffset.toFixed(2)} m offset and ${dAlong.toFixed(2)} m along`,
          );
        }
      }
      total++;
      for (let i = 1; i < got.length; i++) {
        if (got[i].alongM + TOLERANCE_M < got[i - 1].alongM) {
          fails.push(`${trip.id} ${buffer} m: not ordered along the route`);
          break;
        }
      }
    }
  }

  return {
    pass: total - fails.length,
    total,
    max_offset_m: maxOffsetM,
    max_along_m: maxAlongM,
    first_fail: fails[0] ?? "",
    ...(all ? { fails } : {}),
  };
}
