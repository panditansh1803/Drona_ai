import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { breakdownScript, verifyTopic } from "../src/lib/ai-clients/llm";

async function testBreakdownScript() {
  console.log("=================================================================");
  console.log("      TESTING BREAKDOWN SCRIPT DURATION & SHOT-COUNT RULES       ");
  console.log("=================================================================\n");

  // ─── Test Topic 1: A concise topic (Newton's Third Law) ───
  const topic1 = "Newton's Third Law of Motion";
  const desc1 = "For every action, there is an equal and opposite reaction explained with a rocket launch";

  console.log(`[TEST 1/2] Testing Topic: "${topic1}"`);
  console.log("1. Running verifyTopic to get pedagogical Style Bible...");
  const verification1 = await verifyTopic(topic1, desc1);
  console.log("✓ Style Bible generated:", verification1.styleBible.visualStyle);

  console.log("2. Running breakdownScript...");
  const shots1 = await breakdownScript(
    topic1,
    desc1,
    verification1.report,
    {
      visual_style: verification1.styleBible.visualStyle,
      color_palette: verification1.styleBible.colorPalette,
      tone: verification1.styleBible.tone,
      recurring_motifs: verification1.styleBible.recurringMotifs,
    }
  );

  const totalDuration1 = shots1.reduce((sum, s) => sum + s.durationSeconds, 0);
  console.log(`✓ Generated ${shots1.length} shots. Total duration: ${totalDuration1}s (Budget limit: 40s)`);
  shots1.forEach((s) => {
    const wordCount = s.text.trim().split(/\s+/).length;
    console.log(`   - Shot ${s.number} (${s.durationSeconds}s | ${wordCount} words): "${s.text}"`);
  });

  if (totalDuration1 > 40) {
    throw new Error(`TEST 1 FAILED: Total duration ${totalDuration1}s exceeds 40s limit!`);
  }
  console.log(`✓ PASSED: Total duration ${totalDuration1}s is <= 40s.\n`);

  // ─── Test Topic 2: A more nuanced topic (CRISPR Gene Editing) ───
  const topic2 = "CRISPR-Cas9 Gene Editing";
  const desc2 = "How the Cas9 molecular scissors find matching DNA guide RNA and cut targeted sequences";

  console.log(`[TEST 2/2] Testing Topic: "${topic2}"`);
  console.log("1. Running verifyTopic to get pedagogical Style Bible...");
  const verification2 = await verifyTopic(topic2, desc2);
  console.log("✓ Style Bible generated:", verification2.styleBible.visualStyle);

  console.log("2. Running breakdownScript...");
  const shots2 = await breakdownScript(
    topic2,
    desc2,
    verification2.report,
    {
      visual_style: verification2.styleBible.visualStyle,
      color_palette: verification2.styleBible.colorPalette,
      tone: verification2.styleBible.tone,
      recurring_motifs: verification2.styleBible.recurringMotifs,
    }
  );

  const totalDuration2 = shots2.reduce((sum, s) => sum + s.durationSeconds, 0);
  console.log(`✓ Generated ${shots2.length} shots. Total duration: ${totalDuration2}s (Budget limit: 40s)`);
  shots2.forEach((s) => {
    const wordCount = s.text.trim().split(/\s+/).length;
    console.log(`   - Shot ${s.number} (${s.durationSeconds}s | ${wordCount} words): "${s.text}"`);
  });

  // ─── Test 3: Zod Schema Rejection Test for > 40s ───
  console.log("[TEST 3/3] Testing Zod Schema Validation (rejection of total duration > 40s)...");
  const { BreakdownScriptZodSchema } = await import("../src/lib/ai-clients/llm");

  const invalidOver40Payload = {
    shots: [
      {
        number: 1,
        duration_seconds: 15,
        narration: "Shot 1 narration",
        image_prompt: "Shot 1 image",
        video_prompt: "Shot 1 video",
      },
      {
        number: 2,
        duration_seconds: 15,
        narration: "Shot 2 narration",
        image_prompt: "Shot 2 image",
        video_prompt: "Shot 2 video",
      },
      {
        number: 3,
        duration_seconds: 15,
        narration: "Shot 3 narration",
        image_prompt: "Shot 3 image",
        video_prompt: "Shot 3 video",
      },
    ], // total = 45s > 40s
  };

  const zodResult = BreakdownScriptZodSchema.safeParse(invalidOver40Payload);
  if (zodResult.success) {
    throw new Error("TEST 3 FAILED: Zod schema should have rejected payload with total duration 45s (> 40s)!");
  }
  console.log(`✓ PASSED: Zod schema correctly rejected 45s payload with error: "${zodResult.error.issues[0]?.message}"\n`);

  console.log("=================================================================");
  console.log("    ALL BREAKDOWN SCRIPT DURATION TESTS PASSED SUCCESSFULLY!     ");
  console.log("=================================================================");
}

testBreakdownScript().catch((err) => {
  console.error("❌ TEST FAILED:", err);
  process.exit(1);
});
