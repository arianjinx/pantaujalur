import { describe, expect, test } from "bun:test";

import type { Place } from "../domain/types";
import {
  EMPTY_PLACES,
  forgetTrip,
  parsePlaces,
  placeSuggestions,
  recordPlace,
  recordTrip,
  removeSaved,
  renamePlace,
  savePlace,
  tripName,
} from "./places-store";

const station: Place = {
  label: "Stasiun Malang, Jalan Trunojoyo, Kiduldalem, Klojen",
  position: { lat: -7.9773, lng: 112.637 },
  source: "search",
};
const campus: Place = {
  label: "Universitas Brawijaya, Jalan Veteran, Ketawanggede, Lowokwaru",
  position: { lat: -7.9525, lng: 112.6145 },
  source: "search",
};
const myLocation: Place = {
  label: "My location",
  position: { lat: -7.96, lng: 112.63 },
  source: "gps",
};

function nudged(place: Place, meters: number, label = place.label): Place {
  return {
    ...place,
    label,
    position: { ...place.position, lat: place.position.lat + meters / 111_195 },
  };
}

function numbered(i: number): Place {
  return {
    label: `Place ${i}`,
    position: { lat: -7.9 - i * 0.01, lng: 112.6 },
    source: "search",
  };
}

describe("recent places", () => {
  test("a place within about 30 m of a recent one replaces it and moves to the front", () => {
    let state = recordPlace(EMPTY_PLACES, station, 1);
    state = recordPlace(state, campus, 2);
    state = recordPlace(state, nudged(station, 20, "Stasiun Kota Baru"), 3);

    expect(state.recentPlaces.map((r) => r.place.label)).toEqual([
      "Stasiun Kota Baru",
      campus.label,
    ]);
    expect(state.recentPlaces[0].lastUsedAt).toBe(3);
  });

  test("a place 50 m away is a different place", () => {
    let state = recordPlace(EMPTY_PLACES, station, 1);
    state = recordPlace(state, nudged(station, 50), 2);
    expect(state.recentPlaces).toHaveLength(2);
  });

  test("keeps the 8 most recent places", () => {
    let state = EMPTY_PLACES;
    for (let i = 1; i <= 10; i++) state = recordPlace(state, numbered(i), i);
    expect(state.recentPlaces.map((r) => r.place.label)).toEqual(
      [10, 9, 8, 7, 6, 5, 4, 3].map((i) => `Place ${i}`),
    );
  });

  test("the GPS fix is never a recent place", () => {
    expect(recordPlace(EMPTY_PLACES, myLocation, 1)).toEqual(EMPTY_PLACES);
    const state = recordTrip(EMPTY_PLACES, myLocation, campus, 1);
    expect(state.recentPlaces.map((r) => r.place)).toEqual([campus]);
  });
});

describe("recent trips", () => {
  test("repeating a trip counts a use and moves it to the front", () => {
    let state = recordTrip(EMPTY_PLACES, station, campus, 1);
    state = recordTrip(state, campus, station, 2);
    state = recordTrip(state, nudged(station, 10), nudged(campus, 10), 3);

    expect(state.recentTrips).toHaveLength(2);
    expect(state.recentTrips[0]).toMatchObject({ lastUsedAt: 3, uses: 2 });
    expect(state.recentTrips[1].origin).toEqual(campus);
  });

  test("trips from my location are one trip wherever the fix was", () => {
    let state = recordTrip(EMPTY_PLACES, myLocation, campus, 1);
    state = recordTrip(state, nudged(myLocation, 500), campus, 2);
    expect(state.recentTrips).toHaveLength(1);
    expect(state.recentTrips[0].uses).toBe(2);
  });

  test("keeps the 8 most recent trips", () => {
    let state = EMPTY_PLACES;
    for (let i = 1; i <= 10; i++)
      state = recordTrip(state, numbered(i), campus, i);
    expect(state.recentTrips).toHaveLength(8);
    expect(state.recentTrips[0].origin.label).toBe("Place 10");
    expect(state.recentTrips[7].origin.label).toBe("Place 3");
  });

  test("a trip is named from saved places, else from short labels", () => {
    let state = recordTrip(EMPTY_PLACES, station, campus, 1);
    const [trip] = state.recentTrips;
    expect(tripName(state, trip)).toBe(
      "Stasiun Malang → Universitas Brawijaya",
    );

    state = savePlace(state, "Home", nudged(station, 15), "home");
    state = savePlace(state, "Work", campus, "work");
    expect(tripName(state, trip)).toBe("Home → Work");

    state = recordTrip(state, myLocation, campus, 2);
    expect(tripName(state, state.recentTrips[0])).toBe("My location → Work");
  });

  test("forgetting a trip removes only that trip", () => {
    let state = recordTrip(EMPTY_PLACES, station, campus, 1);
    state = recordTrip(state, campus, station, 2);
    state = forgetTrip(state, state.recentTrips[1]);
    expect(state.recentTrips.map((t) => t.origin)).toEqual([campus]);
    expect(state.recentPlaces).toHaveLength(2);
  });
});

