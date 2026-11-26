import { useQuery } from "@tanstack/react-query";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { useMachine } from "@xstate/react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { type BufferM, CameraList, formatKm } from "#/components/CameraList";
import { CameraPlayer } from "#/components/CameraPlayer";
import { CameraWall } from "#/components/CameraWall";
import { PlaceInput } from "#/components/PlaceInput";
import { YourTrips } from "#/components/YourTrips";
import { camerasAlongRoute } from "#/domain/cameras-along-route";
import { routeFlowMachine } from "#/flow/route-flow-machine";
import { recordTrip, updatePlaces } from "#/places/places-store";
import { camerasQuery, routeQuery } from "#/queries";

const CctvMap = lazy(() => import("#/components/CctvMap"));

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [state, send] = useMachine(routeFlowMachine);
  const { origin, destination, locateError, selectedCamera } = state.context;
  const [bufferM, setBufferM] = useState<BufferM>(100);

  const cameras = useQuery(camerasQuery);
  const route = useQuery(routeQuery(origin?.position, destination?.position));
  const camerasOnRoute = useMemo(
    () =>
      route.data && cameras.data
        ? camerasAlongRoute(route.data, cameras.data, bufferM)
        : [],
    [route.data, cameras.data, bufferM],
  );

  useEffect(() => {
    if (route.data && origin && destination)
      updatePlaces((s) => recordTrip(s, origin, destination, Date.now()));
  }, [route.data, origin, destination]);

  const originStatus = state.matches({ origin: { auto: "locating" } })
    ? "Finding your location…"
    : state.matches({ origin: { auto: "locateFailed" } })
      ? `${locateError} Search or pick on the map instead.`
      : "Not set";

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <aside className="order-2 min-h-0 flex-1 space-y-5 overflow-y-auto border-slate-200 p-4 md:order-1 md:w-[400px] md:flex-none md:border-r">
        <header>
          <h1 className="text-lg font-bold">Malang CCTV Route</h1>
          <p className="text-sm text-slate-500">
            Fastest driving route and the public city cameras along it.
          </p>
        </header>

        <YourTrips
          onChoose={(tripOrigin, tripDestination) =>
            send({
              type: "TRIP_CHOSEN",
              origin: tripOrigin,
              destination: tripDestination,
            })
          }
        />

        <PlaceInput
          field="origin"
          title="From"
          place={origin}
          status={originStatus}
          picking={state.matches({ mapPick: "origin" })}
          extraAction={
            <button
              type="button"
              className="btn"
              onClick={() => send({ type: "USE_MY_LOCATION" })}
            >
              Use my location
            </button>
          }
          onChoose={(place) =>
            send({ type: "PLACE_CHOSEN", field: "origin", place })
          }
          onClear={() => send({ type: "PLACE_CLEARED", field: "origin" })}
          onPickOnMap={() => send({ type: "PICK_ON_MAP", field: "origin" })}
          onCancelPick={() => send({ type: "CANCEL_MAP_PICK" })}
        />

        <PlaceInput
          field="destination"
          title="To"
          place={destination}
          status="Not set"
          picking={state.matches({ mapPick: "destination" })}
          onChoose={(place) =>
            send({ type: "PLACE_CHOSEN", field: "destination", place })
          }
          onClear={() => send({ type: "PLACE_CLEARED", field: "destination" })}
          onPickOnMap={() =>
            send({ type: "PICK_ON_MAP", field: "destination" })
          }
          onCancelPick={() => send({ type: "CANCEL_MAP_PICK" })}
        />

        {cameras.isError && (
          <p className="text-sm text-red-600">
            Could not load the city camera list.
          </p>
        )}

        {origin && destination && (
          <section
            aria-label="Route summary"
            className="rounded-md border border-slate-200 p-3 text-sm"
          >
            {route.isPending && (
              <p className="text-slate-500">Finding the fastest route…</p>
            )}
            {route.isError && (
              <p className="text-red-600">{route.error.message}</p>
            )}
            {route.data && (
              <p data-testid="route-summary">
                <span className="font-semibold">
                  {formatKm(route.data.distanceM)}
                </span>{" "}
                ·{" "}
                <span className="font-semibold">
                  {Math.round(route.data.durationS / 60)} min
                </span>{" "}
                by car
              </p>
            )}
          </section>
        )}

        {route.data && camerasOnRoute.length > 0 && (
          <button
            type="button"
            className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            onClick={() => send({ type: "WALL_OPENED" })}
          >
            Watch all cameras on this route ({camerasOnRoute.length})
          </button>
        )}

        {route.data && (
          <CameraList
            camerasOnRoute={camerasOnRoute}
            bufferM={bufferM}
            selectedCameraId={selectedCamera?.id ?? null}
            onBufferChange={setBufferM}
            onSelect={(camera) => send({ type: "CAMERA_SELECTED", camera })}
          />
        )}
      </aside>

      <main className="relative order-1 h-[45dvh] shrink-0 md:order-2 md:h-auto md:flex-1">
        <ClientOnly fallback={<MapPlaceholder />}>
          <Suspense fallback={<MapPlaceholder />}>
            <CctvMap
              cameras={cameras.data ?? []}
              camerasOnRoute={camerasOnRoute}
              route={route.data}
              origin={origin}
              destination={destination}
              selectedCameraId={selectedCamera?.id ?? null}
              picking={!state.matches({ mapPick: "off" })}
              onMapClick={(position) => send({ type: "MAP_CLICKED", position })}
              onCameraClick={(camera) =>
                send({ type: "CAMERA_SELECTED", camera })
              }
            />
          </Suspense>
        </ClientOnly>
      </main>

      {state.matches({ viewer: "wall" }) &&
        route.data &&
        origin &&
        destination && (
          <CameraWall
            camerasOnRoute={camerasOnRoute}
            origin={origin}
            destination={destination}
            route={route.data}
            interactive={state.matches({ viewer: { wall: "grid" } })}
            onWatchLive={(camera) => send({ type: "CAMERA_SELECTED", camera })}
            onClose={() => send({ type: "WALL_CLOSED" })}
          />
        )}

      {selectedCamera && (
        <CameraPlayer
          key={selectedCamera.id}
          camera={selectedCamera}
          onClose={() => send({ type: "PLAYER_CLOSED" })}
        />
      )}
    </div>
  );
}

function MapPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-slate-500">
      Loading map…
    </div>
  );
}
