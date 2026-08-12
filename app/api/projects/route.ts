import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { inngest } from "@/src/inngest/client";
import { verifyTopic } from "@/src/lib/ai-clients/llm";

export async function POST(request: Request) {
  try {
    const { topic, description } = await request.json();

    if (!topic || !description) {
      return NextResponse.json(
        { error: "Topic and description are required" },
        { status: 400 }
      );
    }

    // 1. Perform immediate pedagogical verification analysis via Claude
    let verification;
    try {
      verification = await verifyTopic(topic, description);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[POST /api/projects] verifyTopic failed:", errMsg);
      return NextResponse.json(
        { error: `LLM Analysis Error: ${errMsg}` },
        { status: 500 }
      );
    }

    const analysisData = {
      accurate: verification.accurate,
      report: verification.report,
      suggestions: verification.suggestions,
      style_bible: verification.styleBible,
    };

    // 2. Persist project and analysis report to SQLite (storing topic_name and description)
    const project = await prisma.project.create({
      data: {
        topic_name: topic,
        description: description,
        status: "AWAITING_APPROVAL",
        analysis: JSON.stringify(analysisData),
      },
    });

    // 3. Dispatch Inngest workflow event for background step orchestration
    try {
      await inngest.send({
        name: "project/created",
        data: {
          projectId: project.project_id,
          topic,
          description,
        },
      });
    } catch (inngestErr) {
      console.warn("[POST /api/projects] Inngest event dispatch warning:", inngestErr);
    }

    return NextResponse.json({ projectId: project.project_id });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Failed to create project";
    console.error("[POST /api/projects] Error:", error);
    return NextResponse.json(
      { error: errMsg },
      { status: 500 }
    );
  }
}
