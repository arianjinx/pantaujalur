/** Part of the app's window, as fractions of its width and height. */
export type Box = { x: number; y: number; w: number; h: number };

/**
 * What the recorder noted while it drove the app, in seconds of recording:
 * when each caption starts, which spans were waits on the network, and what
 * the camera should frame from each moment on (null: the whole window).
 */
export type Timeline = {
  viewport: { width: number; height: number };
  totalS: number;
  captions: { title: string; detail?: string; at: number }[];
  waits: [number, number][];
  /** Spans left out of the edit, such as a camera that would not play. */
  cuts: [number, number][];
  focus: { at: number; box: Box | null }[];
};

/** The video plays at this speed, and waits on the network at WAIT_SPEED. */
export const PLAY_SPEED = 1.5;
export const WAIT_SPEED = 12;

export type Part = { start: number; end: number; speed: number };

/** The recording cut into spans, in order, each with the speed it plays at. */
export function parts(timeline: Timeline): Part[] {
  const spans = [
    ...timeline.waits.map(([start, end]) => ({
      start,
      end,
      speed: WAIT_SPEED,
    })),
    ...timeline.cuts.map(([start, end]) => ({ start, end, speed: Infinity })),
  ].sort((a, b) => a.start - b.start);
  const result: Part[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.end <= at) continue;
    if (span.start > at)
      result.push({ start: at, end: span.start, speed: PLAY_SPEED });
    result.push({ ...span, start: Math.max(span.start, at) });
    at = span.end;
  }
  result.push({ start: at, end: timeline.totalS, speed: PLAY_SPEED });
  return result.filter((p) => p.end - p.start > 0.01);
}

/** Where a moment of the recording lands in the edited video, in seconds. A moment in a cut lands where the cut is. */
export function outputTime(cut: Part[], t: number): number {
  let out = 0;
  for (const p of cut) {
    if (t <= p.start) break;
    out += (Math.min(t, p.end) - p.start) / p.speed;
  }
  return out;
}
