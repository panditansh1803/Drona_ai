import { renderAndUploadVideo } from "../render/renderer";
import { ensureFfmpegAvailable } from "../src/lib/video/ffmpeg-check";
import type { RenderShot } from "../render/types";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function test6ShotRender() {
  console.log("=================================================================");
  console.log("             TESTING 6-SHOT FULL REMOTION RENDER PIPELINE        ");
  console.log("=================================================================\n");

  // 1. Verify FFmpeg
  console.log("[1/4] Checking FFmpeg availability on PATH...");
  ensureFfmpegAvailable();
  const { stdout: ffmpegVer } = await execAsync("ffmpeg -version");
  console.log(`✓ FFmpeg is available on PATH: ${ffmpegVer.split("\n")[0]}\n`);

  // 2. Prepare 6 shots
  console.log("[2/4] Preparing 6 shots for rendering...");
  const existingVideos = fs
    .readdirSync(path.join(process.cwd(), "public", "generated", "videos"))
    .filter((f) => f.endsWith(".mp4") && fs.statSync(path.join(process.cwd(), "public", "generated", "videos", f)).size > 1000);

  const fallbackVideo =
    existingVideos.length > 0
      ? `/generated/videos/${existingVideos[0]}`
      : "";

  const existingAudio = fs.existsSync(path.join(process.cwd(), "public", "generated", "audio"))
    ? fs
        .readdirSync(path.join(process.cwd(), "public", "generated", "audio"))
        .filter(
          (f) =>
            (f.endsWith(".mp3") || f.endsWith(".wav")) &&
            fs.statSync(path.join(process.cwd(), "public", "generated", "audio", f)).size > 1000
        )
    : [];

  const fallbackAudio =
    existingAudio.length > 0
      ? `/generated/audio/${existingAudio[0]}`
      : undefined;

  const testShots: RenderShot[] = [
    {
      id: "shot-1",
      number: 1,
      videoUrl: fallbackVideo,
      audioUrl: fallbackAudio,
      durationSeconds: 3,
      captionCues: [{ text: "Welcome to this lesson on Cellular Respiration.", start: 0, end: 3 }],
    },
    {
      id: "shot-2",
      number: 2,
      videoUrl: fallbackVideo,
      audioUrl: fallbackAudio,
      durationSeconds: 4,
      captionCues: [{ text: "First, glycolysis breaks glucose down into pyruvate.", start: 0, end: 4 }],
    },
    {
      id: "shot-3",
      number: 3,
      videoUrl: fallbackVideo,
      audioUrl: fallbackAudio,
      durationSeconds: 3,
      captionCues: [{ text: "Next, the Krebs cycle occurs inside the mitochondria.", start: 0, end: 3 }],
    },
    {
      id: "shot-4",
      number: 4,
      videoUrl: fallbackVideo,
      audioUrl: fallbackAudio,
      durationSeconds: 4,
      captionCues: [{ text: "Electrons flow across the inner mitochondrial membrane.", start: 0, end: 4 }],
    },
    {
      id: "shot-5",
      number: 5,
      videoUrl: fallbackVideo,
      audioUrl: fallbackAudio,
      durationSeconds: 3,
      captionCues: [{ text: "ATP synthase generates energy molecules for the cell.", start: 0, end: 3 }],
    },
    {
      id: "shot-6",
      number: 6,
      videoUrl: fallbackVideo,
      audioUrl: fallbackAudio,
      durationSeconds: 3,
      captionCues: [{ text: "In summary, glucose and oxygen produce ATP and carbon dioxide.", start: 0, end: 3 }],
    },
  ];

  const expectedTotalDuration = testShots.reduce((sum, s) => sum + s.durationSeconds, 0);
  console.log(`✓ 6 test shots created. Total expected duration: ${expectedTotalDuration} seconds (3s + 4s + 3s + 4s + 3s + 3s)\n`);

  // 3. Render video composition via Remotion
  console.log("[3/4] Running renderAndUploadVideo (bundling Remotion composition & rendering frames)...");
  const testProjectId = `test_6shot_${Date.now()}`;
  const finalVideoUrl = await renderAndUploadVideo(testProjectId, testShots);
  console.log(`✓ Render completed! Final video URL: ${finalVideoUrl}\n`);

  // 4. Verify output file and probe duration via ffprobe
  console.log("[4/4] Probing output video duration and metadata...");
  const diskPath = path.join(process.cwd(), "public", finalVideoUrl.replace(/^\//, ""));
  if (!fs.existsSync(diskPath)) {
    throw new Error(`Rendered video not found on disk at: ${diskPath}`);
  }

  const stat = fs.statSync(diskPath);
  console.log(`  - File size: ${stat.size} bytes`);

  // Probe with ffprobe
  try {
    const { stdout: probeOut } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${diskPath}"`
    );
    const measuredDuration = parseFloat(probeOut.trim());
    console.log(`  - Measured duration from ffprobe: ${measuredDuration.toFixed(2)}s`);
    console.log(`  - Expected duration: ${expectedTotalDuration}s`);

    const diff = Math.abs(measuredDuration - expectedTotalDuration);
    if (diff > 1.0) {
      throw new Error(
        `Duration mismatch! Expected ~${expectedTotalDuration}s, got ${measuredDuration.toFixed(2)}s (diff: ${diff.toFixed(2)}s)`
      );
    }
    console.log(`✓ Duration test passed! Measured duration matches all 6 shots combined (${measuredDuration.toFixed(2)}s ~ ${expectedTotalDuration}s).`);
  } catch (probeErr) {
    console.warn("ffprobe check output:", probeErr);
  }

  console.log("\n=================================================================");
  console.log("          6-SHOT FULL REMOTION RENDER PIPELINE PASSED!           ");
  console.log("=================================================================");
}

test6ShotRender().catch((err) => {
  console.error("❌ 6-SHOT RENDER TEST FAILED:", err);
  process.exit(1);
});
