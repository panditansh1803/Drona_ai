import React from "react";
import {
  useCurrentFrame,
  interpolate,
  OffthreadVideo,
  Audio,
} from "remotion";
import type { RenderShot } from "./types";

interface ShotSequenceProps {
  shot: RenderShot;
  fps: number;
}

export const ShotSequence: React.FC<ShotSequenceProps> = ({ shot, fps }) => {
  const frame = useCurrentFrame();
  const currentTime = frame / fps;
  const totalFrames = Math.round(shot.durationSeconds * fps);

  // Crossfade transition: fade-in over 10 frames at start, fade-out over 10 frames at end
  const FADE_FRAMES = Math.min(12, Math.floor(totalFrames / 4));
  const opacity = interpolate(
    frame,
    [0, FADE_FRAMES, totalFrames - FADE_FRAMES, totalFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Active caption cue for current playback time
  const activeCue = (shot.captionCues || []).find(
    (cue) => currentTime >= cue.start && currentTime <= cue.end
  );

  return (
    <div
      style={{
        flex: 1,
        width: "100%",
        height: "100%",
        backgroundColor: "#000000",
        position: "relative",
        opacity,
      }}
    >
      {/* ─── Video Layer ─── */}
      {shot.videoUrl && (
        <OffthreadVideo
          src={shot.videoUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}

      {/* ─── Voiceover Audio Layer ─── */}
      {shot.audioUrl && <Audio src={shot.audioUrl} />}

      {/* ─── Burned-In Captions Layer ─── */}
      {activeCue && (
        <div
          style={{
            position: "absolute",
            bottom: "80px",
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: "80%",
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            color: "#ffffff",
            padding: "12px 24px",
            borderRadius: "16px",
            fontSize: "36px",
            fontWeight: 600,
            fontFamily: "sans-serif",
            textAlign: "center",
            lineHeight: 1.3,
            textShadow: "0 2px 4px rgba(0,0,0,0.8)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            backdropFilter: "blur(4px)",
          }}
        >
          {activeCue.text}
        </div>
      )}
    </div>
  );
};
