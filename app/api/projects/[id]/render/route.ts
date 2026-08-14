import { NextResponse } from "next/server";
import { inngest } from "@/src/inngest/client";
import { prisma } from "@/src/lib/db";
import { renderAndUploadVideo } from "@/render/renderer";
import { ensureFfmpegAvailable } from "@/src/lib/video/ffmpeg-check";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const project = await prisma.project.findUnique({
      where: { project_id: id },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 1. Startup pre-flight check: verify FFmpeg is resolvable on system PATH
    try {
      ensureFfmpegAvailable();
    } catch (ffmpegErr) {
      const errMsg =
        ffmpegErr instanceof Error
          ? ffmpegErr.message
          : "FFmpeg is not installed or not found on system PATH.";

      console.error(`[POST /api/projects/[id]/render] Startup check failed: ${errMsg}`);

      let analysisObj: Record<string, unknown> = {};
      if (project.analysis) {
        try {
          analysisObj =
            typeof project.analysis === "string"
              ? JSON.parse(project.analysis)
              : project.analysis;
        } catch {
          /* ignore JSON parse */
        }
      }
      analysisObj.render_error = errMsg;

      await prisma.project.update({
        where: { project_id: id },
        data: {
          status: "FAILED",
          final_video_url: null,
          analysis: JSON.stringify(analysisObj),
        },
      });

      return NextResponse.json({ error: errMsg }, { status: 400 });
    }

    // 2. Send event to Inngest queue (best-effort)
    try {
      await inngest.send({
        name: "project/render-requested",
        data: { projectId: id },
      });
    } catch (inngestErr) {
      console.warn("[POST /api/projects/[id]/render] Inngest dispatch warning:", inngestErr);
    }

    // 3. Clear previous render error and set status to RENDERING in DB
    let currentAnalysis: Record<string, unknown> = {};
    if (project.analysis) {
      try {
        currentAnalysis =
          typeof project.analysis === "string"
            ? JSON.parse(project.analysis)
            : project.analysis;
      } catch {
        /* ignore */
      }
    }
    delete currentAnalysis.render_error;

    await prisma.project.update({
      where: { project_id: id },
      data: {
        status: "RENDERING",
        final_video_url: null,
        analysis: JSON.stringify(currentAnalysis),
      },
    });

    // 4. Execute Remotion render in background
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

        // Fetch fresh analysis to avoid overwriting concurrent updates
        const freshProject = await prisma.project.findUnique({
          where: { project_id: id },
        });
        let freshAnalysis: Record<string, unknown> = {};
        if (freshProject?.analysis) {
          try {
            freshAnalysis =
              typeof freshProject.analysis === "string"
                ? JSON.parse(freshProject.analysis)
                : freshProject.analysis;
          } catch {
            /* ignore */
          }
        }
        delete freshAnalysis.render_error;

        await prisma.project.update({
          where: { project_id: id },
          data: {
            status: "COMPLETE",
            final_video_url: finalVideoUrl,
            analysis: JSON.stringify(freshAnalysis),
          },
        });
        console.log(`[Direct Render] Remotion render COMPLETED for project ${id}. Final Video URL: ${finalVideoUrl}`);
      } catch (renderErr) {
        const errorMsg =
          renderErr instanceof Error ? renderErr.message : String(renderErr);
        console.error(`[Direct Render] Remotion render FAILED for project ${id}:`, renderErr);

        const freshProject = await prisma.project.findUnique({
          where: { project_id: id },
        });
        let freshAnalysis: Record<string, unknown> = {};
        if (freshProject?.analysis) {
          try {
            freshAnalysis =
              typeof freshProject.analysis === "string"
                ? JSON.parse(freshProject.analysis)
                : freshProject.analysis;
          } catch {
            /* ignore */
          }
        }
        freshAnalysis.render_error = errorMsg;

        await prisma.project.update({
          where: { project_id: id },
          data: {
            status: "FAILED",
            final_video_url: null,
            analysis: JSON.stringify(freshAnalysis),
          },
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
