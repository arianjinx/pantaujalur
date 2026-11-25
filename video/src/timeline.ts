export type Box = { x: number; y: number; w: number; h: number };

export type Timeline = {
  viewport: { width: number; height: number };
  totalS: number;
  captions: { title: string; detail?: string; at: number }[];
  waits: [number, number][];

  cuts: [number, number][];
  focus: { at: number; box: Box | null }[];
};

export const PLAY_SPEED = 2.5;
export const WAIT_SPEED = 40;

export type Part = { start: number; end: number; speed: number };

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

export function outputTime(cut: Part[], t: number): number {
  let out = 0;
  for (const p of cut) {
    if (t <= p.start) break;
    out += (Math.min(t, p.end) - p.start) / p.speed;
  }
  return out;
}

export function edited(timeline: Timeline): Timeline {
  const start = timeline.captions[1]?.at ?? 0;
  return { ...timeline, cuts: [...timeline.cuts, [0, start]] };
}
