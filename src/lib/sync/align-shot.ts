/**
 * Alignment & Reconciliation Module
 * -----------------------------------
 * Video generation duration (e.g. 5-10s clips from Runway/Minimax) and real spoken
 * voiceover duration (from ElevenLabs TTS) will not match by default.
 * This module is the single place that reconciliation happens, so every downstream
 * consumer (such as the Remotion composition pipeline) can assume video, audio, and
 * captions are already aligned to the exact same length.
 */

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import fs from "fs";

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
 * Outputs to a temp file path (or returns original videoUrl if FFmpeg is unavailable/fails).
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

  const tmpDir = os.tmpdir();
  const outputFileName = `aligned_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`;
  const outputPath = path.join(tmpDir, outputFileName);

  try {
    let command: string;

    if (diff < 0) {
      // Video is LONGER than target -> Trim from the end
      command = `ffmpeg -y -i "${videoUrl}" -t ${targetDurationSeconds.toFixed(2)} -c:v libx264 -c:a aac "${outputPath}"`;
    } else {
      // Video is SHORTER than target -> Hold (clone) the last frame for the remaining time
      const padDuration = diff.toFixed(2);
      command = `ffmpeg -y -i "${videoUrl}" -vf "tpad=stop_mode=clone:stop_duration=${padDuration}" -c:v libx264 -c:a aac "${outputPath}"`;
    }

    await execAsync(command);

    if (fs.existsSync(outputPath)) {
      return outputPath;
    }
  } catch (error) {
    console.warn(
      "[matchVideoDuration] FFmpeg processing failed or FFmpeg is not installed locally. Returning unadjusted video URL.",
      error
    );
  }

  return videoUrl;
}

/**
 * Groups word-level timestamps into readable caption cues of roughly 4–8 words each.
 * Preserves the exact start time of the first word and exact end time of the last word
 * in each cue, preventing drift against the audio.
 */
export function buildCaptionCues(wordTimestamps: WordTimestamp[]): CaptionCue[] {
  if (!wordTimestamps || wordTimestamps.length === 0) {
    return [];
  }

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

    if (reachedMaxCount || hasPunctuationEnd || (reachedTargetCount && i === wordTimestamps.length - 1)) {
      pushChunk();
    }
  }

  // Push any remaining leftover words
  pushChunk();

  return captionCues;
}
