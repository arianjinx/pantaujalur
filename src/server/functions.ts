import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getCameras } from "./cctv-cameras";
import { describePoint, fastestDrivingRoute, searchPlaces } from "./geo";

const LatLngInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const fetchCameras = createServerFn({ method: "GET" }).handler(() =>
  getCameras(),
);

export const fetchRoute = createServerFn({ method: "GET" })
  .validator(z.object({ origin: LatLngInput, destination: LatLngInput }))
  .handler(({ data }) => fastestDrivingRoute(data.origin, data.destination));

export const fetchPlaces = createServerFn({ method: "GET" })
  .validator(z.object({ text: z.string().trim().min(2).max(200) }))
  .handler(({ data }) => searchPlaces(data.text));

export const fetchPointLabel = createServerFn({ method: "GET" })
  .validator(LatLngInput)
  .handler(({ data }) => describePoint(data));
