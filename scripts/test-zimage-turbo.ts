import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import path from "path";
import fs from "fs";
import { generateShotImage } from "../src/lib/ai-clients/image-gen";

async function testZImageTurbo() {
  console.log("=================================================================");
  console.log("      TESTING WAVESPEED Z-IMAGE TURBO IMAGE GENERATION           ");
  console.log("=================================================================\n");

  const prompt =
    "Flat 2D vector illustration, crisp lines: A glowing green chloroplast inside a plant cell converting sunlight beams into sugar glucose molecules, warm amber and teal palette, educational diagram style";

  console.log(`Prompt: "${prompt}"\n`);
  console.log("Submitting image generation request to WaveSpeed Z-Image Turbo...");

  const startTime = Date.now();
  const imageUrl = await generateShotImage(prompt);
  const elapsedMs = Date.now() - startTime;

  console.log(`\n✓ Image generated successfully in ${(elapsedMs / 1000).toFixed(1)}s!`);
  console.log(`  - Returned URL: ${imageUrl}`);

  const diskPath = path.join(process.cwd(), "public", imageUrl.startsWith("/") ? imageUrl.slice(1) : imageUrl);

  if (!fs.existsSync(diskPath)) {
    throw new Error(`Generated image file does not exist on disk at ${diskPath}`);
  }

  const stats = fs.statSync(diskPath);
  console.log(`  - Disk File: ${diskPath}`);
  console.log(`  - File Size: ${(stats.size / 1024).toFixed(1)} KB`);

  if (stats.size < 1000) {
    throw new Error(`Generated image file size (${stats.size} bytes) is suspiciously small!`);
  }

  console.log("\n=================================================================");
  console.log("       WAVESPEED Z-IMAGE TURBO TEST PASSED SUCCESSFULLY!         ");
  console.log("=================================================================");
}

testZImageTurbo().catch((err) => {
  console.error("\n❌ TEST FAILED:", err);
  process.exit(1);
});
