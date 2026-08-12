import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { inngest } from "@/src/inngest/client";
import { verifyTopic } from "@/src/lib/ai-clients/llm";
import type { Prisma } from "@prisma/client";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { feedback } = await request.json();

    const project = await prisma.project.findUnique({
      where: { project_id: id },
    });

    if (project && feedback) {
      try {
        const fullContext = project.description
          ? `${project.description}\nFeedback for revision: ${feedback}`
          : `Feedback for revision: ${feedback}`;

        const reVerification = await verifyTopic(
          project.topic_name,
          fullContext
        );

        await prisma.project.update({
          where: { project_id: id },
          data: {
            status: "AWAITING_APPROVAL",
            analysis: {
              accurate: reVerification.accurate,
              report: reVerification.report,
              suggestions: reVerification.suggestions,
              style_bible: reVerification.styleBible,
            } as unknown as Prisma.JsonObject,
          },
        });
      } catch (err) {
        console.warn("[POST reject-topic] Re-verification warning:", err);
      }
    }

    try {
      await inngest.send({
        name: "project/topic-rejected",
        data: {
          projectId: id,
          feedback: feedback || "",
        },
      });
    } catch (inngestErr) {
      console.warn("[POST reject-topic] Inngest event dispatch warning:", inngestErr);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[POST /api/projects/[id]/reject-topic] Error:", error);
    return NextResponse.json(
      { error: "Failed to reject topic" },
      { status: 500 }
    );
  }
}
