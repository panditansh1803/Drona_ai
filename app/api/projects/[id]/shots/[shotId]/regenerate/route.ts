import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import {
  generateShotImage,
  generateShotVideo,
  generateVoiceover,
} from "@/src/lib/ai-clients";
import { matchVideoDuration, buildCaptionCues } from "@/src/lib/sync/align-shot";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  try {
    const { id, shotId } = await params;
    const { assetType } = (await request.json()) as {
      assetType: "image" | "video" | "voiceover";
    };

    if (!["image", "video", "voiceover"].includes(assetType)) {
      return NextResponse.json(
        { error: "Invalid assetType. Must be 'image', 'video', or 'voiceover'" },
        { status: 400 }
      );
    }

    const shot = await prisma.shot.findUnique({
      where: { shot_id: shotId, project_id: id },
    });

    if (!shot) {
      return NextResponse.json({ error: "Shot not found" }, { status: 404 });
    }

    if (assetType === "image") {
      const prompt = shot.image_prompt || shot.text;
      const imageUrl = await generateShotImage(prompt);

      const updated = await prisma.shot.update({
        where: { shot_id: shotId },
        data: { generated_image_url: imageUrl },
      });

      return NextResponse.json({ shot: updated });
    }

    if (assetType === "video") {
      const prompt = shot.video_prompt || shot.text;
      const targetDuration = shot.voiceover_duration_seconds || shot.duration_seconds;
      const rawVideoUrl = await generateShotVideo(prompt, shot.duration_seconds);
      const alignedVideoUrl = await matchVideoDuration(
        rawVideoUrl,
        targetDuration,
        shot.duration_seconds
      );

      const updated = await prisma.shot.update({
        where: { shot_id: shotId },
        data: { generated_video_url: alignedVideoUrl },
      });

      return NextResponse.json({ shot: updated });
    }

    if (assetType === "voiceover") {
      const prompt = shot.voiceover_prompt || shot.text;
      const voiceover = await generateVoiceover(prompt);

      let alignedVideoUrl = shot.generated_video_url;
      if (shot.generated_video_url) {
        alignedVideoUrl = await matchVideoDuration(
          shot.generated_video_url,
          voiceover.durationSeconds,
          shot.duration_seconds
        );
      }

      const captionCues = buildCaptionCues(voiceover.wordTimestamps);

      const updated = await prisma.shot.update({
        where: { shot_id: shotId },
        data: {
          generated_voiceover_url: voiceover.audioUrl,
          voiceover_duration_seconds: voiceover.durationSeconds,
          word_timestamps: JSON.stringify(voiceover.wordTimestamps),
          caption_cues: JSON.stringify(captionCues),
          generated_video_url: alignedVideoUrl,
        },
      });

      return NextResponse.json({ shot: updated });
    }

    return NextResponse.json({ error: "Unknown assetType" }, { status: 400 });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Failed to regenerate asset";
    console.error("[POST /api/projects/[id]/shots/[shotId]/regenerate] Error:", error);
    return NextResponse.json(
      { error: errMsg },
      { status: 500 }
    );
  }
}
