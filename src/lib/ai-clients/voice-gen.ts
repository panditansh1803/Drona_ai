import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { saveGeneratedFile } from "@/src/lib/storage/local";
import { getEnvVar } from "@/src/lib/env";
import { getFfmpegPath } from "@/src/lib/video/ffmpeg-check";

const execAsync = promisify(exec);

export const VOICE_ID = "Wise_Woman";

export class VoiceGenError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(`VoiceGen Error: ${message}`);
    this.name = "VoiceGenError";
  }
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface VoiceoverResult {
  audioUrl: string;
  durationSeconds: number;
  wordTimestamps: WordTimestamp[];
}

function getWavespeedApiKey(required = true): string | null {
  const apiKey = getEnvVar("WAVESPEED_API_KEY");
  if (!apiKey && required) {
    throw new VoiceGenError("WAVESPEED_API_KEY environment variable is missing");
  }
  return apiKey || null;
}

/**
 * Accurately measures audio duration from disk using ffprobe.
 */
async function measureAudioDuration(diskPath: string, text: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of json "${diskPath}"`
    );
    const data = JSON.parse(stdout);
    const dur = parseFloat(data.format?.duration);
    if (!isNaN(dur) && dur > 0) {
      return Math.round(dur * 100) / 100;
    }
  } catch (err) {
    console.warn("[VoiceGen] FFprobe duration check failed:", err);
  }

  // Fallback estimation based on spoken word count (~2.5 words/sec)
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.round((words / 2.5) * 100) / 100);
}

/**
 * Generates background music (BGM) using WaveSpeed Mureka v7.6.
 * Fails soft: returns null on missing API key or error, without failing the pipeline.
 */
export async function generateBackgroundMusic(
  prompt: string,
  durationSeconds: number
): Promise<string | null> {
  const apiKey = getWavespeedApiKey(false);
  if (!apiKey) {
    console.warn(
      "[BgmGen] WAVESPEED_API_KEY is missing or empty. Skipping background music generation (fail-soft)."
    );
    return null;
  }

  try {
    console.log(
      `[BgmGen WaveSpeed Mureka v7.6] Submitting BGM generation for ~${durationSeconds.toFixed(1)}s: "${prompt.slice(0, 60)}..."`
    );

    // 1. POST request to WaveSpeed Mureka v7.6 BGM endpoint
    const initResponse = await fetch(
      "https://api.wavespeed.ai/api/v3/mureka-ai/mureka-v7.6/generate-bgm",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          n: 1,
          stream: false,
        }),
      }
    );

    if (!initResponse.ok) {
      const errText = await initResponse.text();
      console.warn(
        `[BgmGen] WaveSpeed Mureka BGM submission failed (${initResponse.status}): ${errText}. Continuing without BGM.`
      );
      return null;
    }

    const initData = await initResponse.json();
    const requestId =
      initData.id ||
      initData.request_id ||
      initData.prediction_id ||
      initData.data?.id ||
      initData.data?.request_id;

    if (!requestId) {
      console.warn(
        `[BgmGen] WaveSpeed API response missing prediction/request ID: ${JSON.stringify(initData)}`
      );
      return null;
    }

    // 2. Poll result endpoint until terminal status (up to 90s)
    const startTime = Date.now();
    const maxTimeoutMs = 90000;
    let delayMs = 3000;
    let pollCount = 0;

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
        break;
      }

      const pollData = await pollResponse.json();
      const status = String(
        pollData.status || pollData.state || pollData.data?.status || ""
      ).toLowerCase();

      console.log(
        `[BgmGen Polling] Poll #${pollCount} | Request: ${requestId} | Status: ${status}`
      );

      if (status === "completed" || status === "succeeded" || status === "done") {
        const outputs =
          pollData.outputs ||
          pollData.output ||
          pollData.data?.outputs ||
          pollData.data?.output ||
          pollData.result?.urls ||
          pollData.result;

        const audioUrl = Array.isArray(outputs)
          ? outputs[0]
          : typeof outputs === "string"
          ? outputs
          : null;

        if (audioUrl) {
          const bgmRes = await fetch(audioUrl);
          if (bgmRes.ok) {
            const arrayBuffer = await bgmRes.arrayBuffer();
            const bgmBuffer = Buffer.from(arrayBuffer);
            const fileName = `bgm_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;
            const savedBgmUrl = await saveGeneratedFile(
              bgmBuffer,
              fileName,
              "audio",
              "audio/mp3"
            );
            console.log(
              `[BgmGen Success] Saved background music: ${savedBgmUrl} (${bgmBuffer.length} bytes)`
            );
            return savedBgmUrl;
          }
        }
        break;
      }

      if (status === "failed" || status === "error" || status === "canceled") {
        console.warn(`[BgmGen] WaveSpeed BGM generation failed with status: ${status}`);
        return null;
      }
    }
  } catch (err) {
    console.warn("[BgmGen] Background music generation error (fail-soft):", err);
  }

  return null;
}

/**
 * Mixes background music under the primary voiceover track using FFmpeg.
 * - Ducks BGM volume to ~-13 dB (volume=0.22) so music is audible and present while voiceover remains dominant.
 * - Adds gentle fade-in / fade-out on BGM.
 * - Applies limiter (alimiter=limit=0.95) to prevent any audio clipping.
 */
export async function mixVoiceoverWithBgm(
  voiceoverUrl: string,
  bgmUrl: string | null,
  targetDurationSeconds: number
): Promise<string> {
  if (!bgmUrl) {
    return voiceoverUrl;
  }

  const voiceoverDiskPath = path.join(
    process.cwd(),
    "public",
    voiceoverUrl.replace(/^\//, "")
  );
  const bgmDiskPath = path.join(
    process.cwd(),
    "public",
    bgmUrl.replace(/^\//, "")
  );

  if (!fs.existsSync(voiceoverDiskPath) || !fs.existsSync(bgmDiskPath)) {
    return voiceoverUrl;
  }

  const ffmpegExe = getFfmpegPath();
  const tempDir = path.join(process.cwd(), "public", "generated", "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const mixedFileName = `voice_mix_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;
  const mixedDiskPath = path.join(tempDir, mixedFileName);

  try {
    const fadeOutStart = Math.max(0, targetDurationSeconds - 1.5).toFixed(2);

    // Audio filter graph:
    // [1:a] (BGM): volume 0.22 (~-13dB relative to voice), 1s fade-in, 1.5s fade-out -> [bgm]
    // [0:a][bgm] amix: duration=first (ends with voice), dropout_transition=2, limiter 0.95 -> clean master
    const filterGraph = `[1:a]volume=0.22,afade=t=in:st=0:d=1.0,afade=t=out:st=${fadeOutStart}:d=1.5[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2,alimiter=limit=0.95[aout]`;

    await execAsync(
      `"${ffmpegExe}" -y -i "${voiceoverDiskPath}" -stream_loop -1 -i "${bgmDiskPath}" -filter_complex "${filterGraph}" -map "[aout]" -c:a libmp3lame -b:a 192k "${mixedDiskPath}"`
    );

    if (fs.existsSync(mixedDiskPath) && fs.statSync(mixedDiskPath).size > 0) {
      const mixedBuffer = fs.readFileSync(mixedDiskPath);
      const savedMixedUrl = await saveGeneratedFile(
        mixedBuffer,
        mixedFileName,
        "audio",
        "audio/mp3"
      );

      try {
        fs.unlinkSync(mixedDiskPath);
      } catch {
        /* ignore */
      }

      console.log(
        `[VoiceGen Mix] Mixed voiceover with BGM: ${savedMixedUrl} (${mixedBuffer.length} bytes)`
      );
      return savedMixedUrl;
    }
  } catch (err) {
    console.warn(
      "[VoiceGen Mix] FFmpeg audio mixing failed, returning unmixed voiceover:",
      err
    );
  }

  return voiceoverUrl;
}

export async function generateVoiceover(text: string): Promise<VoiceoverResult> {
  const apiKey = getWavespeedApiKey();

  if (!text || text.trim() === "") {
    throw new VoiceGenError("Narration text cannot be empty");
  }

  console.log(`[VoiceGen Wavespeed MiniMax Speech-02 Turbo] Submitting TTS for: "${text.slice(0, 60)}..."`);

  // 1. POST request to Wavespeed MiniMax Speech-02 Turbo endpoint
  const initResponse = await fetch(
    "https://api.wavespeed.ai/api/v3/minimax/speech-02-turbo",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice_id: VOICE_ID,
        speed: 1,
        volume: 1,
        pitch: 0,
        emotion: "neutral",
      }),
    }
  );

  if (!initResponse.ok) {
    const errText = await initResponse.text();
    throw new VoiceGenError(
      `Wavespeed Speech-02 Turbo submission failed (${initResponse.status}): ${errText}`
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
    throw new VoiceGenError(
      `Wavespeed API response missing prediction/request ID: ${JSON.stringify(initData)}`
    );
  }

  console.log(`[VoiceGen Wavespeed] Prediction created with ID: ${requestId}`);

  // 2. Poll result endpoint until terminal status (3s initial, up to 5s)
  const startTime = Date.now();
  const maxTimeoutMs = 180000; // 180 seconds
  let delayMs = 3000;
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
      throw new VoiceGenError(
        `Wavespeed voice polling failed (${pollResponse.status}) for request ${requestId}: ${errText}`
      );
    }

    const pollData = await pollResponse.json();
    const status = String(
      pollData.status || pollData.state || pollData.data?.status || ""
    ).toLowerCase();
    lastStatus = status;

    console.log(
      `[VoiceGen Wavespeed Polling] Poll #${pollCount} | Request: ${requestId} | Status: ${status}`
    );

    if (status === "completed" || status === "succeeded" || status === "done") {
      const outputs =
        pollData.outputs ||
        pollData.output ||
        pollData.data?.outputs ||
        pollData.data?.output ||
        pollData.result?.urls ||
        pollData.result;

      const audioUrl = Array.isArray(outputs)
        ? outputs[0]
        : typeof outputs === "string"
        ? outputs
        : null;

      if (!audioUrl) {
        throw new VoiceGenError(
          `Wavespeed prediction completed but audio URL is missing: ${JSON.stringify(pollData)}`
        );
      }

      // 3. Download audio file
      console.log(`[VoiceGen Wavespeed] Downloading completed voiceover from ${audioUrl}...`);
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) {
        throw new VoiceGenError(
          `Failed to download completed audio from ${audioUrl} (${audioRes.status})`
        );
      }

      const arrayBuffer = await audioRes.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);
      const fileName = `voice_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;

      // 4. Save to local storage or R2
      const savedUrl = await saveGeneratedFile(audioBuffer, fileName, "audio", "audio/mp3");

      // Verify file on disk and measure duration
      const diskPath = path.join(process.cwd(), "public", "generated", "audio", fileName);
      let durationSeconds = 0;
      if (fs.existsSync(diskPath)) {
        durationSeconds = await measureAudioDuration(diskPath, text);
      } else {
        const words = text.split(/\s+/).filter(Boolean).length;
        durationSeconds = Math.max(2, Math.round((words / 2.5) * 100) / 100);
      }

      console.log(
        `[VoiceGen Success] Text: "${text.slice(0, 60)}..." | Saved: ${savedUrl} | Duration: ${durationSeconds}s | Size: ${audioBuffer.length} bytes`
      );

      // 5. Generate matching background music and mix underneath voiceover
      const bgmPrompt =
        "ambient calm chill educational background instrumental music, soft piano, strings, low volume, subtle rhythm";
      const bgmUrl = await generateBackgroundMusic(bgmPrompt, durationSeconds);
      const finalAudioUrl = await mixVoiceoverWithBgm(savedUrl, bgmUrl, durationSeconds);

      return {
        audioUrl: finalAudioUrl,
        durationSeconds,
        wordTimestamps: [
          {
            word: text,
            start: 0,
            end: durationSeconds,
          },
        ],
      };
    }

    if (status === "failed" || status === "error" || status === "canceled") {
      throw new VoiceGenError(
        `Wavespeed prediction failed with status '${status}': ${JSON.stringify(pollData)}`
      );
    }
  }

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
  throw new VoiceGenError(
    `Wavespeed voice generation timed out after ${elapsedSeconds}s (${pollCount} polls), last status: ${lastStatus}, request ID: ${requestId}`
  );
}
