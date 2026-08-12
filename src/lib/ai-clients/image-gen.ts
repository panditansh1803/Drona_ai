import fs from "fs";
import path from "path";
import { saveGeneratedFile } from "@/src/lib/storage/local";
import { getEnvVar } from "@/src/lib/env";

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

export async function generateShotImage(prompt: string): Promise<string> {
  const apiKey = getWavespeedApiKey();

  console.log(`[ImageGen Wavespeed] Submitting GPT Image 2 text-to-image prompt: "${prompt.slice(0, 60)}..."`);

  // 1. POST request to Wavespeed GPT Image 2 endpoint
  const initResponse = await fetch(
    "https://api.wavespeed.ai/api/v3/openai/gpt-image-2/text-to-image",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        size: "1024x1024",
        quality: "medium",
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

  // 2. Poll result endpoint with exponential backoff starting at 2s
  const startTime = Date.now();
  const maxTimeoutMs = 60000; // 60 seconds timeout
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
      throw new ImageGenError(
        `Wavespeed polling failed (${pollResponse.status}) for request ${requestId}: ${errText}`
      );
    }

    const pollData = await pollResponse.json();
    const status = String(
      pollData.status || pollData.state || pollData.data?.status || ""
    ).toLowerCase();

    console.log(`[ImageGen Wavespeed Polling] Request: ${requestId} | Status: ${status}`);

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
      const imageBuffer = Buffer.from(arrayBuffer);
      const fileName = `img_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;

      const savedUrl = await saveGeneratedFile(imageBuffer, fileName, "images", "image/png");

      // Verify file on disk and log file size in bytes using fs.statSync
      const diskPath = path.join(process.cwd(), "public", "generated", "images", fileName);
      let fileSize = 0;
      try {
        const stats = fs.statSync(diskPath);
        fileSize = stats.size;
      } catch {
        fileSize = imageBuffer.byteLength;
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

  // 4. On timeout, throw typed ImageGenError
  throw new ImageGenError(`Wavespeed image generation timed out after 60s for request ${requestId}`);
}
