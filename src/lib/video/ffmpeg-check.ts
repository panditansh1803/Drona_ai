import ffmpegPath from "ffmpeg-static";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffprobeStatic = require("ffprobe-static");
import fs from "fs";
import path from "path";

/**
 * Ensures the bundled ffmpeg and ffprobe binary directories are in process.env.PATH.
 */
function ensureBinOnPath(binPath: string | null | undefined): void {
  if (binPath && typeof binPath === "string" && fs.existsSync(binPath)) {
    const binDir = path.dirname(binPath);
    if (!process.env.PATH?.includes(binDir)) {
      process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ""}`;
    }
  }
}

// Prepend bundled binary directories to PATH on module load
ensureBinOnPath(ffmpegPath);
ensureBinOnPath(ffprobeStatic?.path);

/**
 * Returns the absolute path to the bundled FFmpeg binary from ffmpeg-static.
 */
export function getFfmpegPath(): string {
  if (typeof ffmpegPath === "string" && fs.existsSync(ffmpegPath)) {
    ensureBinOnPath(ffmpegPath);
    return ffmpegPath;
  }
  return "ffmpeg";
}

/**
 * Returns the absolute path to the bundled FFprobe binary from ffprobe-static.
 */
export function getFfprobePath(): string {
  const p = ffprobeStatic?.path;
  if (typeof p === "string" && fs.existsSync(p)) {
    ensureBinOnPath(p);
    return p;
  }
  return "ffprobe";
}

/**
 * Checks if FFmpeg is available (bundled or on system).
 */
export function isFfmpegAvailable(): boolean {
  const p = getFfmpegPath();
  return fs.existsSync(p) || p === "ffmpeg";
}

/**
 * Ensures FFmpeg is available, throwing an error if missing.
 */
export function ensureFfmpegAvailable(): void {
  if (!isFfmpegAvailable()) {
    throw new Error("FFmpeg binary could not be found");
  }
}
