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

    // 3. Generate shot assets for each shot in project
    for (const shot of project.shots) {
      try {
        console.log(`[approve-script] Generating assets for Shot #${shot.number}...`);

        // a. Generate voiceover and image concurrently
        const [voiceover, imageUrl] = await Promise.all([
          generateVoiceover(shot.text),
          generateShotImage(shot.image_prompt || shot.text),
        ]);

        // b. Generate video using the generated image
        const rawVideoUrl = await generateShotVideo(
          shot.video_prompt || "Slow motion movement",
          shot.duration_seconds,
          imageUrl
        );

        // c. Match video duration to voiceover duration
        const alignedVideoUrl = await matchVideoDuration(
          rawVideoUrl,
          voiceover.durationSeconds,
          shot.duration_seconds
        );

        // d. Build caption cues from word timestamps
        const captionCues = buildCaptionCues(voiceover.wordTimestamps);

        // e. Save all generated assets to database for this shot
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

        console.log(`[approve-script] Shot #${shot.number} assets generated successfully!`);
      } catch (shotErr) {
        console.error(`[approve-script] Error generating assets for Shot #${shot.number}:`, shotErr);
      }
    }

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
