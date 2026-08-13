import path from "path";
import os from "os";
import fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { saveGeneratedFile } from "@/src/lib/storage/local";
import type { RenderShot } from "./types";

export class RenderError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(`Render Error: ${message}`);
    this.name = "RenderError";
  }
}

/**
 * Converts a stored asset URL (relative web path or absolute disk path or
 * http URL) into a file:// URI that Remotion's OffthreadVideo/Audio can load
 * from disk without a network round-trip.
 *
 * Local dev generates paths like /generated/videos/video_xxx.mp4.
 * Remotion needs file:///absolute/path/to/video_xxx.mp4 for local files.
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
    const entryPoint = path.join(process.cwd(), "render", "index.ts");
    const tmpDir = os.tmpdir();
    const outputFileName = `render_${projectId}_${Date.now()}.mp4`;
    const outputPath = path.join(tmpDir, outputFileName);

    // Resolve local media URLs to file:// URIs for Remotion
    const resolvedShots: RenderShot[] = shots.map((shot, i) => {
      console.log(`[Renderer] Stitching shot ${i + 1} of ${shots.length}: shot #${shot.number} (${shot.durationSeconds}s)`);
      return {
        ...shot,
        videoUrl: resolveLocalMediaUrl(shot.videoUrl),
        audioUrl: shot.audioUrl ? resolveLocalMediaUrl(shot.audioUrl) : undefined,
      };
    });

    // 1. Bundle the Remotion project with publicDir configured so local assets in public/ are served by Remotion
    console.log(`[Renderer] Bundling Remotion composition for project ${projectId}...`);
    const bundled = await bundle({
      entryPoint,
      publicDir: path.join(process.cwd(), "public"),
      webpackOverride: (config) => config,
    });

    // 2. Select composition metadata (uses calculateMetadata to set total duration)
    const composition = await selectComposition({
      serveUrl: bundled,
      id: "DronaVideo",
      inputProps: {
        shots: resolvedShots,
        fps: 30,
      },
    });

    const totalDurationSeconds = shots.reduce((sum, s) => sum + s.durationSeconds, 0);
    console.log(
      `[Renderer] Rendering ${shots.length} shots, total duration: ${totalDurationSeconds.toFixed(1)}s (${composition.durationInFrames} frames @ 30fps)`
    );

    // 3. Render MP4 video file to OS temp directory
    await renderMedia({
      composition,
      serveUrl: bundled,
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
    console.log(`[Renderer] Render complete. Output: ${outputPath} | Size: ${outputSizeBytes} bytes`);

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

    console.log(`[Renderer] Final video saved: ${savedUrl} | R2: ${hasR2Credentials ? "yes" : "no (local fallback)"}`);
    return savedUrl;
  } catch (error) {
    if (error instanceof RenderError) throw error;
    throw new RenderError(`Failed to render video for project ${projectId}`, error);
  }
}
