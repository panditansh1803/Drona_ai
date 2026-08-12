import { NextResponse } from "next/server";
import { inngest } from "@/src/inngest/client";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await inngest.send({
      name: "project/render-requested",
      data: { projectId: id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[POST /api/projects/[id]/render] Error:", error);
    return NextResponse.json(
      { error: "Failed to request render" },
      { status: 500 }
    );
  }
}
