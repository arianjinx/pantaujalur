import { Composition, staticFile } from "remotion";

import { Demo, FPS, FRAME } from "./Demo";
import { outputTime, parts, type Timeline } from "./timeline";

export function Root() {
  return (
    <Composition
      id="Demo"
      component={Demo}
      width={FRAME}
      height={FRAME}
      fps={FPS}
      durationInFrames={1}
      defaultProps={{ timeline: null as Timeline | null }}
      calculateMetadata={async () => {
        const response = await fetch(staticFile("timeline.json"));
        const timeline = (await response.json()) as Timeline;
        const end = outputTime(parts(timeline), timeline.totalS);
        return {
          durationInFrames: Math.ceil(end * FPS),
          props: { timeline },
        };
      }}
    />
  );
}
