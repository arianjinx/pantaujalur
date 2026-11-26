import type { Camera, CameraOnRoute } from "#/domain/types";

export const BUFFER_OPTIONS_M = [50, 100, 200] as const;
export type BufferM = (typeof BUFFER_OPTIONS_M)[number];

type CameraListProps = {
  camerasOnRoute: CameraOnRoute[];
  bufferM: BufferM;
  selectedCameraId: string | null;
  onBufferChange: (bufferM: BufferM) => void;
  onSelect: (camera: Camera) => void;
};

export function CameraList(props: CameraListProps) {
  const { camerasOnRoute, bufferM, selectedCameraId } = props;
  return (
    <section className="space-y-2" aria-label="Cameras along the route">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Cameras along the route ({camerasOnRoute.length})
        </h2>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          within
          <select
            className="rounded border border-slate-300 px-1 py-0.5"
            value={bufferM}
            onChange={(e) =>
              props.onBufferChange(Number(e.target.value) as BufferM)
            }
          >
            {BUFFER_OPTIONS_M.map((m) => (
              <option key={m} value={m}>
                {m} m
              </option>
            ))}
          </select>
        </label>
      </div>

      {camerasOnRoute.length === 0 ? (
        <p className="text-sm text-slate-500">
          No public cameras within {bufferM} m of this route.
        </p>
      ) : (
        <ol
          className="divide-y divide-slate-100 rounded-md border border-slate-200"
          data-testid="camera-list"
        >
          {camerasOnRoute.map(({ camera, alongM, offsetM }, index) => (
            <li key={camera.id}>
              <button
                type="button"
                onClick={() => props.onSelect(camera)}
                className={`flex w-full gap-3 px-3 py-2 text-left hover:bg-orange-50 ${
                  camera.id === selectedCameraId ? "bg-orange-50" : ""
                }`}
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500 text-[11px] font-bold text-white">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">
                    {camera.name}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {camera.district} · {formatKm(alongM)} from start ·{" "}
                    {Math.round(offsetM)} m off route
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function formatKm(meters: number) {
  return `${(meters / 1000).toFixed(1)} km`;
}
