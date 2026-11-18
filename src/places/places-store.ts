import { useSyncExternalStore } from "react";
import { z } from "zod";

import { type LatLng, pinLabel, type Place } from "../domain/types";

const PlaceSchema = z.object({
  label: z.string(),
  position: z.object({ lat: z.number(), lng: z.number() }),
  source: z.enum(["gps", "search", "map"]),
});

const PlacesStateSchema = z.object({
  version: z.literal(1),
  saved: z.array(
    z.object({ id: z.string(), name: z.string(), place: PlaceSchema }),
  ),
  recentPlaces: z.array(
    z.object({ place: PlaceSchema, lastUsedAt: z.number() }),
  ),
  recentTrips: z.array(
    z.object({
      origin: PlaceSchema,
      destination: PlaceSchema,
      lastUsedAt: z.number(),
      uses: z.number(),
    }),
  ),
});

export type PlacesState = z.infer<typeof PlacesStateSchema>;
export type SavedPlace = PlacesState["saved"][number];
export type RecentPlace = PlacesState["recentPlaces"][number];
export type RecentTrip = PlacesState["recentTrips"][number];

export const EMPTY_PLACES: PlacesState = {
  version: 1,
  saved: [],
  recentPlaces: [],
  recentTrips: [],
};

export const MAX_RECENT = 8;
export const SAME_PLACE_M = 30;
export const QUICK_NAMES = ["Home", "Work", "School"] as const;

const M_PER_DEG_LAT = 111_195;

function distanceM(a: LatLng, b: LatLng) {
  const mPerDegLng =
    M_PER_DEG_LAT * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(
    (a.lat - b.lat) * M_PER_DEG_LAT,
    (a.lng - b.lng) * mPerDegLng,
  );
}

export function isSamePlace(a: Place, b: Place) {
  return distanceM(a.position, b.position) < SAME_PLACE_M;
}

/** A GPS end means "wherever I am", so it matches any other GPS end. */
function isSameTripEnd(a: Place, b: Place) {
  if (a.source === "gps" || b.source === "gps") return a.source === b.source;
  return isSamePlace(a, b);
}

function isSameTrip(trip: RecentTrip, origin: Place, destination: Place) {
  return (
    isSameTripEnd(trip.origin, origin) &&
    isSameTripEnd(trip.destination, destination)
  );
}

/** The live GPS fix changes every time, so it never becomes a recent place. */
export function recordPlace(
  state: PlacesState,
  place: Place,
  now: number,
): PlacesState {
  if (place.source === "gps") return state;
  const others = state.recentPlaces.filter((r) => !isSamePlace(r.place, place));
  return {
    ...state,
    recentPlaces: [{ place, lastUsedAt: now }, ...others].slice(0, MAX_RECENT),
  };
}

/** Records a trip whose route was shown, and both of its ends as recent places. */
export function recordTrip(
  state: PlacesState,
  origin: Place,
  destination: Place,
  now: number,
): PlacesState {
  const previous = state.recentTrips.find((t) =>
    isSameTrip(t, origin, destination),
  );
  const others = state.recentTrips.filter((t) => t !== previous);
  const trip: RecentTrip = {
    origin,
    destination,
    lastUsedAt: now,
    uses: (previous?.uses ?? 0) + 1,
  };
  const withTrip = {
    ...state,
    recentTrips: [trip, ...others].slice(0, MAX_RECENT),
  };
  return recordPlace(recordPlace(withTrip, origin, now), destination, now);
}

/**
 * Names a place. One name points at one place and one place has one name, so
 * saving replaces any saved place with the same name or at the same spot.
 */
export function savePlace(
  state: PlacesState,
  name: string,
  place: Place,
  id: string,
): PlacesState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  // A saved GPS fix is a fixed spot from now on, not "wherever I am".
  const fixed: Place =
    place.source === "gps"
      ? {
          label: pinLabel(place.position),
          position: place.position,
          source: "map",
        }
      : place;
  const replaced = state.saved.find(
    (s) => isSamePlace(s.place, fixed) || sameName(s.name, trimmed),
  );
  const entry: SavedPlace = {
    id: replaced?.id ?? id,
    name: trimmed,
    place: fixed,
  };
  const others = state.saved.filter(
    (s) => !isSamePlace(s.place, fixed) && !sameName(s.name, trimmed),
  );
  return { ...state, saved: [...others, entry] };
}

export function renamePlace(
  state: PlacesState,
  id: string,
  name: string,
): PlacesState {
  const target = state.saved.find((s) => s.id === id);
  if (!target) return state;
  return savePlace(state, name, target.place, id);
}

export function removeSaved(state: PlacesState, id: string): PlacesState {
  return { ...state, saved: state.saved.filter((s) => s.id !== id) };
}

export function forgetTrip(state: PlacesState, trip: RecentTrip): PlacesState {
  return {
    ...state,
    recentTrips: state.recentTrips.filter(
      (t) => !isSameTrip(t, trip.origin, trip.destination),
    ),
  };
}

function sameName(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

export function savedPlaceAt(
  state: PlacesState,
  place: Place,
): SavedPlace | undefined {
  if (place.source === "gps") return undefined;
  return state.saved.find((s) => isSamePlace(s.place, place));
}

/** "Stasiun Malang, Jalan Trunojoyo, Klojen" becomes "Stasiun Malang". */
export function shortLabel(label: string) {
  return label.split(",")[0].trim();
}

export function placeName(state: PlacesState, place: Place) {
  if (place.source === "gps") return "My location";
  return savedPlaceAt(state, place)?.name ?? shortLabel(place.label);
}

export function tripName(state: PlacesState, trip: RecentTrip) {
  return `${placeName(state, trip.origin)} → ${placeName(state, trip.destination)}`;
}

export type PlaceSuggestion = { place: Place; name: string | null };

/** Saved places first, then recent ones that are not also saved, filtered by `text`. */
export function placeSuggestions(
  state: PlacesState,
  text: string,
): PlaceSuggestion[] {
  const needle = text.trim().toLowerCase();
  const matches = (s: PlaceSuggestion) =>
    !needle ||
    (s.name?.toLowerCase().includes(needle) ?? false) ||
    s.place.label.toLowerCase().includes(needle);
  const saved = state.saved.map((s) => ({ place: s.place, name: s.name }));
  const recent = state.recentPlaces
    .filter((r) => !savedPlaceAt(state, r.place))
    .map((r) => ({ place: r.place, name: null }));
  return [...saved, ...recent].filter(matches);
}

/** Corrupt, foreign or older-version data starts over empty. */
export function parsePlaces(raw: string | null): PlacesState {
  if (raw === null) return EMPTY_PLACES;
  try {
    const parsed = PlacesStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_PLACES;
  } catch {
    return EMPTY_PLACES;
  }
}

const STORAGE_KEY = "pantaujalur:places";
const listeners = new Set<() => void>();
let cache: { raw: string | null; state: PlacesState } = {
  raw: null,
  state: EMPTY_PLACES,
};

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function snapshot(): PlacesState {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, state: parsePlaces(raw) };
  return cache.state;
}

function onStorage(event: StorageEvent) {
  if (event.key === STORAGE_KEY || event.key === null)
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** Applies a reducer to the stored places. A failed write (private mode, full quota) is dropped. */
export function updatePlaces(update: (state: PlacesState) => PlacesState) {
  const next = update(snapshot());
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
  for (const listener of listeners) listener();
}

/** Empty during SSR and hydration, then this device's places; tabs stay in sync. */
export function usePlaces(): PlacesState {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY_PLACES);
}
