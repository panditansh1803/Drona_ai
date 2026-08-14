import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { saveGeneratedFile } from "@/src/lib/storage/local";
import { getEnvVar } from "@/src/lib/env";
import { getFfmpegPath } from "@/src/lib/video/ffmpeg-check";

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

/**
 * Resolves a source image URL or local path into the `image` field value
 * that WaveSpeed's WAN 2.2 image-to-video endpoint accepts.
 *
 * - Local mode (no R2 credentials): reads the image file from disk and returns
 *   a base64 Data URI ("data:image/png;base64,...") — no public URL needed.
 * - Production mode (R2 credentials present): falls back to constructing a
 *   public URL via R2_PUBLIC_URL, since the file is already in R2.
 *
 * WaveSpeed documented format for base64: data:image/{ext};base64,{data}
 */
function resolveImageForVideoGen(imageUrl?: string | null): string | undefined {
  if (!imageUrl) return undefined;

  // Already a full public URL — use it directly (handles R2 CDN URLs)
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }

  // Local relative path (/generated/images/...) — check if we're in local storage mode
  const isLocalStorageMode =
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY ||
    !process.env.R2_BUCKET_NAME;

  if (isLocalStorageMode) {
    // Derive disk path from relative URL (/generated/images/foo.png -> public/generated/images/foo.png)
    const relativePath = imageUrl.startsWith("/") ? imageUrl.slice(1) : imageUrl;
    const diskPath = path.join(process.cwd(), "public", relativePath);

    if (fs.existsSync(diskPath)) {
      const buffer = fs.readFileSync(diskPath);
      const base64Data = buffer.toString("base64");
      // Detect extension for MIME type
      const ext = path.extname(diskPath).toLowerCase().replace(".", "") || "png";
      const mime =
        ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "webp"
          ? "image/webp"
          : "image/png";
      const dataUri = `data:${mime};base64,${base64Data}`;
      console.log(
        `[VideoGen] Local image resolved to base64 Data URI (disk: ${diskPath}, size: ${buffer.length} bytes)`
      );
      return dataUri;
    } else {
      console.warn(
        `[VideoGen] Local image not found on disk: ${diskPath}. Skipping image input.`
      );
      return undefined;
    }
  }

  // Production mode: construct public URL from R2_PUBLIC_URL or APP_URL
  const baseUrl =
    getEnvVar("R2_PUBLIC_URL", false) ||
    getEnvVar("APP_URL", false) ||
    "http://localhost:3000";
  const fullUrl = `${baseUrl.replace(/\/$/, "")}/${imageUrl.replace(/^\//, "")}`;
  console.log(`[VideoGen] Resolved image to public URL: ${fullUrl}`);
  return fullUrl;
}

