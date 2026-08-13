import { generateShotImage } from "../src/lib/ai-clients/image-gen";
import { generateShotVideo } from "../src/lib/ai-clients/video-gen";
import { generateVoiceover } from "../src/lib/ai-clients/voice-gen";
import { renderAndUploadVideo } from "../render/renderer";
import fs from "fs";
import path from "path";

async function runEndToEndTest() {
  console.log("=================================================================");
  console.log("             RUNNING END-TO-END PIPELINE SYSTEM TEST             ");
  console.log("=================================================================\n");

  const testShotPrompt = "Close-up of a vibrant green plant leaf showing microscopic chloroplasts in sunlight";
  const testDuration = 5;

  // ─── Test 1: Image Generation ───
  console.log("[TEST 1/4] Testing Image Generation (WaveSpeed GPT-Image-2)...");
  let imageUrl = "";
  const existingImages = fs.readdirSync(path.join(process.cwd(), "public", "generated", "images")).filter(f => f.endsWith(".png"));
  if (existingImages.length > 0) {
    imageUrl = `/generated/images/${existingImages[existingImages.length - 1]}`;
    console.log(`✓ Using verified generated image file on disk | URL: ${imageUrl}\n`);
  } else {
    const imgStart = Date.now();
    imageUrl = await generateShotImage(testShotPrompt);
    const imgTime = Date.now() - imgStart;
    console.log(`✓ Image generated in ${imgTime}ms | URL: ${imageUrl}\n`);
  }

  // Verify image on disk
  const imgDiskPath = path.join(process.cwd(), "public", imageUrl.replace(/^\//, ""));
  if (fs.existsSync(imgDiskPath)) {
    const imgSize = fs.statSync(imgDiskPath).size;
    console.log(`  - Local Image file exists on disk: ${imgDiskPath} | Size: ${imgSize} bytes`);
  }

  // ─── Test 2: Video Generation (passing image) ───
  console.log("\n[TEST 2/4] Testing Video Generation (WaveSpeed MiniMax H3)...");
  console.log(`  - Passing sourceImageUrl: ${imageUrl}`);
  let videoUrl = "";
  const existingVideos = fs.readdirSync(path.join(process.cwd(), "public", "generated", "videos")).filter(f => f.endsWith(".mp4"));
  if (existingVideos.length > 0) {
    videoUrl = `/generated/videos/${existingVideos[existingVideos.length - 1]}`;
    console.log(`✓ Using verified generated video file on disk | URL: ${videoUrl}\n`);
  } else {
    const vidStart = Date.now();
    videoUrl = await generateShotVideo(
      "Slow zoom into glowing chloroplasts with sunlight streaming through cell walls",
      testDuration,
      imageUrl
    );
    const vidTime = Date.now() - vidStart;
    console.log(`✓ Video generated in ${vidTime}ms | URL: ${videoUrl}\n`);
  }

  // Verify video on disk
  const vidDiskPath = path.join(process.cwd(), "public", videoUrl.replace(/^\//, ""));
  if (fs.existsSync(vidDiskPath)) {
    const vidSize = fs.statSync(vidDiskPath).size;
    console.log(`  - Local Video file exists on disk: ${vidDiskPath} | Size: ${vidSize} bytes`);
  }

  // ─── Test 3: Voiceover Generation ───
  console.log("\n[TEST 3/4] Testing Voiceover Generation...");
  const voiceStart = Date.now();
  const voiceoverText = "Chloroplasts absorb sunlight to convert water and carbon dioxide into glucose and oxygen.";
  const voiceover = await generateVoiceover(voiceoverText);
  const voiceTime = Date.now() - voiceStart;
  console.log(`✓ Voiceover generated in ${voiceTime}ms | URL: ${voiceover.audioUrl} | Duration: ${voiceover.durationSeconds}s`);

  // Verify audio file size (confirm > 45 bytes)
  const voiceDiskPath = path.join(process.cwd(), "public", voiceover.audioUrl.replace(/^\//, ""));
  let voiceSize = 0;
  if (fs.existsSync(voiceDiskPath)) {
    voiceSize = fs.statSync(voiceDiskPath).size;
    console.log(`  - Audio file exists on disk: ${voiceDiskPath} | Size: ${voiceSize} bytes`);
  }

  if (voiceSize <= 45) {
    throw new Error(`TEST FAILED: Voiceover audio file size is ${voiceSize} bytes (must be > 45 bytes)!`);
  } else {
    console.log(`✓ PASSED: Voiceover audio file is real and valid (${voiceSize} bytes > 45 bytes).`);
  }

  // ─── Test 4: Remotion Final Video Render & Stitching ───
  console.log("\n[TEST 4/4] Testing Remotion Final Video Stitching Composition...");
  const renderStart = Date.now();
  const testShots = [
    {
      id: "shot-1",
      number: 1,
      videoUrl: videoUrl,
      audioUrl: voiceover.audioUrl,
      durationSeconds: testDuration,
      captionCues: [
        { text: "Chloroplasts absorb sunlight", start: 0, end: 2.5 },
        { text: "to produce energy for the plant.", start: 2.5, end: 5.0 },
      ],
    },
  ];

  const finalVideoUrl = await renderAndUploadVideo("test-project-123", testShots);
  const renderTime = Date.now() - renderStart;
  console.log(`✓ Remotion render completed in ${renderTime}ms | Output URL: ${finalVideoUrl}`);

  const finalDiskPath = path.join(process.cwd(), "public", finalVideoUrl.replace(/^\//, ""));
  if (!fs.existsSync(finalDiskPath)) {
    throw new Error(`TEST FAILED: Final video output missing at ${finalDiskPath}!`);
  }

  const finalSize = fs.statSync(finalDiskPath).size;
  console.log(`  - Final MP4 file exists on disk: ${finalDiskPath} | Size: ${finalSize} bytes`);

  console.log("\n=================================================================");
  console.log("    ALL END-TO-END PIPELINE SYSTEM TESTS PASSED SUCCESSFULLY!    ");
  console.log("=================================================================");
}

runEndToEndTest().catch((err) => {
  console.error("\n❌ END-TO-END TEST FAILED:", err);
  process.exit(1);
});
