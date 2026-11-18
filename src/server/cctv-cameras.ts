import { z } from "zod";

import type { Camera } from "#/domain/types";

import {
  cctvFetch,
  CctvUnavailable,
  SESSION_REJECTED,
  withCctvSession,
} from "./cctv-session";

const ALL_DISTRICTS = "99";
const CACHE_TTL_MS = 10 * 60 * 1000;

const coordinate = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .transform(Number);

const CameraRow = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    stream_id: z.string().regex(/^\d+$/),
    address: z.string().nullish(),
    latitude: coordinate,
    longitude: coordinate,
    nama_kecamatan: z.string(),
  })
  .transform((row): Camera => ({
    id: row.id,
    name: row.name.trim(),
    streamId: row.stream_id,
    address: row.address?.trim() ?? "",
    district: row.nama_kecamatan,
    position: { lat: row.latitude, lng: row.longitude },
  }));

const CamerasResponse = z.object({
  msg_main: z.object({ status: z.boolean() }),
  msg_detail: z.unknown(),
});
const CamerasDetail = z.object({ list_data: z.array(z.unknown()) });

async function fetchCameras(): Promise<Camera[]> {
  const rows = await withCctvSession(async (headers) => {
    const form = new FormData();
    form.set("m_kecamatan_id", ALL_DISTRICTS);
    const response = await cctvFetch("/api/v2/get-cameras", {
      method: "POST",
      headers,
      body: form,
    });
    if (response.status === 403) return SESSION_REJECTED;
    if (!response.ok)
      throw new CctvUnavailable(
        `CCTV camera list failed (HTTP ${response.status})`,
      );
    const body = CamerasResponse.parse(await response.json());
    if (!body.msg_main.status) return SESSION_REJECTED;
    return CamerasDetail.parse(body.msg_detail).list_data;
  });

  const cameras: Camera[] = [];
  for (const row of rows) {
    const parsed = CameraRow.safeParse(row);
    if (parsed.success) cameras.push(parsed.data);
  }
  if (cameras.length < rows.length) {
    console.warn(
      `Skipped ${rows.length - cameras.length} malformed camera rows`,
    );
  }
  return cameras;
}

// Holds resolved data only: on Workers a promise owned by one request cannot be
// awaited safely by another.
let cache: { cameras: Camera[]; fetchedAt: number } | null = null;

/** All public city cameras, cached in memory for a few minutes. */
export async function getCameras(): Promise<Camera[]> {
  if (cache !== null && Date.now() - cache.fetchedAt < CACHE_TTL_MS)
    return cache.cameras;
  const cameras = await fetchCameras();
  cache = { cameras, fetchedAt: Date.now() };
  return cameras;
}