describe("saved places", () => {
  test("one name per place and one place per name", () => {
    let state = savePlace(EMPTY_PLACES, "Home", station, "a");
    state = savePlace(state, "Kos", nudged(station, 10), "b");
    expect(state.saved).toEqual([
      { id: "a", name: "Kos", place: nudged(station, 10) },
    ]);

    state = savePlace(state, "Work", campus, "c");
    state = savePlace(state, "kos", numbered(1), "d");
    expect(state.saved.map((s) => [s.name, s.place.label])).toEqual([
      ["Work", campus.label],
      ["kos", "Place 1"],
    ]);
  });

  test("a blank name saves nothing", () => {
    expect(savePlace(EMPTY_PLACES, "  ", station, "a")).toEqual(EMPTY_PLACES);
  });

  test("a saved GPS fix becomes a fixed pin", () => {
    const state = savePlace(EMPTY_PLACES, "Home", myLocation, "a");
    expect(state.saved[0].place).toEqual({
      label: "Pin at -7.96000, 112.63000",
      position: myLocation.position,
      source: "map",
    });
  });

  test("rename and remove", () => {
    let state = savePlace(EMPTY_PLACES, "Home", station, "a");
    state = savePlace(state, "Work", campus, "b");
    state = renamePlace(state, "a", "Rumah");
    expect(state.saved.map((s) => s.name).sort()).toEqual(["Rumah", "Work"]);

    state = removeSaved(state, "b");
    expect(state.saved.map((s) => s.name)).toEqual(["Rumah"]);
  });
});

describe("place suggestions", () => {
  test("saved places come first, then recent ones not already saved", () => {
    let state = recordTrip(EMPTY_PLACES, station, campus, 1);
    state = recordPlace(state, numbered(1), 2);
    state = savePlace(state, "Work", campus, "w");
    state = savePlace(state, "Home", station, "h");

    expect(
      placeSuggestions(state, "").map((s) => s.name ?? s.place.label),
    ).toEqual(["Work", "Home", "Place 1"]);
  });

  test("typing filters by name or label", () => {
    let state = recordPlace(EMPTY_PLACES, numbered(1), 1);
    state = savePlace(state, "Home", station, "h");
    state = savePlace(state, "Work", campus, "w");

    expect(placeSuggestions(state, "hom").map((s) => s.name)).toEqual(["Home"]);
    expect(placeSuggestions(state, "veteran").map((s) => s.name)).toEqual([
      "Work",
    ]);
    expect(placeSuggestions(state, "place").map((s) => s.place.label)).toEqual([
      "Place 1",
    ]);
  });
});

describe("parsePlaces", () => {
  test("round-trips stored state", () => {
    const state = savePlace(
      recordTrip(EMPTY_PLACES, station, campus, 1),
      "Home",
      station,
      "h",
    );
    expect(parsePlaces(JSON.stringify(state))).toEqual(state);
  });

  test("missing, corrupt, foreign or unknown-version data starts empty", () => {
    expect(parsePlaces(null)).toEqual(EMPTY_PLACES);
    expect(parsePlaces("{not json")).toEqual(EMPTY_PLACES);
    expect(parsePlaces('"Home"')).toEqual(EMPTY_PLACES);
    expect(parsePlaces('{"version":1,"saved":[{"name":"Home"}]}')).toEqual(
      EMPTY_PLACES,
    );
    expect(
      parsePlaces(JSON.stringify({ ...EMPTY_PLACES, version: 2 })),
    ).toEqual(EMPTY_PLACES);
  });
});