/**
 * Extends a WAN 2.2 5-second video clip if targetDurationSeconds > 5s by extracting
 * the last frame and applying a Ken Burns pan/zoom composition for the remaining duration.
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
  const clipPath = path.join(tempDir, `wan_${timestamp}.mp4`);
  const lastFramePath = path.join(tempDir, `frame_${timestamp}.png`);
  const extClipPath = path.join(tempDir, `ext_${timestamp}.mp4`);
  const finalPath = path.join(tempDir, `final_${timestamp}.mp4`);

  try {
    fs.writeFileSync(clipPath, videoBuffer);

    const extendDuration = Math.max(0.5, targetDurationSeconds - 5);

    const ffmpegExe = getFfmpegPath();

    // Extract last frame of the 5s clip
    await execAsync(
      `"${ffmpegExe}" -y -sseof -0.5 -i "${clipPath}" -update 1 -q:v 2 "${lastFramePath}"`
    );

    // Create Ken Burns zoompan clip from last frame for remaining duration
    await execAsync(
      `"${ffmpegExe}" -y -loop 1 -i "${lastFramePath}" -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.0015,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(
        extendDuration * 30
      )}:s=1920x1080,fps=30,format=yuv420p" -t ${extendDuration.toFixed(2)} -c:v libx264 -pix_fmt yuv420p "${extClipPath}"`
    );

    // Concatenate initial 5s WAN clip with extended Ken Burns clip (normalizing scale & fps)
    await execAsync(
      `"${ffmpegExe}" -y -i "${clipPath}" -i "${extClipPath}" -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v0];[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v1];[v0][v1]concat=n=2:v=1:a=0[v]" -map "[v]" -c:v libx264 -pix_fmt yuv420p "${finalPath}"`
    );

    if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 0) {
      const extendedBuffer = fs.readFileSync(finalPath);
      [clipPath, lastFramePath, extClipPath, finalPath].forEach((p) => {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      });
      return extendedBuffer;
    }
  } catch (err) {
    console.warn(
      "[extendVideoClipDuration] FFmpeg extension failed, returning original 5s clip:",
      err
    );
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

  // Guard: throw clear error if sourceImageUrl is missing or empty
  if (!sourceImageUrl || sourceImageUrl.trim() === "") {
    throw new VideoGenError(
      "No source image available for video generation (sourceImageUrl parameter is missing or empty)"
    );
  }

  // Resolve the image: base64 Data URI in local mode, public URL in production
  const imageField = resolveImageForVideoGen(sourceImageUrl);

  if (!imageField) {
    throw new VideoGenError(
      `Failed to resolve source image '${sourceImageUrl}' into base64 or URL for video generation`
    );
  }

  console.log(
    `[VideoGen Wavespeed WAN 2.2] Submitting i2v-480p-ultra-fast | Prompt: "${prompt.slice(
      0,
      60
    )}..." | Target Duration: ${durationSeconds}s (WAN base: 5s) | Image Length: ${
      imageField.length
    } chars`
  );

  // 1. POST request to Wavespeed WAN 2.2 480p ultra-fast image-to-video endpoint
  const initResponse = await fetch(
    "https://api.wavespeed.ai/api/v3/wavespeed-ai/wan-2.2/i2v-480p-ultra-fast",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image: imageField,
        prompt: prompt,
        duration: 5,
        seed: -1,
      }),
    }
  );

  if (!initResponse.ok) {
    const errText = await initResponse.text();
    throw new VideoGenError(
      `Wavespeed WAN 2.2 API submission failed (${initResponse.status}): ${errText}`
    );
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
      `Wavespeed API response missing prediction/request ID: ${JSON.stringify(
        initData
      )}`
    );
  }

  console.log(
    `[VideoGen Wavespeed WAN 2.2] Prediction created with ID: ${requestId}`
  );

  // 2. Poll result endpoint until terminal status (4s initial, ramp up to 5s)
  const startTime = Date.now();
  const maxTimeoutMs = 300000; // 300 seconds
  let delayMs = 4000;
  let pollCount = 0;
  let lastStatus = "unknown";

  while (Date.now() - startTime < maxTimeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs + 500, 5000);
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
      throw new VideoGenError(
        `Wavespeed video polling failed (${pollResponse.status}) for request ${requestId}: ${errText}`
      );
    }

    const pollData = await pollResponse.json();
    const status = String(
      pollData.status || pollData.state || pollData.data?.status || ""
    ).toLowerCase();
    lastStatus = status;

    console.log(
      `[VideoGen Wavespeed Polling] Poll #${pollCount} | Request: ${requestId} | Status: ${status}`
    );

    if (status === "completed" || status === "succeeded" || status === "done") {
      const outputs =
        pollData.outputs ||
        pollData.output ||
        pollData.data?.outputs ||
        pollData.data?.output ||
        pollData.result?.urls ||
        pollData.result;

      const videoUrl = Array.isArray(outputs)
        ? outputs[0]
        : typeof outputs === "string"
        ? outputs
        : null;

      if (!videoUrl) {
        throw new VideoGenError(
          `Wavespeed prediction completed but video URL is missing: ${JSON.stringify(
            pollData
          )}`
        );
      }

      // 3. Download generated 5-second video clip
      console.log(
        `[VideoGen Wavespeed WAN 2.2] Downloading generated video from ${videoUrl}...`
      );
      const vidRes = await fetch(videoUrl);
      if (!vidRes.ok) {
        throw new VideoGenError(
          `Failed to download completed video from ${videoUrl} (${vidRes.status})`
        );
      }

      const arrayBuffer = await vidRes.arrayBuffer();
      let videoBuffer: Buffer = Buffer.from(arrayBuffer);

      // 4. If target duration exceeds 5s, apply Ken Burns extension logic
      if (durationSeconds > 5) {
        console.log(
          `[VideoGen Extension] Target duration ${durationSeconds}s > 5s base clip. Extending last frame via Ken Burns...`
        );
        videoBuffer = await extendVideoClipDuration(
          videoBuffer,
          durationSeconds
        );
      }

      // 5. Save via saveGeneratedFile into public/generated/videos/
      const fileName = `video_${Date.now()}_${Math.random()
        .toString(36)
        .substring(7)}.mp4`;
      const savedUrl = await saveGeneratedFile(
        videoBuffer,
        fileName,
        "videos",
        "video/mp4"
      );

      // Verify file on disk and log file size in bytes using fs.statSync
      const diskPath = path.join(
        process.cwd(),
        "public",
        "generated",
        "videos",
        fileName
      );
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
      throw new VideoGenError(
        `Wavespeed prediction failed with status '${status}': ${JSON.stringify(
          pollData
        )}`
      );
    }
  }

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
  throw new VideoGenError(
    `Wavespeed video generation timed out after ${elapsedSeconds}s (${pollCount} polls), last status: ${lastStatus}, request ID: ${requestId}`
  );
}
