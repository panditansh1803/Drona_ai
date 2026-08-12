import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { verifyTopic, breakdownScript } from "../src/lib/ai-clients/llm";
import { generateShotImage } from "../src/lib/ai-clients/image-gen";
import { generateVoiceover } from "../src/lib/ai-clients/voice-gen";
import { generateShotVideo } from "../src/lib/ai-clients/video-gen";

async function runStandaloneTest() {
  console.log("===============================================================");
  console.log("  DRONA AI CLIENTS STANDALONE DIAGNOSTIC TEST ");
  console.log("===============================================================\n");

  const topic = "Photosynthesis";
  const description = "How plants convert sunlight, water, and carbon dioxide into glucose and oxygen";

  const overallStartTime = Date.now();

  try {
    // ─── Step 1: verifyTopic ─────────────────────────────────────────────────
    console.log("---------------------------------------------------------------");
    console.log("[STEP 1/5] Calling verifyTopic (Gemini Flash)...");
    const step1Start = Date.now();
    const verification = await verifyTopic(topic, description);
    const step1Duration = Date.now() - step1Start;

    console.log(`✓ verifyTopic COMPLETED in ${step1Duration}ms`);
    console.log("  - Factual Accuracy:", verification.accurate);
    console.log("  - Report Summary:", verification.report);
    console.log("  - Suggestions:", verification.suggestions);
    console.log("  - Style Bible:", JSON.stringify(verification.styleBible, null, 2));
    console.log("\n");

    // ─── Step 2: breakdownScript ─────────────────────────────────────────────
    console.log("---------------------------------------------------------------");
    console.log("[STEP 2/5] Calling breakdownScript (Gemini Flash)...");
    const step2Start = Date.now();

    const styleBibleForBreakdown = {
      visual_style: verification.styleBible.visualStyle,
      color_palette: verification.styleBible.colorPalette,
      tone: verification.styleBible.tone,
      recurring_motifs: verification.styleBible.recurringMotifs,
    };

    const shots = await breakdownScript(
      topic,
      description,
      verification.report,
      styleBibleForBreakdown
    );
    const step2Duration = Date.now() - step2Start;

    if (!shots || shots.length === 0) {
      throw new Error("breakdownScript returned an empty shots array");
    }

    const shot1 = shots[0];
    const imagePrompt = shot1.imagePrompt || "Vector illustration of photosynthesis";
    const voiceoverText = shot1.text || "Photosynthesis explanation";
    const videoPrompt = shot1.videoPrompt || "Slow zoom in";

    console.log(`✓ breakdownScript COMPLETED in ${step2Duration}ms`);
    console.log(`  - Total Shots Generated: ${shots.length}`);
    console.log("  - Shot 1 Preview:");
    console.log(`    * Narration: "${voiceoverText}"`);
    console.log(`    * Duration: ${shot1.durationSeconds}s`);
    console.log(`    * Image Prompt: "${imagePrompt.slice(0, 80)}..."`);
    console.log(`    * Video Prompt: "${videoPrompt}"`);
    console.log("\n");

    // ─── Step 3: generateShotImage ───────────────────────────────────────────
    console.log("---------------------------------------------------------------");
    console.log("[STEP 3/5] Calling generateShotImage for Shot 1...");
    const step3Start = Date.now();
    const imageUrl = await generateShotImage(imagePrompt);
    const step3Duration = Date.now() - step3Start;

    console.log(`✓ generateShotImage COMPLETED in ${step3Duration}ms`);
    console.log(`  - Image URL / Path: ${imageUrl}`);
    console.log("\n");

    // ─── Step 4: generateVoiceover ───────────────────────────────────────────
    console.log("---------------------------------------------------------------");
    console.log("[STEP 4/5] Calling generateVoiceover for Shot 1...");
    const step4Start = Date.now();
    const voiceover = await generateVoiceover(voiceoverText);
    const step4Duration = Date.now() - step4Start;

    console.log(`✓ generateVoiceover COMPLETED in ${step4Duration}ms`);
    console.log(`  - Audio URL: ${voiceover.audioUrl.slice(0, 40)}...`);
    console.log(`  - Voiceover Duration: ${voiceover.durationSeconds}s`);
    console.log(`  - Word Timestamps Count: ${voiceover.wordTimestamps.length}`);
    console.log("\n");

    // ─── Step 5: generateShotVideo (Placeholder / Fast Dev Mode) ──────────────
    console.log("---------------------------------------------------------------");
    console.log("[STEP 5/5] Calling generateShotVideo for Shot 1 (Placeholder Mode)...");
    const step5Start = Date.now();
    const videoUrl = await generateShotVideo(
      videoPrompt,
      shot1.durationSeconds,
      imageUrl
    );
    const step5Duration = Date.now() - step5Start;

    console.log(`✓ generateShotVideo COMPLETED in ${step5Duration}ms`);
    console.log(`  - Video URL / Path: ${videoUrl}`);
    console.log("\n");

    // ─── Overall Diagnostic Summary ──────────────────────────────────────────
    const totalDuration = Date.now() - overallStartTime;
    console.log("===============================================================");
    console.log("  DIAGNOSTIC TEST COMPLETED SUCCESSFULLY ");
    console.log("===============================================================");
    console.log(`- Step 1 (verifyTopic):       ${step1Duration}ms`);
    console.log(`- Step 2 (breakdownScript):   ${step2Duration}ms`);
    console.log(`- Step 3 (generateShotImage): ${step3Duration}ms`);
    console.log(`- Step 4 (generateVoiceover): ${step4Duration}ms`);
    console.log(`- Step 5 (generateShotVideo): ${step5Duration}ms`);
    console.log(`---------------------------------------------------------------`);
    console.log(`- TOTAL PIPELINE TIME:        ${(totalDuration / 1000).toFixed(2)}s`);
    console.log("===============================================================\n");
  } catch (error) {
    console.error("\n❌ STANDALONE DIAGNOSTIC TEST FAILED!");
    console.error(error);
    process.exit(1);
  }
}

runStandaloneTest();
