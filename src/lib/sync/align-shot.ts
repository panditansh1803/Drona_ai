/**
 * Alignment & Reconciliation Module
 * -----------------------------------
 * Video generation duration and real spoken voiceover duration from TTS
 * will not match by default. This module reconciles video duration and caption cues,
 * ensuring downstream consumers (such as the Remotion composition pipeline)
 * receive synchronized video, audio, and captions.
 */

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import fs from "fs";
import { saveGeneratedFile } from "@/src/lib/storage/local";
import { isFfmpegAvailable, getFfmpegPath } from "@/src/lib/video/ffmpeg-check";

const execAsync = promisify(exec);

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface CaptionCue {
  text: string;
  start: number;
  end: number;
}

/**
 * Adjusts a video clip's duration to match the target voiceover duration:
 * - If video > target: trim from the end using FFmpeg.
 * - If video < target: hold (freeze) the final frame for the remaining duration.
 *
 * Outputs to a persistent /generated/videos/ path (or returns original videoUrl if FFmpeg fails).
 */
export async function matchVideoDuration(
  videoUrl: string,
  targetDurationSeconds: number,
  actualVideoDurationSeconds: number
): Promise<string> {
  // If difference is negligible (< 0.1s), return as-is
  const diff = targetDurationSeconds - actualVideoDurationSeconds;
  if (Math.abs(diff) < 0.1) {
    return videoUrl;
  }

  if (!isFfmpegAvailable()) {
    console.warn(
      "[matchVideoDuration] FFmpeg is not available on PATH. Returning unadjusted video URL."
    );
    return videoUrl;
  }

  // Resolve input path for ffmpeg: relative /generated/... web paths -> absolute disk path
  let inputPath = videoUrl;
  if (videoUrl.startsWith("/")) {
    inputPath = path.join(process.cwd(), "public", videoUrl.replace(/^\//, ""));
  }

  const tmpDir = os.tmpdir();
  const outputFileName = `aligned_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`;
  const outputPath = path.join(tmpDir, outputFileName);

  try {
    let command: string;
    const ffmpegExe = getFfmpegPath();

    const scalePad16x9 =
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p";

    if (diff < 0) {
      // Video is LONGER than target -> Trim from the end and enforce 16:9
      command = `"${ffmpegExe}" -y -i "${inputPath}" -vf "${scalePad16x9}" -t ${targetDurationSeconds.toFixed(2)} -c:v libx264 -pix_fmt yuv420p -c:a aac "${outputPath}"`;
    } else {
      // Video is SHORTER than target -> Hold (clone) the last frame and enforce 16:9
      const padDuration = diff.toFixed(2);
      command = `"${ffmpegExe}" -y -i "${inputPath}" -vf "tpad=stop_mode=clone:stop_duration=${padDuration},${scalePad16x9}" -c:v libx264 -pix_fmt yuv420p -c:a aac "${outputPath}"`;
    }

    await execAsync(command);

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      const fileBuffer = fs.readFileSync(outputPath);
      const savedUrl = await saveGeneratedFile(
        fileBuffer,
        outputFileName,
        "videos",
        "video/mp4"
      );

      try {
        fs.unlinkSync(outputPath);
      } catch {
        /* ignore temp file cleanup */
      }

      console.log(
        `[matchVideoDuration] Video aligned from ${actualVideoDurationSeconds}s to ${targetDurationSeconds}s -> ${savedUrl}`
      );
      return savedUrl;
    }
  } catch (error) {
    console.warn(
      "[matchVideoDuration] FFmpeg processing failed. Returning unadjusted video URL.",
      error
    );
  }

  return videoUrl;
}

/**
 * Builds caption cues for a shot.
 * With WaveSpeed MiniMax Speech-02 Turbo, generates one caption cue per shot
 * spanning the full clip duration. If multi-word timestamps are provided,
 * groups them into readable 4–8 word cues.
 */
export function buildCaptionCues(
  wordTimestamps?: WordTimestamp[] | null,
  fallbackText?: string,
  totalDurationSeconds?: number
): CaptionCue[] {
  if (wordTimestamps && wordTimestamps.length > 0) {
    // Single-entry full shot caption cue (WaveSpeed Speech-02 format)
    if (wordTimestamps.length === 1) {
      return [
        {
          text: wordTimestamps[0].word,
          start: wordTimestamps[0].start,
          end: wordTimestamps[0].end,
        },
      ];
    }

    // Multi-word timestamps (if fine-grained timestamps exist)
    const captionCues: CaptionCue[] = [];
    const TARGET_WORD_COUNT = 6;
    const MAX_WORD_COUNT = 8;

    let currentChunk: WordTimestamp[] = [];

    const pushChunk = () => {
      if (currentChunk.length === 0) return;

      const firstWord = currentChunk[0];
      const lastWord = currentChunk[currentChunk.length - 1];

      const cueText = currentChunk.map((w) => w.word).join(" ");
      captionCues.push({
        text: cueText,
        start: firstWord.start,
        end: lastWord.end,
      });

      currentChunk = [];
    };

    for (let i = 0; i < wordTimestamps.length; i++) {
      const item = wordTimestamps[i];
      currentChunk.push(item);

      const hasPunctuationEnd = /[.?!;,]$/.test(item.word);
      const reachedMaxCount = currentChunk.length >= MAX_WORD_COUNT;
      const reachedTargetCount = currentChunk.length >= TARGET_WORD_COUNT;

      if (
        reachedMaxCount ||
        hasPunctuationEnd ||
        (reachedTargetCount && i === wordTimestamps.length - 1)
      ) {
        pushChunk();
      }
    }

    pushChunk();
    return captionCues;
  }

  if (fallbackText && fallbackText.trim()) {
    return [
      {
        text: fallbackText.trim(),
        start: 0,
        end: totalDurationSeconds || 5,
      },
    ];
  }

  return [];
}
