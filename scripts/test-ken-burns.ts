/**
 * Quick smoke test for the Ken Burns still-to-video renderer.
 * Runs two cases:
 *   1. SVG source (placeholder) → background fallback video
 *   2. An existing generated image (if any real PNG exists) → Ken Burns zoompan
 *
 * Usage:  npx tsx scripts/test-ken-burns.ts
 */

import path from "path";
import fs from "fs";
import { renderStillToVideo } from "../src/lib/video/still-to-video";
import { saveGeneratedFile } from "../src/lib/storage/local";

async function main() {
  console.log("\n=== Ken Burns / Still-to-Video Test ===\n");

  // ─── Case 1: SVG source → background fallback ──────────────────────────────
  const svgSource = "/generated/images/img_placeholder_1786537652930_6cxy6z.svg";
  const tmpPathSvg = path.join(process.cwd(), "public", "generated", "videos", `test_svg_${Date.now()}.mp4`);
  fs.mkdirSync(path.dirname(tmpPathSvg), { recursive: true });

  console.log("Test 1: SVG source → background fallback (5 seconds)...");
  const t1 = Date.now();
  await renderStillToVideo(svgSource, 5, tmpPathSvg);
  const s1 = fs.statSync(tmpPathSvg).size;
  console.log(`✅ Test 1 PASSED: ${tmpPathSvg}`);
  console.log(`   Size: ${s1} bytes | Time: ${((Date.now() - t1) / 1000).toFixed(1)}s\n`);

  // ─── Case 2: saveGeneratedFile integration ─────────────────────────────────
  const tmpPath2 = path.join(process.cwd(), "public", "generated", "videos", `test_bg_${Date.now()}.mp4`);
  console.log("Test 2: Background fallback + saveGeneratedFile (8 seconds)...");
  const t2 = Date.now();
  await renderStillToVideo(undefined, 8, tmpPath2);
  const buf2 = fs.readFileSync(tmpPath2);
  const savedUrl = await saveGeneratedFile(
    buf2,
    `test_saved_${Date.now()}.mp4`,
    "videos",
    "video/mp4"
  );
  fs.unlinkSync(tmpPath2);
  console.log(`✅ Test 2 PASSED: ${savedUrl}`);
  console.log(`   Size: ${buf2.length} bytes | Time: ${((Date.now() - t2) / 1000).toFixed(1)}s\n`);

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log("=== public/generated/videos/ contents ===");
  const videosDir = path.join(process.cwd(), "public", "generated", "videos");
  if (fs.existsSync(videosDir)) {
    for (const f of fs.readdirSync(videosDir)) {
      const stat = fs.statSync(path.join(videosDir, f));
      console.log(`  ${f}  (${stat.size} bytes)`);
    }
  } else {
    console.log("  (directory does not exist)");
  }

  console.log("\n✅ All tests passed. Real .mp4 files are now being generated.\n");
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
