import { queryOptions, skipToken } from "@tanstack/react-query";

import type { LatLng } from "#/domain/types";
import {
  fetchCameras,
  fetchPlaces,
  fetchPointLabel,
  fetchRoute,
} from "#/server/functions";

export const camerasQuery = queryOptions({
  queryKey: ["cameras"],
  queryFn: () => fetchCameras(),
  staleTime: 30 * 60 * 1000,
});

export const routeQuery = (
  origin: LatLng | undefined,
  destination: LatLng | undefined,
) =>
  queryOptions({
    queryKey: [
      "route",
      origin?.lat,
      origin?.lng,
      destination?.lat,
      destination?.lng,
    ],
    queryFn:
      origin && destination
        ? () => fetchRoute({ data: { origin, destination } })
        : skipToken,
    staleTime: Infinity,
    retry: 1,
  });

export const placesQuery = (text: string) =>
  queryOptions({
    queryKey: ["places", text],
    queryFn: () => fetchPlaces({ data: { text } }),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

export const pointLabelQuery = (position: LatLng) =>
  queryOptions({
    queryKey: ["point-label", position.lat, position.lng],
    queryFn: () => fetchPointLabel({ data: position }),
    staleTime: Infinity,
    retry: false,
  });
