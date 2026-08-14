import path from "path";
import os from "os";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { saveGeneratedFile } from "@/src/lib/storage/local";
import { getFfmpegPath, getFfprobePath } from "@/src/lib/video/ffmpeg-check";
import type { RenderShot } from "./types";

import net from "net";

const execAsync = promisify(exec);

/**
 * Finds an available local TCP port to avoid colliding with Next.js (port 3000).
 */
async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 3456;
      srv.close(() => resolve(port));
    });
    srv.on("error", () => resolve(3456));
  });
}

export class RenderError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(`Render Error: ${message}`);
    this.name = "RenderError";
  }
}

/**
 * Converts a stored asset URL (relative web path or absolute disk path or
 * http URL) into a relative web path that Remotion's publicDir serves.
 */
function resolveLocalMediaUrl(url: string | undefined | null): string {
  if (!url) return "";
  // Already a full http/https URL — use as-is (production R2 CDN)
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  // Relative web path: /generated/videos/foo.mp4 — Remotion bundle serves this from publicDir
  const relativePath = url.startsWith("/") ? url : `/${url}`;
  return relativePath;
}

/**
 * Probes the actual rendered video duration in seconds using ffprobe.
 */
async function probeVideoDuration(filePath: string): Promise<number> {
  try {
    const ffprobeExe = getFfprobePath();
    const { stdout } = await execAsync(
      `"${ffprobeExe}" -v error -show_entries format=duration -of json "${filePath}"`
    );
    const data = JSON.parse(stdout);
    const dur = parseFloat(data.format?.duration);
    if (!isNaN(dur) && dur > 0) {
      return Math.round(dur * 100) / 100;
    }
  } catch (err) {
    console.warn("[Renderer] FFprobe duration check failed:", err);
  }
  return 0;
}

/**
 * Bundles and renders the Remotion video composition for a project.
 * In local dev mode, saves the MP4 to public/generated/final/ via saveGeneratedFile
 * and returns a relative web path. In production (R2 credentials present),
 * uploads to Cloudflare R2 and returns the CDN URL.
 */
export async function renderAndUploadVideo(
  projectId: string,
  shots: RenderShot[]
): Promise<string> {
  try {
    // 0. Ensure bundled FFmpeg / FFprobe are on PATH
    getFfmpegPath();
    getFfprobePath();

    if (!shots || shots.length === 0) {
      throw new RenderError(`Cannot render project ${projectId}: No shots provided`);
    }

    const expectedTotalDuration = shots.reduce((sum, s) => sum + (s.durationSeconds || 0), 0);

    // Explicit logging: full list of shots being merged
    console.log("=================================================================");
    console.log(`[Renderer] Starting Render for Project: ${projectId}`);
    console.log(`[Renderer] Total Shots to Merge: ${shots.length} | Expected Total Duration: ${expectedTotalDuration.toFixed(2)}s`);
    console.log("-----------------------------------------------------------------");
    shots.forEach((s, idx) => {
      console.log(
        `  [Shot ${idx + 1}/${shots.length}] #${s.number} (ID: ${s.id || "N/A"}) | Duration: ${s.durationSeconds}s` +
        `\n    - Video: ${s.videoUrl || "NONE"}` +
        `\n    - Audio: ${s.audioUrl || "NONE"}` +
        `\n    - Captions: ${s.captionCues?.length || 0} cue(s)`
      );
    });
    console.log("=================================================================");

    const entryPoint = path.join(process.cwd(), "render", "index.ts");
    const tmpDir = os.tmpdir();
    const outputFileName = `render_${projectId}_${Date.now()}.mp4`;
    const outputPath = path.join(tmpDir, outputFileName);

    // Resolve local media URLs for Remotion publicDir
    const resolvedShots: RenderShot[] = shots.map((shot) => ({
      ...shot,
      videoUrl: resolveLocalMediaUrl(shot.videoUrl),
      audioUrl: shot.audioUrl ? resolveLocalMediaUrl(shot.audioUrl) : undefined,
    }));

    // 1. Bundle the Remotion project
    console.log(`[Renderer] Bundling Remotion composition for project ${projectId}...`);
    const bundled = await bundle({
      entryPoint,
      publicDir: path.join(process.cwd(), "public"),
      webpackOverride: (config) => config,
    });

    const remotionPort = await getFreePort();
    console.log(`[Renderer] Remotion static server allocated on local port: ${remotionPort}`);

    // 2. Select composition metadata
    const composition = await selectComposition({
      serveUrl: bundled,
      id: "DronaVideo",
      port: remotionPort,
      inputProps: {
        shots: resolvedShots,
        fps: 30,
      },
    });

    console.log(
      `[Renderer] Composition selected: ${composition.durationInFrames} frames @ 30fps (${(composition.durationInFrames / 30).toFixed(2)}s)`
    );

    // 3. Render MP4 video file
    console.log(`[Renderer] Rendering media to ${outputPath}...`);
    await renderMedia({
      composition,
      serveUrl: bundled,
      port: remotionPort,
      codec: "h264",
      outputLocation: outputPath,
      inputProps: {
        shots: resolvedShots,
        fps: 30,
      },
    });

    if (!fs.existsSync(outputPath)) {
      throw new RenderError(`Render completed but output file not found at ${outputPath}`);
    }

    const outputSizeBytes = fs.statSync(outputPath).size;
    const actualDurationSeconds = await probeVideoDuration(outputPath);

    console.log("=================================================================");
    console.log(`[Renderer] Render Complete: ${outputPath} | Size: ${(outputSizeBytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[Renderer Verification]`);
    console.log(`  - Expected Duration (sum of ${shots.length} shots): ${expectedTotalDuration.toFixed(2)}s`);
    console.log(`  - Measured Output Duration:                   ${actualDurationSeconds.toFixed(2)}s`);
    console.log(`  - Duration Difference:                        ${Math.abs(actualDurationSeconds - expectedTotalDuration).toFixed(2)}s`);

    const isDurationValid = Math.abs(actualDurationSeconds - expectedTotalDuration) <= 2.0;
    console.log(`  - All Shots Merged Check:                     ${isDurationValid ? "✓ PASSED" : "❌ MISMATCH"}`);
    console.log("=================================================================");

    if (!isDurationValid && shots.length > 1 && actualDurationSeconds <= (shots[0].durationSeconds + 1.0)) {
      throw new RenderError(
        `Render output duration (${actualDurationSeconds}s) only matches single shot instead of expected total (${expectedTotalDuration}s)`
      );
    }

    // 4. Save to public/generated/final/ or upload to R2
    const hasR2Credentials =
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME;

    const fileBuffer = fs.readFileSync(outputPath);
    const savedUrl = await saveGeneratedFile(fileBuffer, outputFileName, "final" as "videos", "video/mp4");

    // Clean up temp file
    try {
      fs.unlinkSync(outputPath);
    } catch {
      /* ignore cleanup errors */
    }

    console.log(`[Renderer] Final video saved: ${savedUrl} | R2: ${hasR2Credentials ? "yes" : "no (local)"}`);
    return savedUrl;
  } catch (error) {
    if (error instanceof RenderError) throw error;
    throw new RenderError(`Failed to render video for project ${projectId}`, error);
  }
}
