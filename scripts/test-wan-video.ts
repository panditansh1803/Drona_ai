import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { generateShotVideo } from "../src/lib/ai-clients/video-gen";

const execAsync = promisify(exec);

async function testWanVideo() {
  console.log("=================================================================");
  console.log("    TESTING WAVESPEED WAN 2.2 480P ULTRA-FAST VIDEO GENERATION   ");
  console.log("=================================================================\n");

  const sourceImageRelPath = "/generated/images/img_1786702770974_2tflr8.png";
  const diskPath = path.join(process.cwd(), "public", sourceImageRelPath.slice(1));

  if (!fs.existsSync(diskPath)) {
    throw new Error(`Source image does not exist at ${diskPath}`);
  }

  console.log(`Using source image: ${sourceImageRelPath} (${fs.statSync(diskPath).size} bytes)`);

  const prompt = "Slow camera push in, gentle ambient motion on the plant leaf as light particles drift upward";
  const targetDuration = 5; // 5-second base clip

  console.log(`\n[STEP 1] Generating ${targetDuration}s base video clip with WaveSpeed WAN 2.2...`);
  const startTime = Date.now();
  const videoUrl = await generateShotVideo(prompt, targetDuration, sourceImageRelPath);
  const elapsedMs = Date.now() - startTime;

  console.log(`\n✓ Video generated in ${(elapsedMs / 1000).toFixed(1)}s!`);
  console.log(`  - Saved URL: ${videoUrl}`);

  const savedDiskPath = path.join(process.cwd(), "public", videoUrl.startsWith("/") ? videoUrl.slice(1) : videoUrl);

  if (!fs.existsSync(savedDiskPath)) {
    throw new Error(`Generated video not found on disk at ${savedDiskPath}`);
  }

  const stat = fs.statSync(savedDiskPath);
  console.log(`  - Disk File: ${savedDiskPath}`);
  console.log(`  - File Size: ${(stat.size / 1024).toFixed(1)} KB`);

  // Probe video with ffprobe
  const { stdout } = await execAsync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,r_frame_rate -of json "${savedDiskPath}"`
  );
  const probeData = JSON.parse(stdout);
  const stream = probeData.streams?.[0];

  console.log(`\n[FFprobe Diagnostics]:`);
  console.log(`  - Dimensions: ${stream?.width}x${stream?.height}`);
  console.log(`  - Frame Rate: ${stream?.r_frame_rate}`);
  console.log(`  - Measured Duration: ${stream?.duration}s`);

  if (!stream || !stream.duration || parseFloat(stream.duration) < 4.0) {
    throw new Error(`Video duration ${stream?.duration}s is invalid (expected ~5.0s)`);
  }

  console.log("\n=================================================================");
  console.log("[STEP 2] Testing Extension: Generating 7.5s video clip (>5s)...");
  const startTimeExt = Date.now();
  const videoExtUrl = await generateShotVideo(prompt, 7.5, sourceImageRelPath);
  const elapsedExtMs = Date.now() - startTimeExt;

  console.log(`\n✓ Extended video generated in ${(elapsedExtMs / 1000).toFixed(1)}s!`);
  console.log(`  - Saved URL: ${videoExtUrl}`);

  const savedExtDiskPath = path.join(process.cwd(), "public", videoExtUrl.startsWith("/") ? videoExtUrl.slice(1) : videoExtUrl);
  const { stdout: stdoutExt } = await execAsync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,r_frame_rate -of json "${savedExtDiskPath}"`
  );
  const probeDataExt = JSON.parse(stdoutExt);
  const streamExt = probeDataExt.streams?.[0];

  console.log(`\n[FFprobe Extension Diagnostics]:`);
  console.log(`  - Dimensions: ${streamExt?.width}x${streamExt?.height}`);
  console.log(`  - Frame Rate: ${streamExt?.r_frame_rate}`);
  console.log(`  - Measured Duration: ${streamExt?.duration}s`);

  if (!streamExt || !streamExt.duration || parseFloat(streamExt.duration) < 7.0) {
    throw new Error(`Extended video duration ${streamExt?.duration}s is invalid (expected >= 7.0s)`);
  }

  console.log("\n=================================================================");
  console.log("       WAVESPEED WAN 2.2 VIDEO GENERATION TEST PASSED!           ");
  console.log("=================================================================");
}

testWanVideo().catch((err) => {
  console.error("\n❌ TEST FAILED:", err);
  process.exit(1);
});
