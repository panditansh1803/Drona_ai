import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const project = await prisma.project.findUnique({
      where: { project_id: id },
      include: {
        shots: {
          orderBy: { number: "asc" },
        },
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    let parsedAnalysis = null;
    if (project.analysis) {
      try {
        parsedAnalysis = typeof project.analysis === "string" ? JSON.parse(project.analysis) : project.analysis;
      } catch (e) {
        console.warn("[GET Project] Failed to parse analysis JSON string:", e);
      }
    }

    const projectWithParsedAnalysis = {
      ...project,
      analysis: parsedAnalysis,
    };

    return NextResponse.json({ project: projectWithParsedAnalysis });
  } catch (error) {
    console.error("[GET /api/projects/[id]] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch project" },
      { status: 500 }
    );
  }
}
