import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { generateVoiceover } from "../src/lib/ai-clients/voice-gen";
import { buildCaptionCues } from "../src/lib/sync/align-shot";

const execAsync = promisify(exec);

async function testWavespeedVoice() {
  console.log("=================================================================");
  console.log("    TESTING WAVESPEED MINIMAX SPEECH-02 TURBO VOICE GENERATION   ");
  console.log("=================================================================\n");

  const narrationText =
    "Inside every plant cell, tiny green factories called chloroplasts trap sunlight to turn water and air into sugar.";

  console.log(`Narration: "${narrationText}"\n`);
  console.log("Submitting voiceover request to WaveSpeed MiniMax Speech-02 Turbo...");

  const startTime = Date.now();
  const result = await generateVoiceover(narrationText);
  const elapsedMs = Date.now() - startTime;

  console.log(`\n✓ Voiceover generated in ${(elapsedMs / 1000).toFixed(1)}s!`);
  console.log(`  - Returned Audio URL: ${result.audioUrl}`);
  console.log(`  - Measured Duration: ${result.durationSeconds}s`);
  console.log(`  - Word Timestamps Structure:`, JSON.stringify(result.wordTimestamps, null, 2));

  const diskPath = path.join(
    process.cwd(),
    "public",
    result.audioUrl.startsWith("/") ? result.audioUrl.slice(1) : result.audioUrl
  );

  if (!fs.existsSync(diskPath)) {
    throw new Error(`Audio file does not exist on disk at ${diskPath}`);
  }

  const stat = fs.statSync(diskPath);
  console.log(`  - Disk File: ${diskPath}`);
  console.log(`  - File Size: ${(stat.size / 1024).toFixed(1)} KB`);

  if (stat.size < 1000) {
    throw new Error(`Audio file size (${stat.size} bytes) is suspiciously small / corrupted!`);
  }

  // FFprobe inspection
  const { stdout } = await execAsync(
    `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels,duration -of json "${diskPath}"`
  );
  const probe = JSON.parse(stdout);
  const stream = probe.streams?.[0];

  console.log(`\n[FFprobe Audio Diagnostics]:`);
  console.log(`  - Codec: ${stream?.codec_name}`);
  console.log(`  - Sample Rate: ${stream?.sample_rate} Hz`);
  console.log(`  - Channels: ${stream?.channels}`);
  console.log(`  - Stream Duration: ${stream?.duration}s`);

  // Verify Caption Cues builder
  const captionCues = buildCaptionCues(result.wordTimestamps);
  console.log(`\n[Caption Cues Generated]:`, JSON.stringify(captionCues, null, 2));

  if (captionCues.length !== 1 || captionCues[0].text !== narrationText) {
    throw new Error("Caption cue should be a single cue spanning the shot text");
  }

  console.log("\n=================================================================");
  console.log("       WAVESPEED VOICE GENERATION TEST PASSED SUCCESSFULLY!      ");
  console.log("=================================================================");
}

testWavespeedVoice().catch((err) => {
  console.error("\n❌ TEST FAILED:", err);
  process.exit(1);
});
