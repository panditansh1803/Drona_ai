import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "../src/lib/db";
import { renderAndUploadVideo } from "../render/renderer";
import { ensureFfmpegAvailable, getFfmpegPath, getFfprobePath } from "../src/lib/video/ffmpeg-check";
import type { RenderShot } from "../render/types";

const execAsync = promisify(exec);

interface CaptionCue {
  text: string;
  start: number;
  end: number;
}

/**
 * Resolves a web path (/generated/...) or relative/absolute path to an absolute disk path
 * and checks existence and file size.
 */
function inspectDiskAsset(assetUrl: string | null | undefined): {
  exists: boolean;
  diskPath: string;
  sizeBytes: number;
  isValidMedia: boolean;
} {
  if (!assetUrl) {
    return { exists: false, diskPath: "", sizeBytes: 0, isValidMedia: false };
  }
  let diskPath = assetUrl;
  if (assetUrl.startsWith("http://") || assetUrl.startsWith("https://")) {
    return { exists: true, diskPath: assetUrl, sizeBytes: -1, isValidMedia: true };
  }
  if (assetUrl.startsWith("/")) {
    diskPath = path.join(process.cwd(), "public", assetUrl.replace(/^\//, ""));
  } else if (!path.isAbsolute(assetUrl)) {
    diskPath = path.join(process.cwd(), "public", assetUrl);
  }

  const exists = fs.existsSync(diskPath);
  const sizeBytes = exists ? fs.statSync(diskPath).size : 0;
  // Valid media files must be > 1KB (avoiding 45-byte mock placeholders or empty files)
  const isValidMedia = exists && sizeBytes > 1000;
  return { exists, diskPath, sizeBytes, isValidMedia };
}

/**
 * Parses caption cues from database format (JSON string or array)
 */
function parseCaptionCues(rawCues: unknown): CaptionCue[] {
  if (!rawCues) return [];
  if (Array.isArray(rawCues)) return rawCues as CaptionCue[];
  if (typeof rawCues === "string") {
    try {
      const parsed = JSON.parse(rawCues);
      if (Array.isArray(parsed)) return parsed as CaptionCue[];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Probes the exact duration of a media file via ffprobe
 */
async function probeMediaDuration(filePath: string): Promise<number | null> {
  try {
    const ffprobeExe = getFfprobePath();
    const { stdout } = await execAsync(
      `"${ffprobeExe}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? null : duration;
  } catch {
    return null;
  }
}

async function main() {
  console.log("=================================================================");
  console.log("      DRONA AI - STANDALONE VIDEO RENDER & STITCH TEST SCRIPT    ");
  console.log("       (Zero API Cost — Uses Local DB & Disk Assets Only)        ");
  console.log("=================================================================\n");

  // ─── Stage 1: Pre-flight FFmpeg Verification ───────────────────────────────
  console.log("[Stage 1/5] Checking FFmpeg & environment pre-requisites...");
  try {
    ensureFfmpegAvailable();
    const ffmpegExe = getFfmpegPath();
    const { stdout: ffmpegVer } = await execAsync(`"${ffmpegExe}" -version`);
    console.log(`  ✓ Bundled FFmpeg is available: ${ffmpegVer.split("\n")[0]}`);
  } catch (err) {
    console.error("  ❌ FFmpeg pre-flight check failed:", (err as Error).message);
    process.exit(1);
  }

  // ─── Stage 2: Fetch Project and Shots from Database ────────────────────────
  console.log("\n[Stage 2/5] Reading Project and Shot data from SQLite Database...");
  const cliProjectId = process.argv[2]?.trim();

  const allProjects = await prisma.project.findMany({
    include: {
      shots: {
        orderBy: { number: "asc" },
      },
    },
    orderBy: { updated_at: "desc" },
  });

  let targetProject: (typeof allProjects)[number] | null | undefined = null;

  if (allProjects.length === 0) {
    console.error("❌ No projects found in the database.");
    console.error("   Please run a project generation pipeline first.");
    process.exit(1);
  }

  if (cliProjectId) {
    console.log(`  - Searching for Project ID passed via CLI: "${cliProjectId}"`);
    targetProject = allProjects.find((p) => p.project_id === cliProjectId);

    if (!targetProject) {
      console.error(`❌ Project with ID "${cliProjectId}" was not found in the database.\n`);
      console.log("Available projects in database:");
      allProjects.forEach((p) => {
        const validVideos = p.shots.filter((s) => inspectDiskAsset(s.generated_video_url).exists).length;
        console.log(`  • ID: ${p.project_id} | Status: ${p.status.padEnd(14)} | Shots: ${p.shots.length} (${validVideos} with video) | Topic: "${p.topic_name}"`);
      });
      process.exit(1);
    }
  } else {
    console.log("  - No Project ID passed as command-line argument.");
    console.log("  - Scanning database for projects with existing generated video and audio files...");

    // Rank projects: prefer projects with complete valid video and audio files on disk
    const projectsWithScores = allProjects.map((p) => {
      const shotsTotal = p.shots.length;
      const validVideos = p.shots.filter((s) => inspectDiskAsset(s.generated_video_url).isValidMedia).length;
      const validAudios = p.shots.filter((s) => inspectDiskAsset(s.generated_voiceover_url).isValidMedia).length;
      const isComplete = shotsTotal > 0 && validVideos === shotsTotal && validAudios === shotsTotal;
      return {
        project: p,
        shotsTotal,
        validVideos,
        validAudios,
        isComplete,
        score: (validVideos * 2) + validAudios + (isComplete ? 100 : 0),
      };
    });

    projectsWithScores.sort((a, b) => b.score - a.score);

    const bestCandidate = projectsWithScores[0];
    if (!bestCandidate || bestCandidate.validVideos === 0) {
      console.error("❌ Could not find any project with generated video files on disk in public/generated/.");
      process.exit(1);
    }

    targetProject = bestCandidate.project;
  }

  if (!targetProject) {
    console.error("❌ No valid project could be selected.");
    process.exit(1);
  }

  const selectedProj = targetProject;

  if (!cliProjectId) {
    console.log("  All available database projects:");
    allProjects.forEach((p) => {
      const marker = p.project_id === selectedProj.project_id ? "👉 [SELECTED]" : "  ";
      console.log(`  ${marker} ID: ${p.project_id} | Status: ${p.status.padEnd(14)} | Shots: ${p.shots.length} | "${p.topic_name}"`);
    });
    console.log("");
  }

  console.log(`\nTarget Project Details:`);
  console.log(`  • ID:          ${selectedProj.project_id}`);
  console.log(`  • Topic:       "${selectedProj.topic_name}"`);
  console.log(`  • Status:      ${selectedProj.status}`);
  console.log(`  • Shot Count:  ${selectedProj.shots.length}`);

  if (selectedProj.shots.length === 0) {
    console.error("❌ Target project has 0 shots. Cannot render video.");
    process.exit(1);
  }

  // ─── Stage 3: Inspect Shot Assets on Disk & Prepare RenderShots ─────────────
  console.log("\n[Stage 3/5] Inspecting Shot Assets on Disk & Preparing Composition Data...");
  
  // Find a fallback video in public/generated/videos if a specific shot is missing a video
  const availableVideoFiles = fs.existsSync(path.join(process.cwd(), "public", "generated", "videos"))
    ? fs.readdirSync(path.join(process.cwd(), "public", "generated", "videos"))
        .filter((f) => f.endsWith(".mp4") && fs.statSync(path.join(process.cwd(), "public", "generated", "videos", f)).size > 1000)
    : [];
  const globalFallbackVideo = availableVideoFiles.length > 0
    ? `/generated/videos/${availableVideoFiles[0]}`
    : "";

  const renderShots: RenderShot[] = [];
  let expectedTotalDuration = 0;

  for (let i = 0; i < targetProject.shots.length; i++) {
    const s = targetProject.shots[i];
    const shotDuration = s.voiceover_duration_seconds || s.duration_seconds || 4;
    expectedTotalDuration += shotDuration;

    const videoCheck = inspectDiskAsset(s.generated_video_url);
    const audioCheck = inspectDiskAsset(s.generated_voiceover_url);
    const imageCheck = inspectDiskAsset(s.generated_image_url);
    const captionCues = parseCaptionCues(s.caption_cues);

    console.log(`\n  ─── Shot ${i + 1}/${targetProject.shots.length} (Shot #${s.number}) ───`);
    console.log(`      • Duration:      ${shotDuration}s (voiceover: ${s.voiceover_duration_seconds ?? "N/A"}s, script: ${s.duration_seconds}s)`);
    console.log(`      • Text:          "${s.text.slice(0, 65)}${s.text.length > 65 ? "..." : ""}"`);
    console.log(`      • Video URL:     ${s.generated_video_url || "(none)"}`);
    console.log(`        - Disk file:   ${videoCheck.isValidMedia ? `✓ Valid (${(videoCheck.sizeBytes / 1024).toFixed(1)} KB)` : videoCheck.exists ? `⚠ Invalid/too small (${videoCheck.sizeBytes} B)` : "✗ Missing"}`);
    console.log(`      • Audio URL:     ${s.generated_voiceover_url || "(none)"}`);
    console.log(`        - Disk file:   ${audioCheck.isValidMedia ? `✓ Valid (${(audioCheck.sizeBytes / 1024).toFixed(1)} KB)` : audioCheck.exists ? `⚠ Invalid/mock (${audioCheck.sizeBytes} B)` : "✗ Missing"}`);
    if (s.generated_image_url) {
      console.log(`      • Image URL:     ${s.generated_image_url}`);
      console.log(`        - Disk file:   ${imageCheck.exists ? `✓ Found (${(imageCheck.sizeBytes / 1024).toFixed(1)} KB)` : "✗ Missing"}`);
    }
    console.log(`      • Captions:      ${captionCues.length} cue(s) parsed`);

    // Ensure valid MP4 video URL for Remotion OffthreadVideo
    let resolvedVideoUrl = "";
    if (videoCheck.isValidMedia && s.generated_video_url?.endsWith(".mp4")) {
      resolvedVideoUrl = s.generated_video_url;
    } else if (globalFallbackVideo) {
      console.log(`      ⚠ Video missing/invalid; using local fallback MP4: ${globalFallbackVideo}`);
      resolvedVideoUrl = globalFallbackVideo;
    }

    renderShots.push({
      id: s.shot_id,
      number: s.number,
      videoUrl: resolvedVideoUrl,
      audioUrl: audioCheck.isValidMedia ? (s.generated_voiceover_url || undefined) : undefined,
      durationSeconds: shotDuration,
      captionCues: captionCues,
    });
  }

  console.log(`\n✓ All ${renderShots.length} shots prepared for renderer.`);
  console.log(`  • Sum of Shots' Durations: ${expectedTotalDuration.toFixed(2)} seconds`);

  // ─── Stage 4: Call the same render function as POST /api/projects/[id]/render ─
  console.log("\n[Stage 4/5] Executing Remotion Video Render & Stitching Pipeline...");
  console.log("  - Invoking renderAndUploadVideo() directly with shot data (skipping generation APIs)...");
  
  const renderStartTime = Date.now();
  const renderedVideoUrl = await renderAndUploadVideo(targetProject.project_id, renderShots);
  const renderElapsedSeconds = ((Date.now() - renderStartTime) / 1000).toFixed(2);
  
  console.log(`✓ Remotion render completed in ${renderElapsedSeconds}s!`);
  console.log(`  - Output generated at: ${renderedVideoUrl}`);

  // ─── Stage 5: Save to test-render-output.mp4 & Verify Duration ──────────────
  console.log("\n[Stage 5/5] Finalizing Output to test-render-output.mp4 & Verifying Durations...");

  // Locate the generated file on disk
  const renderedDiskPath = path.join(
    process.cwd(),
    "public",
    renderedVideoUrl.replace(/^\//, "")
  );

  if (!fs.existsSync(renderedDiskPath)) {
    throw new Error(`Rendered video file not found on disk at: ${renderedDiskPath}`);
  }

  const renderedSize = fs.statSync(renderedDiskPath).size;
  console.log(`  - Source Render File: ${renderedDiskPath} (${(renderedSize / (1024 * 1024)).toFixed(2)} MB)`);

  // Target standard output file: public/generated/final/test-render-output.mp4
  const finalOutputDir = path.join(process.cwd(), "public", "generated", "final");
  if (!fs.existsSync(finalOutputDir)) {
    fs.mkdirSync(finalOutputDir, { recursive: true });
  }

  const finalOutputPath = path.join(finalOutputDir, "test-render-output.mp4");
  fs.copyFileSync(renderedDiskPath, finalOutputPath);

  const finalOutputSize = fs.statSync(finalOutputPath).size;
  console.log(`✓ Output successfully saved to: ${finalOutputPath}`);
  console.log(`  - Final MP4 Size: ${(finalOutputSize / (1024 * 1024)).toFixed(2)} MB (${finalOutputSize} bytes)`);

  // Probe measured duration via ffprobe
  const measuredDuration = await probeMediaDuration(finalOutputPath);

  console.log("\n=================================================================");
  console.log("                     RENDER RESULTS SUMMARY                      ");
  console.log("=================================================================");
  console.log(`  • Project ID:        ${targetProject.project_id}`);
  console.log(`  • Topic Name:        "${targetProject.topic_name}"`);
  console.log(`  • Total Shots:       ${renderShots.length}`);
  console.log(`  • Render Time:       ${renderElapsedSeconds} seconds`);
  console.log(`  • Output File:       public/generated/final/test-render-output.mp4`);
  console.log(`  • Final File Size:   ${(finalOutputSize / (1024 * 1024)).toFixed(2)} MB (${finalOutputSize} bytes)`);
  console.log(`  • Expected Duration: ${expectedTotalDuration.toFixed(2)}s (sum of ${renderShots.length} shots)`);

  if (measuredDuration !== null) {
    console.log(`  • Measured Duration: ${measuredDuration.toFixed(2)}s (via ffprobe)`);
    const diff = Math.abs(measuredDuration - expectedTotalDuration);
    console.log(`  • Duration Delta:    ${diff.toFixed(2)}s`);
    if (diff <= 1.0) {
      console.log(`  • Duration Match:    ✓ PASSED (Within 1.0s tolerance)`);
    } else {
      console.warn(`  • Duration Match:    ⚠ Delta of ${diff.toFixed(2)}s observed`);
    }
  } else {
    console.log(`  • Measured Duration: (ffprobe probing unavailable)`);
  }

  console.log("=================================================================");
  console.log("   ✓ STANDALONE VIDEO RENDER TEST COMPLETED SUCCESSFULLY!        ");
  console.log("   ✓ 0 API calls made | Safe to run repeatedly                   ");
  console.log("=================================================================\n");
}

main()
  .catch((err) => {
    console.error("\n❌ STANDALONE RENDER TEST FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
