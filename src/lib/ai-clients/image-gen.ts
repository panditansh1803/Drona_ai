import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { saveGeneratedFile } from "@/src/lib/storage/local";
import { getEnvVar } from "@/src/lib/env";
import { getFfmpegPath } from "@/src/lib/video/ffmpeg-check";

const execAsync = promisify(exec);

export class ImageGenError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(`ImageGen Error: ${message}`);
    this.name = "ImageGenError";
  }
}

function getWavespeedApiKey(): string {
  const apiKey = getEnvVar("WAVESPEED_API_KEY");
  if (!apiKey) {
    throw new ImageGenError("WAVESPEED_API_KEY environment variable is missing");
  }
  return apiKey;
}

/**
 * Normalizes any generated or fallback image to a clean 16:9 (1920x1080) aspect ratio
 * using FFmpeg padding/scaling without distortion.
 */
async function normalizeImageTo16x9(
  inputBuffer: Buffer,
  fileName: string
): Promise<Buffer> {
  try {
    const ffmpegExe = getFfmpegPath();
    const tempDir = path.join(process.cwd(), "public", "generated", "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempInput = path.join(tempDir, `raw_${fileName}`);
    const tempOutput = path.join(tempDir, `norm_${fileName}`);

    fs.writeFileSync(tempInput, inputBuffer);

    await execAsync(
      `"${ffmpegExe}" -y -i "${tempInput}" -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" "${tempOutput}"`
    );

    if (fs.existsSync(tempOutput) && fs.statSync(tempOutput).size > 0) {
      const normalizedBuffer = fs.readFileSync(tempOutput);
      [tempInput, tempOutput].forEach((p) => {
        if (fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch {
            /* ignore */
          }
        }
      });
      return normalizedBuffer;
    }
  } catch (err) {
    console.warn("[ImageGen] 16:9 normalization warning (using raw buffer):", err);
  }
  return inputBuffer;
}

export async function generateShotImage(prompt: string): Promise<string> {
  const apiKey = getWavespeedApiKey();

  console.log(`[ImageGen Wavespeed] Submitting Z-Image Turbo 16:9 text-to-image prompt: "${prompt.slice(0, 60)}..."`);

  // 1. POST request to Wavespeed Z-Image Turbo endpoint with 16:9 target size
  const initResponse = await fetch(
    "https://api.wavespeed.ai/api/v3/wavespeed-ai/z-image/turbo",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        size: "1280*720",
        strength: 0.6,
        seed: -1,
        output_format: "jpeg",
      }),
    }
  );

  if (!initResponse.ok) {
    const errText = await initResponse.text();
    throw new ImageGenError(`Wavespeed API submission failed (${initResponse.status}): ${errText}`);
  }

  const initData = await initResponse.json();
  const requestId =
    initData.id ||
    initData.request_id ||
    initData.prediction_id ||
    initData.data?.id ||
    initData.data?.request_id;

  if (!requestId) {
    throw new ImageGenError(
      `Wavespeed API response missing request/prediction ID: ${JSON.stringify(initData)}`
    );
  }

  console.log(`[ImageGen Wavespeed] Prediction created with ID: ${requestId}`);

  // 2. Poll result endpoint — 240s timeout, 4-5s interval to reduce request volume
  const startTime = Date.now();
  const maxTimeoutMs = 240000; // 240 seconds timeout
  let delayMs = 4000; // start at 4s
  let pollCount = 0;
  let lastStatus = "unknown";

  while (Date.now() - startTime < maxTimeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs + 500, 5000); // ramp up to 5s max
    pollCount++;

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
      throw new ImageGenError(
        `Wavespeed polling failed (${pollResponse.status}) for request ${requestId}: ${errText}`
      );
    }

    const pollData = await pollResponse.json();
    const status = String(
      pollData.status || pollData.state || pollData.data?.status || ""
    ).toLowerCase();
    lastStatus = status;

    console.log(`[ImageGen Wavespeed Polling] Poll #${pollCount} | Request: ${requestId} | Status: ${status}`);

    if (status === "completed" || status === "succeeded" || status === "done") {
      const outputs =
        pollData.outputs ||
        pollData.output ||
        pollData.data?.outputs ||
        pollData.data?.output ||
        pollData.result?.urls ||
        pollData.result;

      const imageUrl = Array.isArray(outputs) ? outputs[0] : typeof outputs === "string" ? outputs : null;

      if (!imageUrl) {
        throw new ImageGenError(
          `Wavespeed prediction completed but output URL is missing: ${JSON.stringify(pollData)}`
        );
      }

      // 3. Download image and save to public/generated/images/
      console.log(`[ImageGen Wavespeed] Downloading completed image from ${imageUrl}...`);
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        throw new ImageGenError(`Failed to download completed image from ${imageUrl} (${imgRes.status})`);
      }

      const arrayBuffer = await imgRes.arrayBuffer();
      const rawImageBuffer = Buffer.from(arrayBuffer);
      const fileName = `img_${Date.now()}_${Math.random().toString(36).substring(7)}.jpeg`;

      // 4. Ensure strictly 16:9 (1920x1080) output dimensions without distortion
      const finalImageBuffer = await normalizeImageTo16x9(rawImageBuffer, fileName);

      const savedUrl = await saveGeneratedFile(finalImageBuffer, fileName, "images", "image/jpeg");

      // Verify file on disk and log file size in bytes using fs.statSync
      const diskPath = path.join(process.cwd(), "public", "generated", "images", fileName);
      let fileSize = 0;
      try {
        const stats = fs.statSync(diskPath);
        fileSize = stats.size;
      } catch {
        fileSize = finalImageBuffer.byteLength;
      }

      console.log(
        `[ImageGen Success] Prompt: "${prompt}" | Saved: ${savedUrl} | Local File: ${diskPath} | Size: ${fileSize} bytes`
      );

      return savedUrl;
    }

    if (status === "failed" || status === "error" || status === "canceled") {
      // 4. On failure, throw typed ImageGenError with full response body
      throw new ImageGenError(
        `Wavespeed prediction failed with status '${status}': ${JSON.stringify(pollData)}`
      );
    }
  }

  // 4. On timeout, throw typed ImageGenError with diagnostic context
  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
  throw new ImageGenError(
    `Wavespeed image generation timed out after ${elapsedSeconds}s (${pollCount} polls), last status: ${lastStatus}, request ID: ${requestId}`
  );
}
