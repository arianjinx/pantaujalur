import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { Camera, CameraOnRoute, Place, Route } from "#/domain/types";

import { formatKm } from "./CameraList";
import { captureFrame } from "./captureFrame";
import { failureStore, frameStore } from "./frameStore";
import {
  capturePriority,
  createSnapshotQueue,
  type Frame,
  isStale,
  type Snapshot,
  type SnapshotQueue,
} from "./snapshotQueue";

type Layout = { cols: number; rows: number };

const LAYOUTS: { query: string; layout: Layout }[] = [
  { query: "(min-width: 1024px)", layout: { cols: 3, rows: 2 } },
  { query: "(min-width: 640px)", layout: { cols: 2, rows: 2 } },
  { query: "(min-height: 760px)", layout: { cols: 1, rows: 3 } },
  { query: "(min-height: 560px)", layout: { cols: 1, rows: 2 } },
  { query: "all", layout: { cols: 1, rows: 1 } },
];
const GAP_PX = 8;
const SCROLL_SETTLE_MS = 100;
const CLOCK_TICK_MS = 15_000;

type WallEntry = CameraOnRoute & { order: number };

type CameraWallProps = {
  camerasOnRoute: CameraOnRoute[];
  origin: Place;
  destination: Place;
  route: Route;

  interactive: boolean;
  onWatchLive: (camera: Camera) => void;
  onClose: () => void;
};

