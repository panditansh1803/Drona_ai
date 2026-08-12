import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { inngest } from "@/src/inngest/client";
import { breakdownScript } from "@/src/lib/ai-clients/llm";
import type { StyleBible } from "@/src/types/project";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const project = await prisma.project.findUnique({
      where: { project_id: id },
    });

    if (project) {
      await prisma.project.update({
        where: { project_id: id },
        data: { status: "SCRIPT_GENERATION" },
      });

      const analysisObj = (project.analysis as { report?: string; style_bible?: StyleBible; styleBible?: StyleBible }) || {};
      const analysisReport = analysisObj.report || "";
      const styleBible: StyleBible = analysisObj.style_bible || analysisObj.styleBible || {
        visual_style: "Clean 2D vector illustration, soft shadows",
        color_palette: "Warm amber, deep slate blue, crisp white",
        tone: "Clear, engaging, museum-exhibit curiosity",
        recurring_motifs: "minimalist geometric frames",
      };

      try {
        const generatedShots = await breakdownScript(
          project.topic_name,
          project.topic_name,
          analysisReport,
          styleBible
        );

        await prisma.shot.deleteMany({ where: { project_id: id } });

        await Promise.all(
          generatedShots.map((s, index) =>
            prisma.shot.create({
              data: {
                project_id: id,
                number: s.number || index + 1,
                text: s.text,
                duration_seconds: s.durationSeconds,
                image_prompt: s.imagePrompt || s.text,
                video_prompt: s.videoPrompt || "slow push in",
                voiceover_prompt: s.voiceoverPrompt || s.text,
              },
            })
          )
        );

        await prisma.project.update({
          where: { project_id: id },
          data: { status: "AWAITING_SCRIPT_APPROVAL" },
        });
      } catch (err) {
        console.warn("[POST approve-topic] Script breakdown warning:", err);
      }
    }

    try {
      await inngest.send({
        name: "project/topic-approved",
        data: { projectId: id },
      });
    } catch (inngestErr) {
      console.warn("[POST approve-topic] Inngest event dispatch warning:", inngestErr);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[POST /api/projects/[id]/approve-topic] Error:", error);
    return NextResponse.json(
      { error: "Failed to approve topic" },
      { status: 500 }
    );
  }
}
