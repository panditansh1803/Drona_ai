import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { inngest } from "@/src/inngest/client";
import {
  generateShotImage,
  generateShotVideo,
  generateVoiceover,
} from "@/src/lib/ai-clients";
import { matchVideoDuration, buildCaptionCues } from "@/src/lib/sync/align-shot";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const project = await prisma.project.findUnique({
      where: { project_id: id },
      include: { shots: { orderBy: { number: "asc" } } },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 1. Update project status to ASSET_GENERATION_IN_PROGRESS
    await prisma.project.update({
      where: { project_id: id },
      data: { status: "ASSET_GENERATION_IN_PROGRESS" },
    });

    // 2. Try sending Inngest event (non-blocking)
    try {
      await inngest.send({
        name: "project/script-approved",
        data: { projectId: id },
      });
    } catch (inngestErr) {
      console.warn("[approve-script] Inngest dispatch warning:", inngestErr);
    }

    // 3. Generate all shot assets in PARALLEL — not sequentially.
    //    Each shot independently generates voiceover + image (concurrently),
    //    then video, then saves to DB.
    console.log(`[approve-script] Starting parallel asset generation for ${project.shots.length} shots...`);
    const startTime = Date.now();

    await Promise.all(
      project.shots.map(async (shot) => {
        try {
          console.log(`[approve-script] Shot #${shot.number} starting...`);

          // a. Voiceover + image concurrently
          const [voiceover, imageUrl] = await Promise.all([
            generateVoiceover(shot.text),
            generateShotImage(shot.image_prompt || shot.text),
          ]);

          // b. Video (uses generated image as source)
          const rawVideoUrl = await generateShotVideo(
            shot.video_prompt || "Slow motion movement",
            shot.duration_seconds,
            imageUrl
          );

          // c. Duration alignment
          const alignedVideoUrl = await matchVideoDuration(
            rawVideoUrl,
            voiceover.durationSeconds,
            shot.duration_seconds
          );

          // d. Caption cues
          const captionCues = buildCaptionCues(voiceover.wordTimestamps);

          // e. Persist
          await prisma.shot.update({
            where: { shot_id: shot.shot_id },
            data: {
              generated_image_url: imageUrl,
              generated_video_url: alignedVideoUrl,
              generated_voiceover_url: voiceover.audioUrl,
              voiceover_duration_seconds: voiceover.durationSeconds,
              word_timestamps: JSON.stringify(voiceover.wordTimestamps),
              caption_cues: JSON.stringify(captionCues),
            },
          });

          console.log(`[approve-script] Shot #${shot.number} done.`);
        } catch (shotErr) {
          console.error(`[approve-script] Shot #${shot.number} error:`, shotErr);
        }
      })
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[approve-script] All ${project.shots.length} shots generated in ${elapsed}s.`);

    // 4. Update project status to READY_FOR_REVIEW
    await prisma.project.update({
      where: { project_id: id },
      data: { status: "READY_FOR_REVIEW" },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Failed to approve script";
    console.error("[POST /api/projects/[id]/approve-script] Error:", error);
    return NextResponse.json(
      { error: errMsg },
      { status: 500 }
    );
  }
}
