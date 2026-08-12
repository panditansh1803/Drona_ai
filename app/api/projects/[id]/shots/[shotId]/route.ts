import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { regenerateShotPrompts } from "@/src/lib/ai-clients/llm";
import type { StyleBible } from "@/src/types/project";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  try {
    const { id, shotId } = await params;
    const { text, feedback } = await request.json();

    if (typeof text !== "string") {
      return NextResponse.json(
        { error: "Text string is required" },
        { status: 400 }
      );
    }

    const project = await prisma.project.findUnique({
      where: { project_id: id },
    });

    const analysisObj = (project?.analysis as { style_bible?: StyleBible; styleBible?: StyleBible }) || {};
    const styleBible: StyleBible = analysisObj.style_bible || analysisObj.styleBible || {
      visual_style: "Clean 2D vector illustration, soft shadows",
      color_palette: "Warm amber, deep slate blue, crisp white",
      tone: "Clear, engaging, museum-exhibit curiosity",
      recurring_motifs: "minimalist geometric frames",
    };

    let imagePrompt = text;
    let videoPrompt = "slow push in";

    try {
      const regenerated = await regenerateShotPrompts(styleBible, text, feedback);
      imagePrompt = regenerated.imagePrompt;
      videoPrompt = regenerated.videoPrompt;
    } catch (err) {
      console.warn("[PATCH Shot] Prompt regeneration warning, using text fallback:", err);
    }

    const updatedShot = await prisma.shot.update({
      where: {
        shot_id: shotId,
        project_id: id,
      },
      data: {
        text,
        voiceover_prompt: text,
        image_prompt: imagePrompt,
        video_prompt: videoPrompt,
      },
    });

    return NextResponse.json({ shot: updatedShot });
  } catch (error) {
    console.error("[PATCH /api/projects/[id]/shots/[shotId]] Error:", error);
    return NextResponse.json(
      { error: "Failed to update shot text" },
      { status: 500 }
    );
  }
}
