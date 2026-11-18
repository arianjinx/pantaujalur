export type LatLng = { lat: number; lng: number };

export type Camera = {
  id: string;
  name: string;
  streamId: string;
  address: string;
  district: string;
  position: LatLng;
};

export type Place = {
  label: string;
  position: LatLng;
  source: "gps" | "search" | "map";
};

export type Route = { path: LatLng[]; distanceM: number; durationS: number };

export type CameraOnRoute = {
  camera: Camera;
  /** Perpendicular distance from the camera to the route, in meters. */
  offsetM: number;
  /** Distance from the origin along the route to the camera's projection, in meters. */
  alongM: number;
};

export const MALANG_CENTER: LatLng = { lat: -7.9778, lng: 112.6339 };

export function pinLabel({ lat, lng }: LatLng) {
  return `Pin at ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
