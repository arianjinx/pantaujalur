import { describe, expect, test } from "bun:test";

import { createActor, fromPromise, waitFor } from "xstate";

import type { Camera, LatLng, Place } from "#/domain/types";

import { routeFlowMachine } from "./route-flow-machine";

const station: LatLng = { lat: -7.9773, lng: 112.637 };
const campus: Place = {
  label: "Universitas Brawijaya",
  position: { lat: -7.9525, lng: 112.6145 },
  source: "search",
};
const camera: Camera = {
  id: "cam-1",
  name: "Jl. Ijen",
  streamId: "123",
  address: "",
  district: "KLOJEN",
  position: station,
};

function startFlow(locate: () => Promise<LatLng>) {
  const machine = routeFlowMachine.provide({
    actors: { locate: fromPromise(locate) },
  });
  return createActor(machine).start();
}

describe("routeFlowMachine", () => {
  test("starts by locating the user and uses the GPS fix as origin", async () => {
    const flow = startFlow(async () => station);
    expect(flow.getSnapshot().matches({ origin: { auto: "locating" } })).toBe(
      true,
    );

    const located = await waitFor(flow, (s) =>
      s.matches({ origin: { auto: "located" } }),
    );
    expect(located.context.origin).toEqual({
      label: "My location",
      position: station,
      source: "gps",
    });
  });

  test("a geolocation failure keeps its message and leaves the origin empty", async () => {
    const flow = startFlow(async () => {
      throw new Error("Location permission was denied.");
    });
    const failed = await waitFor(flow, (s) =>
      s.matches({ origin: { auto: "locateFailed" } }),
    );
    expect(failed.context.locateError).toBe("Location permission was denied.");
    expect(failed.context.origin).toBeNull();
  });

  test("choosing a searched origin switches to manual mode; destination is independent", () => {
    const flow = startFlow(() => new Promise(() => {}));
    flow.send({
      type: "PLACE_CHOSEN",
      field: "origin",
      place: { ...campus, label: "Stasiun Malang" },
    });
    flow.send({ type: "PLACE_CHOSEN", field: "destination", place: campus });

    const snapshot = flow.getSnapshot();
    expect(snapshot.matches({ origin: "manual" })).toBe(true);
    expect(snapshot.context.origin?.label).toBe("Stasiun Malang");
    expect(snapshot.context.destination).toEqual(campus);
  });

  test("choosing a saved trip sets both ends and leaves auto mode", () => {
    const flow = startFlow(() => new Promise(() => {}));
    const stationPlace: Place = {
      label: "Stasiun Malang",
      position: station,
      source: "search",
    };
    flow.send({
      type: "TRIP_CHOSEN",
      origin: stationPlace,
      destination: campus,
    });

    const snapshot = flow.getSnapshot();
    expect(snapshot.matches({ origin: "manual" })).toBe(true);
    expect(snapshot.context.origin).toEqual(stationPlace);
    expect(snapshot.context.destination).toEqual(campus);
  });

  test("a trip from my location locates the user again instead of reusing the old fix", async () => {
    const here: LatLng = { lat: -7.96, lng: 112.63 };
    const flow = startFlow(async () => here);
    flow.send({ type: "PLACE_CHOSEN", field: "origin", place: campus });
    flow.send({
      type: "TRIP_CHOSEN",
      origin: { label: "My location", position: station, source: "gps" },
      destination: campus,
    });
    expect(flow.getSnapshot().context.destination).toEqual(campus);

    const located = await waitFor(flow, (s) =>
      s.matches({ origin: { auto: "located" } }),
    );
    expect(located.context.origin).toEqual({
      label: "My location",
      position: here,
      source: "gps",
    });
    expect(located.context.destination).toEqual(campus);
  });

  test("a map click fills only the field being picked, then picking ends", () => {
    const flow = startFlow(() => new Promise(() => {}));
    flow.send({ type: "MAP_CLICKED", position: station });
    expect(flow.getSnapshot().context.destination).toBeNull();

    flow.send({ type: "PICK_ON_MAP", field: "destination" });
    flow.send({ type: "MAP_CLICKED", position: station });

    const snapshot = flow.getSnapshot();
    expect(snapshot.matches({ mapPick: "off" })).toBe(true);
    expect(snapshot.context.destination).toMatchObject({
      position: station,
      source: "map",
    });
    expect(snapshot.context.origin).toBeNull();
  });

  test("picking the origin on the map leaves auto mode", () => {
    const flow = startFlow(() => new Promise(() => {}));
    flow.send({ type: "PICK_ON_MAP", field: "origin" });
    flow.send({ type: "MAP_CLICKED", position: station });

    const snapshot = flow.getSnapshot();
    expect(snapshot.matches({ origin: "manual" })).toBe(true);
    expect(snapshot.context.origin).toMatchObject({
      position: station,
      source: "map",
    });
  });

  test("selecting a camera opens the player; closing clears the selection", () => {
    const flow = startFlow(() => new Promise(() => {}));
    flow.send({ type: "CAMERA_SELECTED", camera });
    expect(flow.getSnapshot().matches({ viewer: "single" })).toBe(true);
    expect(flow.getSnapshot().context.selectedCamera).toEqual(camera);

    const other = { ...camera, id: "cam-2" };
    flow.send({ type: "CAMERA_SELECTED", camera: other });
    expect(flow.getSnapshot().context.selectedCamera).toEqual(other);

    flow.send({ type: "PLAYER_CLOSED" });
    expect(flow.getSnapshot().matches({ viewer: "closed" })).toBe(true);
    expect(flow.getSnapshot().context.selectedCamera).toBeNull();
  });

  test("a camera opened from the wall returns to the wall when its player closes", () => {
    const flow = startFlow(() => new Promise(() => {}));
    flow.send({ type: "WALL_OPENED" });
    expect(flow.getSnapshot().matches({ viewer: { wall: "grid" } })).toBe(true);
    expect(flow.getSnapshot().context.selectedCamera).toBeNull();

    flow.send({ type: "CAMERA_SELECTED", camera });
    expect(flow.getSnapshot().matches({ viewer: { wall: "single" } })).toBe(
      true,
    );
    expect(flow.getSnapshot().context.selectedCamera).toEqual(camera);

    flow.send({ type: "PLAYER_CLOSED" });
    expect(flow.getSnapshot().matches({ viewer: { wall: "grid" } })).toBe(true);
    expect(flow.getSnapshot().context.selectedCamera).toBeNull();

    flow.send({ type: "WALL_CLOSED" });
    expect(flow.getSnapshot().matches({ viewer: "closed" })).toBe(true);
  });

  test("closing the wall with a camera open over it closes both", () => {
    const flow = startFlow(() => new Promise(() => {}));
    flow.send({ type: "WALL_OPENED" });
    flow.send({ type: "CAMERA_SELECTED", camera });
    flow.send({ type: "WALL_CLOSED" });
    expect(flow.getSnapshot().matches({ viewer: "closed" })).toBe(true);
    expect(flow.getSnapshot().context.selectedCamera).toBeNull();

    flow.send({ type: "PLAYER_CLOSED" });
    expect(flow.getSnapshot().matches({ viewer: "closed" })).toBe(true);
  });
});
