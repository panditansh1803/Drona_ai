import { inngest } from "@/src/inngest/client";
import { prisma } from "@/src/lib/db";
import {
  verifyTopic,
  breakdownScript,
  generateShotImage,
  generateShotVideo,
  generateVoiceover,
} from "@/src/lib/ai-clients";
import { matchVideoDuration, buildCaptionCues } from "@/src/lib/sync/align-shot";
import type { Prisma } from "@prisma/client";
import type { StyleBible } from "@/src/types/project";

interface ShotDataItem {
  shotId: string;
  number: number;
  text: string;
  durationSeconds: number;
  imagePrompt: string;
  videoPrompt: string;
  voiceoverPrompt: string;
}

export const generateProject = inngest.createFunction(
  {
    id: "generate-project",
    retries: 3,
    triggers: [{ event: "project/created" }],
  },
  async ({ event, step }) => {
    const { projectId, topic, description } = event.data as {
      projectId: string;
      topic: string;
      description: string;
    };

    let currentDescription = description;

    // ─── Step 1 & 2: Topic Analysis & Rejection/Approval Loop ─────────────────
    let topicApproved = false;

    while (!topicApproved) {
      await step.run("verify-topic", async () => {
        await prisma.project.update({
          where: { project_id: projectId },
          data: { status: "ANALYZING" },
        });

        const result = await verifyTopic(topic, currentDescription);

        await prisma.project.update({
          where: { project_id: projectId },
          data: {
            status: "AWAITING_APPROVAL",
            analysis: {
              accurate: result.accurate,
              report: result.report,
              suggestions: result.suggestions,
              style_bible: result.styleBible,
            } as unknown as Prisma.JsonObject,
          },
        });

        return result;
      });

      // Wait for topic-approved event (timeout 7d)
      const approvalEvent = await step.waitForEvent("wait-for-topic-approval", {
        event: "project/topic-approved",
        match: "data.projectId",
        timeout: "7d",
      });

      if (approvalEvent) {
        topicApproved = true;
      } else {
        // Check for rejection feedback if provided
        const rejectionEvent = await step.waitForEvent("wait-for-topic-rejection", {
          event: "project/topic-rejected",
          match: "data.projectId",
          timeout: "1s",
        });

        if (rejectionEvent?.data?.feedback) {
          currentDescription = `${currentDescription}\nFeedback: ${rejectionEvent.data.feedback}`;
        }
      }
    }

    // ─── Step 3: Breakdown Script ─────────────────────────────────────────────
    const shotsData: ShotDataItem[] = await step.run("breakdown-script", async () => {
      await prisma.project.update({
        where: { project_id: projectId },
        data: { status: "SCRIPT_GENERATION" },
      });

      const project = await prisma.project.findUnique({
        where: { project_id: projectId },
      });

      const analysisObj =
        (project?.analysis as { report?: string; style_bible?: StyleBible; styleBible?: StyleBible }) ||
        {};
      const analysisReport = analysisObj.report || "";
      const styleBible: StyleBible = analysisObj.style_bible || analysisObj.styleBible || {
        visual_style: "Clean 2D vector illustration, soft shadows",
        color_palette: "Warm amber, deep slate blue, crisp white",
        tone: "Clear, engaging, museum-exhibit curiosity",
        recurring_motifs: "minimalist geometric frames",
      };

      const generatedShots = await breakdownScript(
        topic,
        currentDescription,
        analysisReport,
        styleBible
      );

      // Clean up previous shots if any and create new ones
      await prisma.shot.deleteMany({ where: { project_id: projectId } });

      const createdShots = await Promise.all(
        generatedShots.map((s, index) =>
          prisma.shot.create({
            data: {
              project_id: projectId,
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
        where: { project_id: projectId },
        data: { status: "AWAITING_SCRIPT_APPROVAL" },
      });

      return createdShots.map((s) => ({
        shotId: s.shot_id,
        number: s.number,
        text: s.text,
        durationSeconds: s.duration_seconds,
        imagePrompt: s.image_prompt || s.text,
        videoPrompt: s.video_prompt || s.text,
        voiceoverPrompt: s.voiceover_prompt || s.text,
      }));
    });

    // ─── Step 4: Wait for Script Approval ─────────────────────────────────────
    await step.waitForEvent("wait-for-script-approval", {
      event: "project/script-approved",
      match: "data.projectId",
      timeout: "7d",
    });

    // ─── Step 5: Multi-modal Asset Generation ─────────────────────────────────
    await step.run("set-asset-generation-status", async () => {
      await prisma.project.update({
        where: { project_id: projectId },
        data: { status: "ASSET_GENERATION_IN_PROGRESS" },
      });
    });

    // Process every shot in parallel, each sub-step wrapped individually in step.run
    await Promise.all(
      shotsData.map(async (shot: ShotDataItem) => {
        // 1. Voiceover and Image start in parallel
        const voiceoverPromise = step.run(`generate-voiceover-${shot.shotId}`, async () => {
          return await generateVoiceover(shot.voiceoverPrompt);
        });

        const imageUrl = await step.run(`generate-image-${shot.shotId}`, async () => {
          return await generateShotImage(shot.imagePrompt);
        });

        // 2. Video starts ONLY after image completes (passing imageUrl in)
        const rawVideoUrl = await step.run(`generate-video-${shot.shotId}`, async () => {
          return await generateShotVideo(shot.videoPrompt, shot.durationSeconds, imageUrl);
        });

        // 3. Await independent voiceover result for alignment and captions
        const voiceoverResult = await voiceoverPromise;

        // 4. Reconcile Video Duration against Real Voiceover Duration
        const alignedVideoUrl = await step.run(`align-video-${shot.shotId}`, async () => {
          return await matchVideoDuration(
            rawVideoUrl,
            voiceoverResult.durationSeconds,
            shot.durationSeconds
          );
        });

        // 5. Build Caption Cues from Word Timestamps
        const captionCues = await step.run(`build-captions-${shot.shotId}`, async () => {
          return buildCaptionCues(voiceoverResult.wordTimestamps);
        });

        // f. Save Shot Assets to Postgres
        await step.run(`save-shot-assets-${shot.shotId}`, async () => {
          await prisma.shot.update({
            where: { shot_id: shot.shotId },
            data: {
              generated_image_url: imageUrl,
              generated_video_url: alignedVideoUrl,
              generated_voiceover_url: voiceoverResult.audioUrl,
              voiceover_duration_seconds: voiceoverResult.durationSeconds,
              word_timestamps: JSON.stringify(voiceoverResult.wordTimestamps),
              caption_cues: JSON.stringify(captionCues),
            },
          });
        });
      })
    );

    // ─── Step 6: Ready for Review ─────────────────────────────────────────────
    await step.run("set-ready-for-review", async () => {
      await prisma.project.update({
        where: { project_id: projectId },
        data: { status: "READY_FOR_REVIEW" },
      });
    });

    // ─── Step 7: Wait for Render Request ──────────────────────────────────────
    await step.waitForEvent("wait-for-render-request", {
      event: "project/render-requested",
      match: "data.projectId",
      timeout: "7d",
    });

    // ─── Step 8: Render Final Composition ─────────────────────────────────────
    const renderResult = await step.run("render-final-video", async () => {
      await prisma.project.update({
        where: { project_id: projectId },
        data: { status: "RENDERING" },
      });

      try {
        const shots = await prisma.shot.findMany({
          where: { project_id: projectId },
          orderBy: { number: "asc" },
        });

        const renderShots = shots.map((s) => ({
          id: s.shot_id,
          number: s.number,
          videoUrl: s.generated_video_url || "",
          audioUrl: s.generated_voiceover_url || undefined,
          durationSeconds: s.voiceover_duration_seconds || s.duration_seconds,
          captionCues: (s.caption_cues as unknown as { text: string; start: number; end: number }[]) || [],
        }));

        const { renderAndUploadVideo } = await import("@/render/renderer");
        const finalVideoUrl = await renderAndUploadVideo(projectId, renderShots);

        await prisma.project.update({
          where: { project_id: projectId },
          data: { status: "COMPLETE" },
        });

        return { success: true, finalVideoUrl };
      } catch (err) {
        await prisma.project.update({
          where: { project_id: projectId },
          data: { status: "FAILED" },
        });

        throw err;
      }
    });

    return { projectId, status: "COMPLETE", result: renderResult };
  }
);
