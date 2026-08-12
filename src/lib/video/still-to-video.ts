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

import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import fs from "fs";

const execFileAsync = promisify(execFile);

// ─── FFmpeg Binary Resolution ─────────────────────────────────────────────────

/**
 * Resolves the FFmpeg executable path. Tries:
 * 1. PATH lookup via where.exe (works after shell restart)
 * 2. Known winget install location (works before shell restart)
 * 3. Falls back to bare "ffmpeg" string (throws if not found)
 */
function findFfmpegBinary(): string {
  // 1. Check PATH
  try {
    const whereExe = process.platform === "win32" ? "where.exe" : "which";
    const result = execFileSync(whereExe, ["ffmpeg"], {
      encoding: "utf8",
      timeout: 3000,
    })
      .trim()
      .split(/\r?\n/)[0]
      .trim();
    if (result && fs.existsSync(result)) return result;
  } catch {
    /* not on PATH yet */
  }

  // 2. Winget install location (Windows)
  if (process.platform === "win32") {
    const wingetBase = path.join(
      os.homedir(),
      "AppData",
      "Local",
      "Microsoft",
      "WinGet",
      "Packages"
    );
    if (fs.existsSync(wingetBase)) {
      try {
        const pkgDirs = fs.readdirSync(wingetBase);
        const ffmpegPkg = pkgDirs.find((d) => d.startsWith("Gyan.FFmpeg"));
        if (ffmpegPkg) {
          const subDirs = fs.readdirSync(path.join(wingetBase, ffmpegPkg));
          const buildDir = subDirs.find((d) => d.startsWith("ffmpeg-"));
          if (buildDir) {
            const candidate = path.join(
              wingetBase,
              ffmpegPkg,
              buildDir,
              "bin",
              "ffmpeg.exe"
            );
            if (fs.existsSync(candidate)) return candidate;
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  // 3. Final fallback
  return "ffmpeg";
}

// Resolve once at module load time
const FFMPEG = findFfmpegBinary();
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
