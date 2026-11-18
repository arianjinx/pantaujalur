import {
  AbsoluteFill,
  Freeze,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";

import {
  type Box,
  edited,
  outputTime,
  type Part,
  parts,
  type Timeline,
  WAIT_SPEED,
} from "./timeline";

export const FPS = 30;
export const FRAME = 1080;
const BAND = 240;
const APP = { width: FRAME, height: FRAME - BAND };
const MAX_ZOOM = 2.2;
/** Room around a focused area, as a fraction of its size. */
const MARGIN = 0.12;
const FONT =
  '"SF Pro Display", -apple-system, "Helvetica Neue", Arial, sans-serif';
const INK = "#0f172a";
const ORANGE = "#f97316";

/** Where the camera looks: zoom, and the point of the window at the frame's centre. */
type Camera = { zoom: number; cx: number; cy: number };
const WHOLE: Camera = { zoom: 1, cx: 0.5, cy: 0.5 };

function cameraOn(box: Box | null): Camera {
  if (!box) return WHOLE;
  const w = box.w * (1 + 2 * MARGIN);
  const h = box.h * (1 + 2 * MARGIN);
  const zoom = Math.max(1, Math.min(MAX_ZOOM, 1 / w, 1 / h));
  const half = 0.5 / zoom;
  const clamp = (v: number) => Math.min(1 - half, Math.max(half, v));
  return {
    zoom,
    cx: clamp(box.x + box.w / 2),
    cy: clamp(box.y + box.h / 2),
  };
}

function mix(a: Camera, b: Camera, p: number): Camera {
  return {
    zoom: a.zoom + (b.zoom - a.zoom) * p,
    cx: a.cx + (b.cx - a.cx) * p,
    cy: a.cy + (b.cy - a.cy) * p,
  };
}

/** The camera at `frame`: each focus eases from wherever the camera was when it began. */
function cameraAt(
  frame: number,
  keys: { frame: number; target: Camera }[],
): Camera {
  let camera = WHOLE;
  for (const [i, key] of keys.entries()) {
    if (key.frame > frame) break;
    const until = Math.min(frame, keys[i + 1]?.frame ?? frame);
    const p = spring({
      frame: until - key.frame,
      fps: FPS,
      config: { damping: 200 },
      durationInFrames: 20,
    });
    camera = mix(camera, key.target, p);
  }
  return camera;
}

function Footage({ cut }: { cut: Part[] }) {
  return (
    <>
      {cut.map((part) => {
        const from = Math.round(outputTime(cut, part.start) * FPS);
        const to = Math.round(outputTime(cut, part.end) * FPS);
        if (to <= from || part.speed === Infinity) return null;
        return (
          <Sequence key={part.start} from={from} durationInFrames={to - from}>
            <OffthreadVideo
              src={staticFile("raw.mp4")}
              trimBefore={Math.round(part.start * FPS)}
              playbackRate={part.speed}
              muted
              style={{ width: APP.width, height: APP.height }}
            />
          </Sequence>
        );
      })}
    </>
  );
}

function CaptionBand({
  title,
  detail,
  enteredAt,
  frame,
  progress,
  fastForward,
}: {
  title: string;
  detail?: string;
  enteredAt: number;
  frame: number;
  progress: number;
  fastForward: boolean;
}) {
  const p = spring({
    frame: frame - enteredAt,
    fps: FPS,
    config: { damping: 200 },
    durationInFrames: 12,
  });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        height: BAND,
        background: INK,
        padding: "0 56px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 10,
        fontFamily: FONT,
      }}
    >
      {title !== "PantauJalur" && (
        <div
          style={{
            color: ORANGE,
            fontWeight: 800,
            fontSize: 26,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          PantauJalur · live traffic cams on your route
        </div>
      )}
      <div
        style={{
          color: "white",
          fontWeight: 800,
          fontSize: 60,
          lineHeight: 1.05,
          letterSpacing: "-0.01em",
          opacity: p,
          transform: `translateY(${(1 - p) * 18}px)`,
        }}
      >
        {title}
      </div>
      {detail && (
        <div
          style={{
            color: "#cbd5e1",
            fontWeight: 500,
            fontSize: 32,
            lineHeight: 1.2,
            opacity: p,
          }}
        >
          {detail}
        </div>
      )}
      {fastForward && (
        <div
          style={{
            position: "absolute",
            right: 28,
            top: 24,
            padding: "6px 14px",
            borderRadius: 999,
            background: ORANGE,
            color: "white",
            fontWeight: 800,
            fontSize: 24,
          }}
        >
          ⏩ {WAIT_SPEED}× faster
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          height: 6,
          width: "100%",
          background: "#1e293b",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress * 100}%`,
            background: ORANGE,
          }}
        />
      </div>
    </div>
  );
}

function Main({ timeline }: { timeline: Timeline }) {
  const frame = useCurrentFrame();
  const cut = parts(edited(timeline));
  const toFrame = (t: number) => Math.round(outputTime(cut, t) * FPS);
  const total = toFrame(timeline.totalS);

  const keys = timeline.focus.map((f) => ({
    frame: toFrame(f.at),
    target: cameraOn(f.box),
  }));
  const camera = cameraAt(frame, keys);
  const tx = APP.width / 2 - camera.cx * APP.width * camera.zoom;
  const ty = APP.height / 2 - camera.cy * APP.height * camera.zoom;

  const captions = timeline.captions.map((c) => ({
    ...c,
    frame: toFrame(c.at),
  }));
  const index = Math.max(
    0,
    captions.findLastIndex((c) => c.frame <= frame),
  );
  const current = captions[index];
  // A caption that only changes its detail keeps its title still.
  let enteredAt = current?.frame ?? 0;
  for (let i = index; i > 0 && captions[i - 1].title === current?.title; i--)
    enteredAt = captions[i - 1].frame;
  const fastForward = cut.some(
    (p) =>
      p.speed === WAIT_SPEED &&
      toFrame(p.end) - toFrame(p.start) > FPS * 0.4 &&
      frame >= toFrame(p.start) &&
      frame < toFrame(p.end),
  );
  const fadeOut = interpolate(frame, [total - 12, total], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: INK, opacity: fadeOut }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: BAND,
          width: APP.width,
          height: APP.height,
          overflow: "hidden",
          background: "#e2e8f0",
        }}
      >
        <div
          style={{
            width: APP.width,
            height: APP.height,
            transformOrigin: "0 0",
            transform: `translate(${tx}px, ${ty}px) scale(${camera.zoom})`,
          }}
        >
          <Footage cut={cut} />
        </div>
      </div>
      {current && (
        <CaptionBand
          title={current.title}
          detail={current.detail}
          enteredAt={enteredAt}
          frame={frame}
          progress={frame / Math.max(1, total)}
          fastForward={fastForward}
        />
      )}
    </AbsoluteFill>
  );
}

/** The opening card, and the video's first frame: the thumbnail people see before they play it. */
export const INTRO = 42;
export const INTRO_FADE = 10;
/** The footage on the card: the recording's last moments, a wall page of live photos. */
const POSTER_BEFORE_END_S = 1.5;

function Poster({ timeline }: { timeline: Timeline }) {
  const frame = useCurrentFrame();
  const width = 1240;
  const height = (width * timeline.viewport.height) / timeline.viewport.width;
  const zoom = interpolate(frame, [0, INTRO], [1, 1.05]);
  const fade = interpolate(frame, [INTRO - INTRO_FADE, INTRO], [1, 0], {
    extrapolateLeft: "clamp",
  });
  return (
    <AbsoluteFill style={{ background: INK, opacity: fade, fontFamily: FONT }}>
      <div
        style={{
          position: "absolute",
          left: (FRAME - width) / 2,
          top: 170,
          width,
          height,
          transform: `scale(${zoom})`,
        }}
      >
        <Freeze frame={0}>
          <OffthreadVideo
            src={staticFile("raw.mp4")}
            trimBefore={Math.round(
              (timeline.totalS - POSTER_BEFORE_END_S) * FPS,
            )}
            muted
            style={{ width, height }}
          />
        </Freeze>
      </div>
      <AbsoluteFill
        style={{
          background: `linear-gradient(${INK} 0px, ${INK} 340px, rgba(15,23,42,0) 520px)`,
        }}
      />
      <div style={{ position: "absolute", left: 64, top: 64, right: 64 }}>
        <div
          style={{
            color: ORANGE,
            fontWeight: 800,
            fontSize: 30,
            letterSpacing: "0.1em",
          }}
        >
          MALANG · LIVE CITY CCTV
        </div>
        <div
          style={{
            color: "white",
            fontWeight: 900,
            fontSize: 132,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            marginTop: 12,
          }}
        >
          PantauJalur
        </div>
        <div
          style={{
            color: "#cbd5e1",
            fontWeight: 600,
            fontSize: 44,
            lineHeight: 1.2,
            marginTop: 18,
          }}
        >
          See the traffic on your route before you leave
        </div>
      </div>
    </AbsoluteFill>
  );
}

export function Demo({ timeline }: { timeline: Timeline | null }) {
  if (!timeline) return <AbsoluteFill style={{ background: INK }} />;
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Sequence from={INTRO - INTRO_FADE}>
        <Main timeline={timeline} />
      </Sequence>
      <Sequence durationInFrames={INTRO}>
        <Poster timeline={timeline} />
      </Sequence>
    </AbsoluteFill>
  );
}
