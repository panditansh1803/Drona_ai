/**
 * Still-to-Video Renderer
 * -----------------------
 * Converts a single still image (PNG/JPG) into a short MP4 video using
 * FFmpeg's Ken Burns zoompan effect. Falls back to an animated dark-gradient
 * background when the source is an SVG placeholder, a missing file, or when
 * the image-based render fails.
 *
 * Uses execFile (not exec) to pass the zoompan filter expression as a
 * direct argument, avoiding all Windows shell-escaping issues with single
 * quotes inside the filter graph.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { getFfmpegPath } from "@/src/lib/video/ffmpeg-check";

const execFileAsync = promisify(execFile);

// ─── FFmpeg Binary Resolution ─────────────────────────────────────────────────

const FFMPEG = getFfmpegPath();
console.log(`[StillToVideo] FFmpeg resolved to: ${FFMPEG}`);

// ─── Core Renderer ────────────────────────────────────────────────────────────

/**
 * Converts a local still image into an MP4 video file using FFmpeg.
 *
 * - PNG/JPG sources  → Ken Burns slow zoom-in using zoompan filter
 * - SVG / missing   → animated dark-gradient background (lavfi color source)
 *
 * @param sourceImageUrl  Relative public URL (/generated/images/...) or absolute path.
 *                        Pass undefined to use the background fallback directly.
 * @param durationSeconds Target video duration in seconds.
 * @param outputPath      Absolute path for the output .mp4 file.
 */
export async function renderStillToVideo(
  sourceImageUrl: string | undefined,
  durationSeconds: number,
  outputPath: string
): Promise<void> {
  const fps = 30;
  const totalFrames = Math.round(durationSeconds * fps);
  const duration = Math.max(1, durationSeconds);

  // Resolve relative public URL → absolute local FS path
  let localImagePath: string | undefined;
  const isSvgOrMissing =
    !sourceImageUrl || sourceImageUrl.toLowerCase().endsWith(".svg");

  if (sourceImageUrl && !isSvgOrMissing) {
    const resolved = sourceImageUrl.startsWith("/")
      ? path.join(process.cwd(), "public", sourceImageUrl.replace(/^\//, ""))
      : sourceImageUrl;
    localImagePath = fs.existsSync(resolved) ? resolved : undefined;
  }

  // ─── Path A: Ken Burns from real image ──────────────────────────────────────
  if (localImagePath) {
    try {
      await execFileAsync(FFMPEG, [
        "-y",
        "-loop", "1",
        "-i", localImagePath,
        "-vf",
        // scale → pad → zoompan Ken Burns → fps → yuv420p
        [
          "scale=1920:1080:force_original_aspect_ratio=decrease",
          "pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
          `zoompan=z='min(zoom+0.0015,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1920x1080`,
          `fps=${fps}`,
          "format=yuv420p",
        ].join(","),
        "-t", duration.toFixed(2),
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        outputPath,
      ]);

      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        console.log(
          `[StillToVideo] Ken Burns video rendered: ${outputPath} (${fs.statSync(outputPath).size} bytes)`
        );
        return;
      }
    } catch (err) {
      console.warn(
        "[StillToVideo] Ken Burns render failed, falling back to background:",
        (err as Error).message?.slice(0, 120)
      );
    }
  }

  // ─── Path B: Animated dark-gradient background (no input image) ────────────
  // Uses FFmpeg lavfi color source — works with any input, no librsvg needed
  await execFileAsync(FFMPEG, [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=0x0f172a:s=1920x1080:r=${fps}`,
    "-t", duration.toFixed(2),
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    outputPath,
  ]);

  console.log(
    `[StillToVideo] Background fallback video rendered: ${outputPath} (${fs.statSync(outputPath).size} bytes)`
  );
}
