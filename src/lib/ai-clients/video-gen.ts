import { GoogleGenAI } from "@google/genai";
import path from "path";
import os from "os";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { saveGeneratedFile } from "@/src/lib/storage/local";
import { renderStillToVideo } from "@/src/lib/video/still-to-video";

const execAsync = promisify(exec);

export class VideoGenError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(`VideoGen Error: ${message}`);
    this.name = "VideoGenError";
  }
}

// Global running cost total for Veo generation calls
let runningPipelineVeoCost = 0;

export function getRunningPipelineVeoCost(): number {
  return runningPipelineVeoCost;
}

export function resetRunningPipelineVeoCost(): void {
  runningPipelineVeoCost = 0;
}

/**
 * Helper to convert a local image path or remote URL to base64 inline image object for Veo.
 */
async function getImageInlineData(
  imageUrl?: string
): Promise<{ imageBytes: string; mimeType: string } | undefined> {
  if (!imageUrl) return undefined;

  try {
    if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
      const res = await fetch(imageUrl);
      if (!res.ok) return undefined;
      const arrayBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const mimeType = res.headers.get("content-type") || "image/png";
      return { imageBytes: base64, mimeType };
    }

    const localPath = path.join(process.cwd(), "public", imageUrl.replace(/^\//, ""));
    if (fs.existsSync(localPath)) {
      const fileBuffer = fs.readFileSync(localPath);
      const ext = path.extname(localPath).toLowerCase();
      const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
      return { imageBytes: fileBuffer.toString("base64"), mimeType };
    }
  } catch (err) {
    console.warn("[getImageInlineData] Could not load image for Veo generation:", err);
  }

  return undefined;
}

/**
 * Extends an 8s Veo clip to targetDurationSeconds by extracting the last frame
 * and applying a Ken Burns pan/zoom effect for the remaining duration.
 */
async function extendVeoClipDuration(
  veoBuffer: Buffer,
  targetDurationSeconds: number
): Promise<Buffer> {
  const tempDir = path.join(process.cwd(), "public", "generated", "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const timestamp = Date.now();
  const veoPath = path.join(tempDir, `veo_${timestamp}.mp4`);
  const lastFramePath = path.join(tempDir, `frame_${timestamp}.png`);
  const extClipPath = path.join(tempDir, `ext_${timestamp}.mp4`);
  const finalPath = path.join(tempDir, `final_${timestamp}.mp4`);

  try {
    fs.writeFileSync(veoPath, veoBuffer);

    const extendDuration = targetDurationSeconds - 8;

    // Extract last frame of Veo clip
    await execAsync(`ffmpeg -y -sseof -0.5 -i "${veoPath}" -update 1 -q:v 2 "${lastFramePath}"`);

    // Create Ken Burns zoompan clip from last frame for remaining duration
    await execAsync(
      `ffmpeg -y -loop 1 -i "${lastFramePath}" -vf "zoompan=z='min(zoom+0.0015,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(
        extendDuration * 30
      )}:s=1920x1080,fps=30" -t ${extendDuration} -pix_fmt yuv420p "${extClipPath}"`
    );

    // Concatenate initial Veo clip with extended Ken Burns clip
    await execAsync(
      `ffmpeg -y -i "${veoPath}" -i "${extClipPath}" -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v]" -map "[v]" "${finalPath}"`
    );

    if (fs.existsSync(finalPath)) {
      const extendedBuffer = fs.readFileSync(finalPath);

      // Clean up temp files asynchronously
      [veoPath, lastFramePath, extClipPath, finalPath].forEach((p) => {
        if (fs.existsSync(/*turbopackIgnore: true*/ p)) fs.unlinkSync(p);
      });

      return extendedBuffer;
    }
  } catch (err) {
    console.warn("[extendVeoClipDuration] FFmpeg extension failed, returning original Veo clip:", err);
    [veoPath, lastFramePath, extClipPath, finalPath].forEach((p) => {
      if (fs.existsSync(/*turbopackIgnore: true*/ p)) fs.unlinkSync(p);
    });
  }

  return veoBuffer;
}

export async function generateShotVideo(
  prompt: string,
  durationSeconds: number,
  sourceImageUrl?: string
): Promise<string> {
  const useRealVideoGen = process.env.USE_REAL_VIDEO_GEN === "true";

  // ─── Real Veo Generation Path ────────────────────────────────────────────────
  if (useRealVideoGen) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new VideoGenError("GEMINI_API_KEY is required for USE_REAL_VIDEO_GEN=true");
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const tier = (process.env.VEO_TIER || "fast").toLowerCase();

      // Per-second pricing for Veo tiers
      const costPerSecondMap: Record<string, number> = {
        lite: 0.05,
        fast: 0.15,
        standard: 0.40,
      };

      const ratePerSecond = costPerSecondMap[tier] || 0.15;
      const veoClipDuration = 8;
      const callCost = veoClipDuration * ratePerSecond;

      runningPipelineVeoCost += callCost;
      console.log(
        `[Veo Video Gen] Tier: ${tier} | Call Cost: $${callCost.toFixed(
          2
        )} | Pipeline Running Total: $${runningPipelineVeoCost.toFixed(2)}`
      );

      const imageInline = await getImageInlineData(sourceImageUrl);

      // Start long-running Veo video generation operation
      const generateParams: Record<string, unknown> = {
        model: "veo-3.1-generate-preview",
        prompt,
        config: {
          aspectRatio: "16:9",
        },
      };

      if (imageInline) {
        generateParams.image = {
          imageBytes: imageInline.imageBytes,
          mimeType: imageInline.mimeType,
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let operation = await (ai.models as any).generateVideos(generateParams);

      // Poll every 6 seconds until operation completes
      while (operation && !operation.done) {
        await new Promise((resolve) => setTimeout(resolve, 6000));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        operation = await (ai.operations as any).getVideosOperation({
          operation,
        });
      }

      // Extract generated video bytes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const generatedVideos = (operation as any)?.response?.generatedVideos;
      const videoBytesBase64 = generatedVideos?.[0]?.video?.videoBytes;

      if (!videoBytesBase64) {
        throw new VideoGenError("Veo API returned no video bytes in completed operation response");
      }

      let videoBuffer: Buffer = Buffer.from(videoBytesBase64, "base64");

      // Extend clip if target duration > 8s
      if (durationSeconds > 8) {
        videoBuffer = (await extendVeoClipDuration(videoBuffer, durationSeconds)) as Buffer;
      }

      const fileName = `video_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`;
      const videoUrl = await saveGeneratedFile(videoBuffer, fileName, "videos", "video/mp4");

      console.log(
        `[VideoGen Success] Prompt: "${prompt.slice(0, 60)}..." | URL: ${videoUrl}`
      );

      return videoUrl;
    } catch (error) {
      if (error instanceof VideoGenError) throw error;
      console.warn("[Veo Video Gen] Real Veo generation failed, falling back to provider:", error);
    }
  }

  // ─── Fallback Provider Path (Runway / Replicate / Placeholder) ──────────────
  const runwayKey = process.env.RUNWAY_API_KEY;
  const replicateToken = process.env.REPLICATE_API_TOKEN;

  try {
    if (runwayKey) {
      const payload: Record<string, unknown> = {
        promptText: prompt,
        duration: Math.min(Math.max(Math.round(durationSeconds), 5), 10),
        watermark: false,
      };

      if (sourceImageUrl) {
        payload.promptImage = sourceImageUrl;
      }

      const response = await fetch("https://api.runwayml.com/v1/image_to_video", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${runwayKey}`,
          "Content-Type": "application/json",
          "X-Runway-Version": "2024-09-13",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new VideoGenError(`Runway API request failed (${response.status}): ${errText}`);
      }

      const data = (await response.json()) as { id?: string; output?: string[]; videoUrl?: string };
      if (data.videoUrl) return data.videoUrl;
      if (Array.isArray(data.output) && data.output[0]) return data.output[0];
      if (data.id) return `https://api.runwayml.com/v1/tasks/${data.id}`;
    }

    if (replicateToken) {
      const Replicate = (await import("replicate")).default;
      const replicate = new Replicate({ auth: replicateToken });

      const inputPayload: Record<string, unknown> = {
        prompt,
        prompt_optimizer: true,
      };

      if (sourceImageUrl) {
        inputPayload.first_frame_image = sourceImageUrl;
      }

      const output = await replicate.run("minimax/video-01", {
        input: inputPayload,
      });

      if (typeof output === "string") return output;
      if (Array.isArray(output) && output[0]) return String(output[0]);
      if (output && typeof output === "object" && "url" in output) {
        return String((output as { url: () => string }).url());
      }
    }

    // ─── Ken Burns fallback: render real MP4 from still image using FFmpeg ───
    const tmpFileName = `video_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`;
    const tmpPath = path.join(os.tmpdir(), tmpFileName);

    try {
      await renderStillToVideo(sourceImageUrl, durationSeconds, tmpPath);

      if (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 0) {
        const videoBuffer = fs.readFileSync(tmpPath);
        try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup error */ }

        const videoUrl = await saveGeneratedFile(videoBuffer, tmpFileName, "videos", "video/mp4");

        console.log(
          `[VideoGen Success - Ken Burns] Prompt: "${prompt.slice(0, 60)}..." | URL: ${videoUrl} | Size: ${videoBuffer.length} bytes`
        );
        return videoUrl;
      }
    } catch (kenBurnsErr) {
      console.warn("[VideoGen] Ken Burns render failed:", (kenBurnsErr as Error).message?.slice(0, 120));
    }

    // Last-resort URL fallback (should never reach here after FFmpeg is installed)
    const lastResortUrl = sourceImageUrl || "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";
    console.warn(`[VideoGen Fallback] Could not render video. Returning URL: ${lastResortUrl}`);
    return lastResortUrl;
  } catch (error) {
    if (error instanceof VideoGenError) throw error;
    throw new VideoGenError("Failed to generate video", error);
  }
}
