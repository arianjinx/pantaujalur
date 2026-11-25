import { latLngBounds } from "leaflet";
import { useEffect, useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";

import {
  type Camera,
  type CameraOnRoute,
  type LatLng,
  MALANG_CENTER,
  type Place,
  type Route,
} from "#/domain/types";

type CctvMapProps = {
  cameras: Camera[];
  camerasOnRoute: CameraOnRoute[];
  route: Route | undefined;
  origin: Place | null;
  destination: Place | null;
  selectedCameraId: string | null;
  picking: boolean;
  onMapClick: (position: LatLng) => void;
  onCameraClick: (camera: Camera) => void;
};

export default function CctvMap(props: CctvMapProps) {
  const {
    cameras,
    camerasOnRoute,
    route,
    origin,
    destination,
    selectedCameraId,
  } = props;
  const onRouteIds = useMemo(
    () => new Set(camerasOnRoute.map((c) => c.camera.id)),
    [camerasOnRoute],
  );

  return (
    <MapContainer
      center={MALANG_CENTER}
      zoom={13}
      className={
        props.picking ? "h-full w-full cursor-crosshair" : "h-full w-full"
      }
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onClick={props.onMapClick} />
      <FitToSelection route={route} origin={origin} destination={destination} />

      {route && (
        <Polyline
          positions={route.path}
          pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.8 }}
        />
      )}

      {cameras
        .filter((camera) => !onRouteIds.has(camera.id))
        .map((camera) => (
          <CircleMarker
            key={camera.id}
            center={camera.position}
            radius={4}
            bubblingMouseEvents={false}
            pathOptions={{
              color: "#334155",
              weight: 1,
              fillColor: "#64748b",
              fillOpacity: 0.55,
              opacity: 0.7,
            }}
            eventHandlers={{ click: () => props.onCameraClick(camera) }}
          >
            <Tooltip>{camera.name}</Tooltip>
          </CircleMarker>
        ))}

      {camerasOnRoute.map(({ camera }, index) => (
        <CircleMarker
          key={camera.id}
          center={camera.position}
          radius={camera.id === selectedCameraId ? 10 : 7}
          bubblingMouseEvents={false}
          pathOptions={{
            color: "#9a3412",
            weight: 2,
            fillColor: "#f97316",
            fillOpacity: 0.95,
          }}
          eventHandlers={{ click: () => props.onCameraClick(camera) }}
        >
          <Tooltip>
            {index + 1}. {camera.name}
          </Tooltip>
        </CircleMarker>
      ))}

      {origin && <Endpoint place={origin} color="#16a34a" title="Origin" />}
      {destination && (
        <Endpoint place={destination} color="#dc2626" title="Destination" />
      )}
    </MapContainer>
  );
}

function Endpoint({
  place,
  color,
  title,
}: {
  place: Place;
  color: string;
  title: string;
}) {
  return (
    <CircleMarker
      center={place.position}
      radius={9}
      pathOptions={{
        color: "#fff",
        weight: 3,
        fillColor: color,
        fillOpacity: 1,
      }}
    >
      <Tooltip permanent direction="top" offset={[0, -8]}>
        {title}
      </Tooltip>
    </CircleMarker>
  );
}

function ClickHandler({ onClick }: { onClick: (position: LatLng) => void }) {
  useMapEvents({
    click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  return null;
}

function FitToSelection({
  route,
  origin,
  destination,
}: Pick<CctvMapProps, "route" | "origin" | "destination">) {
  const map = useMap();
  useEffect(() => {
    const points = route
      ? route.path
      : [origin?.position, destination?.position].filter(
          (p) => p !== undefined,
        );
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], Math.max(map.getZoom(), 14));
    } else {
      map.fitBounds(latLngBounds(points), { padding: [40, 40] });
    }
  }, [map, route, origin?.position, destination?.position]);
  return null;
}
