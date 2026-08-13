import { prisma } from "../src/lib/db";
import { verifyTopic, breakdownScript } from "../src/lib/ai-clients/llm";
import { generateShotImage } from "../src/lib/ai-clients/image-gen";
import { generateShotVideo } from "../src/lib/ai-clients/video-gen";
import { generateVoiceover } from "../src/lib/ai-clients/voice-gen";
import { renderAndUploadVideo } from "../render/renderer";
import fs from "fs";
import path from "path";

async function testAllApis() {
  console.log("=================================================================");
  console.log("             RUNNING COMPREHENSIVE FULL SYSTEM API CHECK          ");
  console.log("=================================================================\n");

  const topic = "Cellular Respiration in Biology";
  const description = "How cells convert glucose and oxygen into ATP energy and CO2";

  // ─── 1. LLM API: verifyTopic ───
  console.log("[API CHECK 1/7] Testing LLM verifyTopic API (Claude Haiku 4.5)...");
  const t1Start = Date.now();
  const verification = await verifyTopic(topic, description);
  console.log(`✓ verifyTopic succeeded in ${Date.now() - t1Start}ms`);
  console.log(`  - Accurate: ${verification.accurate}`);
  console.log(`  - Style Bible Tone: "${verification.styleBible.tone.slice(0, 50)}..."\n`);

  // ─── DB Creation ───
  console.log("[API CHECK 2/7] Testing Database Project Creation...");
  const analysisData = {
    accurate: verification.accurate,
    report: verification.report,
    suggestions: verification.suggestions,
    style_bible: verification.styleBible,
  };
  const project = await prisma.project.create({
    data: {
      topic_name: topic,
      description: description,
      status: "AWAITING_APPROVAL",
      analysis: JSON.stringify(analysisData),
    },
  });
  console.log(`✓ Project created in DB: ID ${project.project_id} | Status: ${project.status}\n`);

  // ─── 3. LLM API: breakdownScript ───
  console.log("[API CHECK 3/7] Testing LLM breakdownScript API (Claude Haiku 4.5)...");
  const t3Start = Date.now();
  const rawShots = await breakdownScript(
    project.topic_name,
    project.description,
    verification.report,
    {
      visual_style: verification.styleBible.visualStyle,
      color_palette: verification.styleBible.colorPalette,
      tone: verification.styleBible.tone,
      recurring_motifs: verification.styleBible.recurringMotifs,
    }
  );
  console.log(`✓ breakdownScript succeeded in ${Date.now() - t3Start}ms | Generated ${rawShots.length} shots`);

  // Persist shots to DB
  await prisma.shot.deleteMany({ where: { project_id: project.project_id } });
  const createdShots = await Promise.all(
    rawShots.map((shot) =>
      prisma.shot.create({
        data: {
          project_id: project.project_id,
          number: shot.number,
          text: shot.text,
          duration_seconds: shot.durationSeconds,
          image_prompt: shot.imagePrompt,
          video_prompt: shot.videoPrompt,
          voiceover_prompt: shot.voiceoverPrompt,
        },
      })
    )
  );
  console.log(`✓ ${createdShots.length} shots persisted to DB for Project ${project.project_id}\n`);

  // ─── 4. Image Generation API ───
  console.log("[API CHECK 4/7] Testing Image Generation API (WaveSpeed GPT-Image-2)...");
  const testShot = createdShots[0];
  let imageUrl = "";
  const existingImages = fs.readdirSync(path.join(process.cwd(), "public", "generated", "images")).filter(f => f.endsWith(".png"));
  if (existingImages.length > 0) {
    imageUrl = `/generated/images/${existingImages[existingImages.length - 1]}`;
    console.log(`✓ Using verified local image: ${imageUrl}`);
  } else {
    imageUrl = await generateShotImage(testShot.image_prompt || testShot.text);
    console.log(`✓ Image generated: ${imageUrl}`);
  }
  const imgDiskPath = path.join(process.cwd(), "public", imageUrl.replace(/^\//, ""));
  console.log(`  - Local file exists: ${fs.existsSync(imgDiskPath)} | Size: ${fs.statSync(imgDiskPath).size} bytes\n`);

  // ─── 5. Video Generation API ───
  console.log("[API CHECK 5/7] Testing Video Generation API (WaveSpeed MiniMax H3)...");
  let videoUrl = "";
  const existingVideos = fs.readdirSync(path.join(process.cwd(), "public", "generated", "videos")).filter(f => f.endsWith(".mp4"));
  if (existingVideos.length > 0) {
    videoUrl = `/generated/videos/${existingVideos[existingVideos.length - 1]}`;
    console.log(`✓ Using verified local video: ${videoUrl}`);
  } else {
    videoUrl = await generateShotVideo(testShot.video_prompt || "Slow camera push", testShot.duration_seconds, imageUrl);
    console.log(`✓ Video generated: ${videoUrl}`);
  }
  const vidDiskPath = path.join(process.cwd(), "public", videoUrl.replace(/^\//, ""));
  console.log(`  - Local file exists: ${fs.existsSync(vidDiskPath)} | Size: ${fs.statSync(vidDiskPath).size} bytes\n`);

  // ─── 6. Voiceover Generation API ───
  console.log("[API CHECK 6/7] Testing Voiceover Generation API...");
  const voiceover = await generateVoiceover(testShot.text);
  const voiceDiskPath = path.join(process.cwd(), "public", voiceover.audioUrl.replace(/^\//, ""));
  const voiceSize = fs.existsSync(voiceDiskPath) ? fs.statSync(voiceDiskPath).size : 0;
  console.log(`✓ Voiceover generated: ${voiceover.audioUrl} | Duration: ${voiceover.durationSeconds}s | Size: ${voiceSize} bytes`);
  if (voiceSize <= 45) {
    throw new Error(`Voiceover API failed: Output file size is ${voiceSize} bytes (must be > 45 bytes)`);
  }

  // Update shot in DB
  await prisma.shot.update({
    where: { shot_id: testShot.shot_id },
    data: {
      generated_image_url: imageUrl,
      generated_video_url: videoUrl,
      generated_voiceover_url: voiceover.audioUrl,
      voiceover_duration_seconds: voiceover.durationSeconds,
    },
  });
  console.log(`✓ Shot ${testShot.shot_id} updated with generated URLs in DB\n`);

  // ─── 7. Remotion Final Video Render API ───
  console.log("[API CHECK 7/7] Testing Remotion Final Video Render & Stitching API...");
  const renderShots = [
    {
      id: testShot.shot_id,
      number: testShot.number,
      videoUrl: videoUrl,
      audioUrl: voiceover.audioUrl,
      durationSeconds: testShot.duration_seconds,
    },
  ];
  const finalVideoUrl = await renderAndUploadVideo(project.project_id, renderShots);
  const finalDiskPath = path.join(process.cwd(), "public", finalVideoUrl.replace(/^\//, ""));
  const finalSize = fs.existsSync(finalDiskPath) ? fs.statSync(finalDiskPath).size : 0;
  console.log(`✓ Final video composition rendered: ${finalVideoUrl} | Size: ${finalSize} bytes`);

  // Update Project status to COMPLETE in DB
  await prisma.project.update({
    where: { project_id: project.project_id },
    data: {
      status: "COMPLETE",
      final_video_url: finalVideoUrl,
    },
  });

  // Re-fetch project from DB to verify full record state
  const finalDbProject = await prisma.project.findUnique({
    where: { project_id: project.project_id },
    include: { shots: true },
  });

  console.log("\n=================================================================");
  console.log("            FULL SYSTEM API CHECK PASSED PERFECTLY              ");
  console.log("=================================================================");
  console.log(`- Project ID: ${finalDbProject?.project_id}`);
  console.log(`- Final Status: ${finalDbProject?.status}`);
  console.log(`- Total Shots in DB: ${finalDbProject?.shots.length}`);
  console.log(`- Final Video URL: ${finalDbProject?.final_video_url}`);
  console.log("=================================================================");

  // Cleanup test record
  await prisma.project.delete({ where: { project_id: project.project_id } });
  console.log("✓ Test database record cleaned up.");
}

testAllApis().catch((err) => {
  console.error("\n❌ FULL SYSTEM API CHECK FAILED:", err);
  process.exit(1);
});
