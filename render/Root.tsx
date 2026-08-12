import React from "react";
import { Composition } from "remotion";
import { MainComposition } from "./MainComposition";
import type { RenderShot } from "./types";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="DronaVideo"
      component={MainComposition}
      durationInFrames={300}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        shots: [] as RenderShot[],
        fps: 30,
      }}
      calculateMetadata={({ props }) => {
        const fps = typeof props.fps === "number" ? props.fps : 30;
        const shots = (props.shots as RenderShot[]) || [];
        const totalDuration = shots.reduce(
          (sum: number, shot: RenderShot) => sum + (shot.durationSeconds || 0),
          0
        );
        return {
          durationInFrames: Math.max(1, Math.round(totalDuration * fps)),
          fps,
        };
      }}
    />
  );
};
