import { createFileRoute } from "@tanstack/react-router";

import { getCameras } from "#/server/cctv-cameras";
import { cctvUnavailableResponse } from "#/server/cctv-session";

export const Route = createFileRoute("/api/cameras")({
  server: {
    handlers: {
      GET: () => getCameras().then(Response.json, cctvUnavailableResponse),
    },
  },
});
