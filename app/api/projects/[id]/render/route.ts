import { NextResponse } from "next/server";
import { inngest } from "@/src/inngest/client";
import { prisma } from "@/src/lib/db";
import { renderAndUploadVideo } from "@/render/renderer";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Send event to Inngest queue
    try {
      await inngest.send({
        name: "project/render-requested",
        data: { projectId: id },
      });
    } catch (inngestErr) {
      console.warn("[POST /api/projects/[id]/render] Inngest dispatch warning:", inngestErr);
    }

    // Set status to RENDERING in DB immediately
    await prisma.project.update({
      where: { project_id: id },
      data: { status: "RENDERING" },
    });

    // Execute Remotion render in background (ensures local dev renders seamlessly even if Inngest CLI is not running)
    (async () => {
      try {
        console.log(`[Direct Render] Starting Remotion render for project ${id}...`);
        const shots = await prisma.shot.findMany({
          where: { project_id: id },
          orderBy: { number: "asc" },
        });

        const renderShots = shots.map((s) => {
          let parsedCaptions: { text: string; start: number; end: number }[] = [];
          if (s.caption_cues && typeof s.caption_cues === "string") {
            try {
              parsedCaptions = JSON.parse(s.caption_cues);
            } catch {
              /* ignore parse error */
            }
          }
          return {
            id: s.shot_id,
            number: s.number,
            videoUrl: s.generated_video_url || "",
            audioUrl: s.generated_voiceover_url || undefined,
            durationSeconds: s.voiceover_duration_seconds || s.duration_seconds,
            captionCues: parsedCaptions,
          };
        });

        const finalVideoUrl = await renderAndUploadVideo(id, renderShots);

        await prisma.project.update({
          where: { project_id: id },
          data: {
            status: "COMPLETE",
            final_video_url: finalVideoUrl,
          },
        });
        console.log(`[Direct Render] Remotion render COMPLETED for project ${id}. Final Video URL: ${finalVideoUrl}`);
      } catch (renderErr) {
        console.error(`[Direct Render] Remotion render FAILED for project ${id}:`, renderErr);
        await prisma.project.update({
          where: { project_id: id },
          data: { status: "FAILED" },
        });
      }
    })();

    return NextResponse.json({ success: true, status: "RENDERING" });
  } catch (error) {
    console.error("[POST /api/projects/[id]/render] Error:", error);
    return NextResponse.json(
      { error: "Failed to request render" },
      { status: 500 }
    );
  }
}
