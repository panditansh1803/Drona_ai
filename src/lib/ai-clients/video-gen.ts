import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { saveGeneratedFile } from "@/src/lib/storage/local";
import { getEnvVar } from "@/src/lib/env";

const execAsync = promisify(exec);

export class VideoGenError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(`VideoGen Error: ${message}`);
    this.name = "VideoGenError";
  }
}

function getWavespeedApiKey(): string {
  const apiKey = getEnvVar("WAVESPEED_API_KEY");
  if (!apiKey) {
    throw new VideoGenError("WAVESPEED_API_KEY environment variable is missing");
  }
  return apiKey;
}

function resolvePublicImageUrl(imageUrl?: string | null): string {
  if (!imageUrl) return "";
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }
  const baseUrl = getEnvVar("R2_PUBLIC_URL") || getEnvVar("APP_URL") || "http://localhost:3000";
  return `${baseUrl.replace(/\/$/, "")}/${imageUrl.replace(/^\//, "")}`;
}

/**
 * Extends an H3 video clip if targetDurationSeconds > 15s by extracting the last frame
 * and applying a Ken Burns pan/zoom composition for the remaining duration.
 */
async function extendVideoClipDuration(
  videoBuffer: Buffer,
  targetDurationSeconds: number
): Promise<Buffer> {
  const tempDir = path.join(process.cwd(), "public", "generated", "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const timestamp = Date.now();
  const clipPath = path.join(tempDir, `h3_${timestamp}.mp4`);
  const lastFramePath = path.join(tempDir, `frame_${timestamp}.png`);
  const extClipPath = path.join(tempDir, `ext_${timestamp}.mp4`);
  const finalPath = path.join(tempDir, `final_${timestamp}.mp4`);

  try {
    fs.writeFileSync(clipPath, videoBuffer);

    const extendDuration = Math.max(1, targetDurationSeconds - 15);

    // Extract last frame of H3 clip
    await execAsync(`ffmpeg -y -sseof -0.5 -i "${clipPath}" -update 1 -q:v 2 "${lastFramePath}"`);

    // Create Ken Burns zoompan clip from last frame for remaining duration
    await execAsync(
      `ffmpeg -y -loop 1 -i "${lastFramePath}" -vf "zoompan=z='min(zoom+0.0015,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(
        extendDuration * 30
      )}:s=1920x1080,fps=30" -t ${extendDuration} -pix_fmt yuv420p "${extClipPath}"`
    );

    // Concatenate initial 15s H3 clip with extended Ken Burns clip
    await execAsync(
      `ffmpeg -y -i "${clipPath}" -i "${extClipPath}" -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v]" -map "[v]" "${finalPath}"`
    );

    if (fs.existsSync(finalPath)) {
      const extendedBuffer = fs.readFileSync(finalPath);
      [clipPath, lastFramePath, extClipPath, finalPath].forEach((p) => {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      });
      return extendedBuffer;
    }
  } catch (err) {
    console.warn("[extendVideoClipDuration] FFmpeg extension failed, returning original clip:", err);
    [clipPath, lastFramePath, extClipPath, finalPath].forEach((p) => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  }

  return videoBuffer;
}

export async function generateShotVideo(
  prompt: string,
  durationSeconds: number,
  sourceImageUrl?: string | null
): Promise<string> {
  const apiKey = getWavespeedApiKey();

  // Clamp duration to MiniMax H3's valid range of 5-15 seconds
  const h3Duration = Math.max(5, Math.min(15, Math.round(durationSeconds)));
  const publicImageUrl = resolvePublicImageUrl(sourceImageUrl);

  console.log(
    `[VideoGen Wavespeed] Submitting MiniMax H3 image-to-video | Prompt: "${prompt.slice(0, 60)}..." | Duration: ${h3Duration}s`
  );

  // 1. POST request to Wavespeed MiniMax H3 image-to-video endpoint
  const initResponse = await fetch("https://api.wavespeed.ai/api/v3/minimax/h3/image-to-video", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image: publicImageUrl || undefined,
      duration: h3Duration,
    }),
  });

  if (!initResponse.ok) {
    const errText = await initResponse.text();
    throw new VideoGenError(`Wavespeed MiniMax H3 API submission failed (${initResponse.status}): ${errText}`);
  }

  const initData = await initResponse.json();
  const requestId =
    initData.id ||
    initData.request_id ||
    initData.prediction_id ||
    initData.data?.id ||
    initData.data?.request_id;

  if (!requestId) {
    throw new VideoGenError(
      `Wavespeed API response missing prediction/request ID: ${JSON.stringify(initData)}`
    );
  }

  console.log(`[VideoGen Wavespeed] Prediction created with ID: ${requestId}`);

  // 2. Poll result endpoint with exponential backoff starting at 2s
  const startTime = Date.now();
  const maxTimeoutMs = 120000; // 120 seconds timeout for video generation
  let delayMs = 2000;

  while (Date.now() - startTime < maxTimeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs + 500, 5000); // Back off interval up to 5s max

    const pollResponse = await fetch(
      `https://api.wavespeed.ai/api/v3/predictions/${requestId}/result`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!pollResponse.ok) {
      const errText = await pollResponse.text();
      throw new VideoGenError(
        `Wavespeed video polling failed (${pollResponse.status}) for request ${requestId}: ${errText}`
      );
    }

    const pollData = await pollResponse.json();
    const status = String(
      pollData.status || pollData.state || pollData.data?.status || ""
    ).toLowerCase();

    console.log(`[VideoGen Wavespeed Polling] Request: ${requestId} | Status: ${status}`);

    if (status === "completed" || status === "succeeded" || status === "done") {
      const outputs =
        pollData.outputs ||
        pollData.output ||
        pollData.data?.outputs ||
        pollData.data?.output ||
        pollData.result?.urls ||
        pollData.result;

      const videoUrl = Array.isArray(outputs) ? outputs[0] : typeof outputs === "string" ? outputs : null;

      if (!videoUrl) {
        throw new VideoGenError(
          `Wavespeed prediction completed but video URL is missing: ${JSON.stringify(pollData)}`
        );
      }

      // 3. Download generated video
      console.log(`[VideoGen Wavespeed] Downloading generated video from ${videoUrl}...`);
      const vidRes = await fetch(videoUrl);
      if (!vidRes.ok) {
        throw new VideoGenError(`Failed to download completed video from ${videoUrl} (${vidRes.status})`);
      }

      const arrayBuffer = await vidRes.arrayBuffer();
      let videoBuffer: Buffer = Buffer.from(arrayBuffer);

      // 4. Extend clip if target duration exceeds 15s (H3's max per call)
      if (durationSeconds > 15) {
        console.log(`[VideoGen Extension] Target duration ${durationSeconds}s > 15s. Extending clip via FFmpeg...`);
        videoBuffer = await extendVideoClipDuration(videoBuffer, durationSeconds);
      }

      // 5. Save via saveGeneratedFile into public/generated/videos/
      const fileName = `video_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`;
      const savedUrl = await saveGeneratedFile(videoBuffer, fileName, "videos", "video/mp4");

      // Verify file on disk and log file size in bytes using fs.statSync
      const diskPath = path.join(process.cwd(), "public", "generated", "videos", fileName);
      let fileSize = 0;
      try {
        const stats = fs.statSync(diskPath);
        fileSize = stats.size;
      } catch {
        fileSize = videoBuffer.byteLength;
      }

      console.log(
        `[VideoGen Success] Prompt: "${prompt}" | Saved: ${savedUrl} | Local File: ${diskPath} | Size: ${fileSize} bytes`
      );

      return savedUrl;
    }

    if (status === "failed" || status === "error" || status === "canceled") {
      // Throw typed VideoGenError on failure — no silent fallbacks
      throw new VideoGenError(
        `Wavespeed prediction failed with status '${status}': ${JSON.stringify(pollData)}`
      );
    }
  }

  // Throw typed VideoGenError on timeout
  throw new VideoGenError(`Wavespeed video generation timed out after 120s for request ${requestId}`);
}
