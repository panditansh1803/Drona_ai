import React from "react";
import { Series } from "remotion";
import { ShotSequence } from "./ShotSequence";
import type { CompositionProps } from "./types";

export const MainComposition: React.FC<CompositionProps> = ({
  shots = [],
  fps = 30,
}) => {
  if (!shots || shots.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          width: "100%",
          height: "100%",
          backgroundColor: "#09090b",
          color: "#a1a1aa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "32px",
          fontFamily: "sans-serif",
        }}
      >
        No shots provided
      </div>
    );
  }

  return (
    <Series>
      {shots.map((shot) => {
        const durationInFrames = Math.max(
          1,
          Math.round(shot.durationSeconds * fps)
        );

        return (
          <Series.Sequence
            key={shot.id || `shot-${shot.number}`}
            durationInFrames={durationInFrames}
          >
            <ShotSequence shot={shot} fps={fps} />
          </Series.Sequence>
        );
      })}
    </Series>
  );
};
