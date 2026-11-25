import { describe, expect, test } from "bun:test";

import { camerasAlongRoute } from "./cameras-along-route";
import type { Camera, LatLng, Route } from "./types";

const M_PER_DEG_LAT = 111_195;
const LAT0 = -7.95;
const LNG0 = 112.63;
const mPerDegLngAt = (lat: number) =>
  M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

function offset(northM: number, eastM: number): LatLng {
  const lat = LAT0 + northM / M_PER_DEG_LAT;
  return { lat, lng: LNG0 + eastM / mPerDegLngAt(lat) };
}

function camera(id: string, position: LatLng): Camera {
  return {
    id,
    name: id,
    streamId: "1",
    address: "",
    district: "KLOJEN",
    position,
  };
}

function routeThrough(...path: LatLng[]): Route {
  return { path, distanceM: 0, durationS: 0 };
}

function expectNear(actual: number, expected: number, toleranceM = 2) {
  expect(Math.abs(actual - expected)).toBeLessThan(toleranceM);
}

describe("camerasAlongRoute", () => {
  const southward = routeThrough(offset(0, 0), offset(-1000, 0));

  test("a camera on the route is kept with zero offset and its distance from the origin", () => {
    const [hit, ...rest] = camerasAlongRoute(southward, [
      camera("on-line", offset(-400, 0)),
    ]);
    expect(rest).toEqual([]);
    expect(hit.camera.id).toBe("on-line");
    expectNear(hit.offsetM, 0);
    expectNear(hit.alongM, 400);
  });

  test("a camera just outside the buffer is dropped, and kept once the buffer covers it", () => {
    const nearby = camera("80m-east", offset(-500, 80));
    expect(camerasAlongRoute(southward, [nearby], 75)).toEqual([]);

    const [hit] = camerasAlongRoute(southward, [nearby], 100);
    expect(hit.camera.id).toBe("80m-east");
    expectNear(hit.offsetM, 80);
    expectNear(hit.alongM, 500);
  });

  test("the buffer is measured perpendicular to a diagonal segment", () => {
    const diagonal = routeThrough(offset(0, 0), offset(-1000, 1000));
    const side = 80 / Math.SQRT2;
    const nearby = camera("80m-off-diagonal", offset(-500 + side, 500 + side));
    expect(camerasAlongRoute(diagonal, [nearby], 75)).toEqual([]);

    const [hit] = camerasAlongRoute(diagonal, [nearby], 100);
    expectNear(hit.offsetM, 80);
    expectNear(hit.alongM, 500 * Math.SQRT2);
  });

  test("the default buffer is 75 m", () => {
    const ids = camerasAlongRoute(southward, [
      camera("70m", offset(-200, 70)),
      camera("80m", offset(-200, -80)),
    ]).map((c) => c.camera.id);
    expect(ids).toEqual(["70m"]);
  });

  test("results are ordered by distance along the route, not by input order", () => {
    const ids = camerasAlongRoute(southward, [
      camera("far", offset(-900, 10)),
      camera("near", offset(-100, -10)),
      camera("middle", offset(-500, 0)),
    ]).map((c) => c.camera.id);
    expect(ids).toEqual(["near", "middle", "far"]);
  });

  test("distance along accumulates across segments of a bent route", () => {
    const bent = routeThrough(
      offset(0, 0),
      offset(-1000, 0),
      offset(-1000, 600),
    );
    const [hit] = camerasAlongRoute(bent, [
      camera("after-turn", offset(-1000, 300)),
    ]);
    expectNear(hit.alongM, 1300);
  });

  test("cameras past the ends of the route are dropped", () => {
    const result = camerasAlongRoute(southward, [
      camera("before-origin", offset(200, 0)),
      camera("after-destination", offset(-1200, 0)),
    ]);
    expect(result).toEqual([]);
  });

  test("a route with fewer than two points has no cameras", () => {
    expect(
      camerasAlongRoute(routeThrough(offset(0, 0)), [
        camera("a", offset(0, 0)),
      ]),
    ).toEqual([]);
  });
});