export function CameraWall(props: CameraWallProps) {
  const {
    camerasOnRoute,
    origin,
    destination,
    route,
    interactive,
    onWatchLive,
    onClose,
  } = props;
  const { cols, rows } = useLayout();
  const pageSize = cols * rows;
  const pages = useMemo(() => {
    const entries = camerasOnRoute.map((c, index) => ({
      ...c,
      order: index + 1,
    }));
    const result: WallEntry[][] = [];
    for (let i = 0; i < entries.length; i += pageSize)
      result.push(entries.slice(i, i + pageSize));
    return result;
  }, [camerasOnRoute, pageSize]);

  const [firstIndex, setFirstIndex] = useState(0);
  const activePage = Math.min(
    Math.floor(firstIndex / pageSize),
    pages.length - 1,
  );
  const cameras = useMemo(
    () => camerasOnRoute.map((c) => c.camera),
    [camerasOnRoute],
  );
  const { queue, snapshots } = useSnapshots(cameras);
  useEffect(() => {
    queue?.prioritize(
      capturePriority(
        cameras.map((c) => c.id),
        pageSize,
        activePage,
      ),
    );
  }, [queue, cameras, pageSize, activePage]);
  const now = useNow(CLOCK_TICK_MS);
  useEffect(() => queue?.refreshStale(), [queue, now]);
  let settled = 0;
  let capturing = 0;
  for (const snapshot of snapshots.values()) {
    if (snapshot.kind === "captured" || snapshot.kind === "offline") settled++;
    if (snapshot.kind === "capturing") capturing++;
  }

  const scrollerRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const goToPage = (page: number) => {
    const scroller = scrollerRef.current;
    const target = Math.max(0, Math.min(page, pages.length - 1));
    if (!scroller || target === activePage) return;
    setFirstIndex(target * pageSize);
    scroller.scrollTo({
      left: target * scroller.clientWidth,
      behavior: "smooth",
    });
  };

  const onScroll = () => {
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const scroller = scrollerRef.current;
      if (scroller)
        setFirstIndex(
          Math.round(scroller.scrollLeft / scroller.clientWidth) * pageSize,
        );
    }, SCROLL_SETTLE_MS);
  };
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  const scrolledPageSize = useRef(pageSize);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || scrolledPageSize.current === pageSize) return;
    scrolledPageSize.current = pageSize;
    scroller.scrollLeft = activePage * scroller.clientWidth;
  }, [pageSize, activePage]);

  useEffect(() => {
    if (!interactive) return;
    const onKey = (e: KeyboardEvent) => {
      const action: Record<string, () => void> = {
        Escape: onClose,
        ArrowLeft: () => goToPage(activePage - 1),
        ArrowRight: () => goToPage(activePage + 1),
        Home: () => goToPage(0),
        End: () => goToPage(pages.length - 1),
      };
      const run = action[e.key];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const page = pages[activePage] ?? [];
  const first = page[0];
  const last = page[page.length - 1];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="All cameras on the route"
      data-testid="camera-wall"
      data-captures-in-flight={capturing}
      className="fixed inset-0 z-[1500] flex flex-col bg-slate-950 text-slate-100"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0 flex-1 basis-full lg:basis-0">
          <p
            className="truncate text-sm font-semibold"
            title={`${origin.label} → ${destination.label}`}
          >
            {shortLabel(origin)} → {shortLabel(destination)}
          </p>
          <p className="text-xs text-slate-400">
            {formatKm(route.distanceM)} · {Math.round(route.durationS / 60)} min
            · {camerasOnRoute.length} cameras ·{" "}
            <span className="tabular-nums" data-testid="wall-snapshot-progress">
              Snapshots {settled}/{cameras.length}
            </span>
          </p>
        </div>
        {first && last && (
          <p
            className="text-xs text-slate-300 tabular-nums"
            data-testid="wall-page-indicator"
          >
            {pageIndicator(first, last, camerasOnRoute.length)}
          </p>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="wall-btn mr-1 px-3"
            onClick={() => queue?.refreshAll()}
          >
            Refresh all
          </button>
          <WallButton
            label="Previous page"
            disabled={activePage === 0}
            onClick={() => goToPage(activePage - 1)}
          >
            ‹
          </WallButton>
          <WallButton
            label="Next page"
            disabled={activePage >= pages.length - 1}
            onClick={() => goToPage(activePage + 1)}
          >
            ›
          </WallButton>
          <FullscreenToggle />
          <button
            type="button"
            className="wall-btn ml-1 px-3"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </header>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        data-testid="wall-scroller"
        className="flex min-h-0 flex-1 snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto overflow-y-hidden"
      >
        {pages.map((entries, index) => (
          <section
            key={index}
            aria-label={`Page ${index + 1} of ${pages.length}`}
            data-testid="wall-page"
            data-active={index === activePage}
            className="[container-type:size] flex h-full w-full shrink-0 snap-start snap-always items-center justify-center p-2"
          >
            <div
              className="grid"
              style={{
                gap: GAP_PX,
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,

                width: `min(100cqw, calc((100cqh - ${(rows - 1) * GAP_PX}px) * 16 / 9 * ${cols} / ${rows} + ${(cols - 1) * GAP_PX}px))`,
              }}
            >
              {entries.map((entry) => (
                <SnapshotTile
                  key={entry.camera.id}
                  entry={entry}
                  snapshot={snapshots.get(entry.camera.id) ?? PENDING}
                  now={now}
                  onRefresh={() => queue?.refresh(entry.camera.id)}
                  onWatchLive={() => onWatchLive(entry.camera)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <nav
        aria-label="Wall pages"
        className="flex items-center gap-1 px-3 pt-1 pb-3"
      >
        <span className="shrink-0 text-[10px] tracking-wide text-slate-500 uppercase">
          Start
        </span>
        {pages.map((entries, index) => (
          <button
            key={index}
            type="button"
            aria-label={`Page ${index + 1}: cameras ${entries[0].order}–${entries[entries.length - 1].order}`}
            aria-current={index === activePage ? "page" : undefined}
            onClick={() => goToPage(index)}
            className="group flex h-4 min-w-0 flex-1 items-center"
          >
            <span
              className={`h-1 w-full rounded-full ${
                index === activePage
                  ? "bg-orange-400"
                  : "bg-white/20 group-hover:bg-white/40"
              }`}
            />
          </button>
        ))}
        <span className="shrink-0 text-[10px] tracking-wide text-slate-500 uppercase">
          Destination
        </span>
      </nav>
    </div>
  );
}

const PENDING: Snapshot = { kind: "pending" };

const STALE_BADGE = { text: "Stale", className: "bg-slate-500 text-slate-200" };
const LAST_SEEN_BADGE = {
  text: "Last seen",
  className: "bg-slate-500 text-slate-100",
};
const BADGES: Record<Snapshot["kind"], { text: string; className: string }> = {
  pending: { text: "Updating", className: "bg-amber-400 text-slate-950" },
  capturing: { text: "Updating", className: "bg-amber-400 text-slate-950" },
  captured: { text: "Snapshot", className: "bg-sky-600 text-white" },
  offline: { text: "No signal", className: "bg-slate-600 text-slate-100" },
};

function SnapshotTile(props: {
  entry: WallEntry;
  snapshot: Snapshot;
  now: number;
  onRefresh: () => void;
  onWatchLive: () => void;
}) {
  const { entry, snapshot, now } = props;
  const { camera, alongM, order } = entry;
  const frame =
    snapshot.kind === "captured" ? snapshot.frame : snapshot.previous;
  const badge =
    snapshot.kind === "pending" && frame && isStale(frame.capturedAt, now)
      ? STALE_BADGE
      : snapshot.kind === "captured" && frame?.endedAt
        ? LAST_SEEN_BADGE
        : BADGES[snapshot.kind];
  const busy = snapshot.kind === "pending" || snapshot.kind === "capturing";
  return (
    <div
      data-testid="wall-tile"
      data-order={order}
      data-along-m={alongM.toFixed(1)}
      data-stream-id={camera.streamId}
      data-snapshot={snapshot.kind}
      data-captured-at={frame?.capturedAt.toISOString()}
      className="relative aspect-video overflow-hidden rounded-md bg-slate-900 ring-1 ring-white/10 focus-within:ring-2 focus-within:ring-orange-400 hover:ring-2 hover:ring-orange-400"
    >
      <button
        type="button"
        onClick={props.onRefresh}
        aria-label={`Refresh the snapshot of camera ${order}: ${camera.name}`}
        className="absolute inset-0 focus-visible:outline-none"
      >
        {frame && (
          <img
            src={frame.url}
            alt=""
            data-testid="wall-snapshot"
            className={`h-full w-full object-cover ${snapshot.kind === "offline" ? "opacity-70" : ""}`}
          />
        )}
      </button>
      {busy && (
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/40 text-xs text-slate-200">
          <span
            className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white"
            aria-hidden
          />
          {!frame && (snapshot.kind === "pending" ? "Queued" : "Capturing…")}
        </span>
      )}
      {snapshot.kind === "offline" && !frame && (
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center text-xs text-slate-200">
          <span className="font-semibold">No signal right now</span>
          <span className="text-slate-400">
            Retries on its own · tap to try now
          </span>
        </span>
      )}
      <span className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-2">
        <span className="flex items-center gap-1.5">
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-orange-500 px-1 text-xs font-bold text-white">
            {order}
          </span>
          <span className="rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
            km {kmNumber(alongM)}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          {frame && (
            <span
              className="rounded bg-black/60 px-1.5 py-0.5 text-[11px] tabular-nums"
              data-testid="wall-tile-time"
            >
              {frameTime(frame, now)}
            </span>
          )}
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${badge.className}`}
            data-testid="wall-tile-status"
          >
            {badge.text}
          </span>
        </span>
      </span>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-black/85 to-transparent p-2 pt-6">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-tight font-semibold">
            {camera.name}
          </span>
          <span className="block truncate text-[11px] text-slate-300">
            {camera.district}
          </span>
        </span>
        <button
          type="button"
          onClick={props.onWatchLive}
          aria-label={`Watch camera ${order} live: ${camera.name}`}
          className="pointer-events-auto shrink-0 rounded bg-red-600 px-2 py-1 text-[11px] font-bold tracking-wide text-white uppercase hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          ▶ Live
        </button>
      </span>
    </div>
  );
}

function useSnapshots(cameras: Camera[]) {
  const [queue, setQueue] = useState<SnapshotQueue | null>(null);
  useEffect(() => {
    let created: SnapshotQueue | null = null;
    let closed = false;
    void frameStore.load(cameras.map((c) => c.id)).then((cached) => {
      if (closed) return;
      created = createSnapshotQueue({
        cameras,
        cached,
        failures: failureStore.load(),
        capture: captureFrame,
        persist: (id, frame) => void frameStore.save(id, frame),
        persistFailure: (id, at) => failureStore.save(id, at),
      });
      setQueue(created);
    });
    return () => {
      closed = true;
      created?.dispose();
    };
  }, [cameras]);
  const snapshots = useSyncExternalStore(
    queue?.subscribe ?? subscribeNothing,
    queue?.getSnapshots ?? noSnapshots,
    noSnapshots,
  );
  return { queue, snapshots };
}

const NO_SNAPSHOTS: ReadonlyMap<string, Snapshot> = new Map();
const noSnapshots = () => NO_SNAPSHOTS;
const subscribeNothing = () => () => {};

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function frameTime({ capturedAt, endedAt }: Frame, now: number) {
  const takenAt = endedAt ?? capturedAt;
  const clock = [takenAt.getHours(), takenAt.getMinutes(), takenAt.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  const minutes = Math.floor((now - takenAt.getTime()) / 60_000);
  const ago =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${minutes} min ago`
        : `${Math.floor(minutes / 60)} h ago`;
  return `${clock} · ${ago}`;
}

function WallButton(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="wall-btn w-8 text-base leading-none"
    >
      {props.children}
    </button>
  );
}

function FullscreenToggle() {
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement !== null,
    () => false,
  );
  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen();
    },
    [],
  );
  if (!document.fullscreenEnabled) return null;
  return (
    <button
      type="button"
      className="wall-btn px-3"
      onClick={() =>
        isFullscreen
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen()
      }
    >
      {isFullscreen ? "Exit full screen" : "Full screen"}
    </button>
  );
}

function subscribeFullscreen(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

function useLayout(): Layout {
  const index = useSyncExternalStore(
    subscribeLayout,
    currentLayoutIndex,
    () => 0,
  );
  return LAYOUTS[index].layout;
}

function subscribeLayout(onChange: () => void) {
  const lists = LAYOUTS.map(({ query }) => window.matchMedia(query));
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}

function currentLayoutIndex() {
  return LAYOUTS.findIndex(({ query }) => window.matchMedia(query).matches);
}

function pageIndicator(first: WallEntry, last: WallEntry, total: number) {
  const cameras =
    first === last
      ? `Camera ${first.order}`
      : `Cameras ${first.order}–${last.order}`;
  const [fromKm, toKm] = [kmNumber(first.alongM), kmNumber(last.alongM)];
  return `${cameras} of ${total} · km ${fromKm === toKm ? fromKm : `${fromKm}–${toKm}`}`;
}

function kmNumber(meters: number) {
  return (meters / 1000).toFixed(1);
}

function shortLabel(place: Place) {
  return place.label.split(",")[0];
}
