import { assertEvent, assign, fromPromise, raise, setup } from "xstate";

import {
  type Camera,
  type LatLng,
  pinLabel,
  type Place,
} from "../domain/types";

export type PlaceField = "origin" | "destination";

type RouteFlowContext = {
  origin: Place | null;
  destination: Place | null;

  locateError: string | null;

  selectedCamera: Camera | null;
};

type RouteFlowEvent =
  | { type: "USE_MY_LOCATION" }
  | { type: "PLACE_CHOSEN"; field: PlaceField; place: Place }
  | { type: "TRIP_CHOSEN"; origin: Place; destination: Place }
  | { type: "PLACE_CLEARED"; field: PlaceField }
  | { type: "PICK_ON_MAP"; field: PlaceField }
  | { type: "CANCEL_MAP_PICK" }
  | { type: "MAP_CLICKED"; position: LatLng }
  | { type: "CAMERA_SELECTED"; camera: Camera }
  | { type: "PLAYER_CLOSED" }
  | { type: "WALL_OPENED" }
  | { type: "WALL_CLOSED" };

const GEOLOCATION_ERRORS: Record<number, string> = {
  1: "Location permission was denied.",
  2: "Your position is unavailable.",
  3: "Timed out while finding your position.",
};

const locateWithBrowser = fromPromise<LatLng>(
  () =>
    new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("This browser cannot share its location."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        ({ coords }) =>
          resolve({ lat: coords.latitude, lng: coords.longitude }),
        (error) =>
          reject(new Error(GEOLOCATION_ERRORS[error.code] ?? error.message)),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      );
    }),
);

export const routeFlowMachine = setup({
  types: { context: {} as RouteFlowContext, events: {} as RouteFlowEvent },
  actors: { locate: locateWithBrowser },
  actions: {
    selectCamera: assign({
      selectedCamera: ({ event }) => {
        assertEvent(event, "CAMERA_SELECTED");
        return event.camera;
      },
    }),
    clearCamera: assign({ selectedCamera: null }),
  },
}).createMachine({
  id: "routeFlow",
  type: "parallel",
  context: {
    origin: null,
    destination: null,
    locateError: null,
    selectedCamera: null,
  },
  on: {
    PLACE_CHOSEN: {
      guard: ({ event }) => event.field === "destination",
      actions: assign({ destination: ({ event }) => event.place }),
    },
    PLACE_CLEARED: {
      guard: ({ event }) => event.field === "destination",
      actions: assign({ destination: null }),
    },
  },
  states: {
    origin: {
      initial: "auto",
      on: {
        USE_MY_LOCATION: ".auto.locating",
        PLACE_CHOSEN: {
          guard: ({ event }) => event.field === "origin",
          target: ".manual",
          actions: assign({ origin: ({ event }) => event.place }),
        },
        PLACE_CLEARED: {
          guard: ({ event }) => event.field === "origin",
          target: ".manual",
          actions: assign({ origin: null }),
        },

        TRIP_CHOSEN: [
          {
            guard: ({ event }) => event.origin.source === "gps",
            target: ".auto",
            actions: assign({ destination: ({ event }) => event.destination }),
          },
          {
            target: ".manual",
            actions: assign({
              origin: ({ event }) => event.origin,
              destination: ({ event }) => event.destination,
            }),
          },
        ],
      },
      states: {
        auto: {
          initial: "locating",
          states: {
            locating: {
              entry: assign({ origin: null, locateError: null }),
              invoke: {
                src: "locate",
                onDone: {
                  target: "located",
                  actions: assign({
                    origin: ({ event }) => ({
                      label: "My location",
                      position: event.output,
                      source: "gps" as const,
                    }),
                  }),
                },
                onError: {
                  target: "locateFailed",
                  actions: assign({
                    locateError: ({ event }) =>
                      event.error instanceof Error
                        ? event.error.message
                        : String(event.error),
                  }),
                },
              },
            },
            located: {},
            locateFailed: {},
          },
        },
        manual: {},
      },
    },
    mapPick: {
      initial: "off",
      on: {
        PICK_ON_MAP: [
          { guard: ({ event }) => event.field === "origin", target: ".origin" },
          { target: ".destination" },
        ],
        CANCEL_MAP_PICK: ".off",
      },
      states: {
        off: {},
        origin: {
          on: {
            MAP_CLICKED: {
              target: "off",
              actions: raise(({ event }) => ({
                type: "PLACE_CHOSEN" as const,
                field: "origin" as const,
                place: {
                  label: pinLabel(event.position),
                  position: event.position,
                  source: "map" as const,
                },
              })),
            },
          },
        },
        destination: {
          on: {
            MAP_CLICKED: {
              target: "off",
              actions: raise(({ event }) => ({
                type: "PLACE_CHOSEN" as const,
                field: "destination" as const,
                place: {
                  label: pinLabel(event.position),
                  position: event.position,
                  source: "map" as const,
                },
              })),
            },
          },
        },
      },
    },
    viewer: {
      initial: "closed",
      states: {
        closed: {
          on: {
            CAMERA_SELECTED: { target: "single", actions: "selectCamera" },
            WALL_OPENED: "wall",
          },
        },
        single: {
          on: {
            CAMERA_SELECTED: { actions: "selectCamera" },
            PLAYER_CLOSED: "closed",
          },
          exit: "clearCamera",
        },
        wall: {
          initial: "grid",
          on: { WALL_CLOSED: "closed" },
          states: {
            grid: {
              on: {
                CAMERA_SELECTED: { target: "single", actions: "selectCamera" },
              },
            },
            single: {
              on: {
                CAMERA_SELECTED: { actions: "selectCamera" },
                PLAYER_CLOSED: "grid",
              },
              exit: "clearCamera",
            },
          },
        },
      },
    },
  },
});
