"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import TopicInputScreen from "@/components/screens/TopicInputScreen";
import AnalysisScreen from "@/components/screens/AnalysisScreen";
import ScriptScreen from "@/components/screens/ScriptScreen";
import type { Shot } from "@/types/shot";
import AssetStudioScreen from "@/components/screens/AssetStudioScreen";
import PreviewScreen from "@/components/screens/PreviewScreen";
import { useProjectStatus } from "@/src/lib/hooks/useProjectStatus";
import {
  createProject,
  approveTopic,
  rejectTopic,
  approveScript,
  regenerateShotAsset,
  requestRender,
} from "@/src/lib/mocks";

const TABS = [
  "1. Topic input",
  "2. Analysis",
  "3. Script",
  "4. Asset studio",
  "5. Preview",
] as const;

export default function StudioPage() {
  const [activeTab, setActiveTab] = useState<number>(0);
  const [projectId, setProjectId] = useState<string | null>(null);

  // Poll real backend project state every 2s
  const { project } = useProjectStatus(projectId);

  // Map backend shots to UI Shot interface
  const realShots: Shot[] =
    projectId && project?.shots
      ? project.shots.map((s) => ({
          id: s.shot_id,
          number: s.number,
          text: s.text,
          durationSeconds: s.duration_seconds,
          generatedImageUrl: s.generated_image_url,
          generatedVideoUrl: s.generated_video_url,
          generatedVoiceoverUrl: s.generated_voiceover_url,
        }))
      : [];

  const analysisReport =
    project?.analysis?.report ||
    "Evaluating topic accuracy, clarity, and art direction with Gemini AI...";

  const analysisSuggestions = project?.analysis?.suggestions
    ? Array.isArray(project.analysis.suggestions)
      ? project.analysis.suggestions.join("\n")
      : String(project.analysis.suggestions)
    : "No suggestions provided.";

  // Find completed final video URL if available
  const finalVideoUrl =
    project?.shots?.find((s) => s.generated_video_url)?.generated_video_url ||
    project?.shots?.[0]?.generated_video_url ||
    undefined;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      {/* ─── Tab Navigation ─── */}
      <nav className="flex items-center gap-1.5">
        {TABS.map((label, index) => (
          <Button
            key={label}
            size="sm"
            variant={activeTab === index ? "default" : "outline"}
            className="rounded-full text-xs"
            onClick={() => setActiveTab(index)}
          >
            {label}
          </Button>
        ))}
      </nav>

      {/* ─── Status Indicator ─── */}
      {project && (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/60 px-4 py-2 text-xs text-muted-foreground">
          <span>
            Topic: <strong className="text-foreground">{project.topic_name}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Status: <span className="font-semibold text-foreground">{project.status}</span>
          </span>
        </div>
      )}

      {/* ─── Content Area ─── */}
      <div className="mt-4 rounded-xl border p-5">
        {activeTab === 0 && (
          <TopicInputScreen
            onSubmit={async (topic, description) => {
              const res = await createProject(topic, description);
              setProjectId(res.projectId);
              setActiveTab(1);
            }}
          />
        )}

        {activeTab === 1 && (
          <AnalysisScreen
            report={analysisReport}
            suggestions={analysisSuggestions}
            onAccept={async () => {
              if (projectId) {
                try {
                  await approveTopic(projectId);
                } catch (err) {
                  console.error("Approve topic error:", err);
                }
              }
              setActiveTab(2);
            }}
            onReject={async (feedback) => {
              if (projectId) {
                try {
                  await rejectTopic(projectId, feedback);
                } catch (err) {
                  console.error("Reject topic error:", err);
                }
              }
            }}
          />
        )}

        {activeTab === 2 && (
          <ScriptScreen
            shots={realShots}
            onAccept={async () => {
              if (projectId) {
                try {
                  await approveScript(projectId);
                } catch (err) {
                  console.error("Approve script error:", err);
                }
              }
              setActiveTab(3);
            }}
          />
        )}

        {activeTab === 3 && (
          <AssetStudioScreen
            shots={realShots}
            onRunAsset={async (shotId, type) => {
              if (projectId) {
                await regenerateShotAsset(projectId, shotId, type);
              }
            }}
            onComplete={async () => {
              if (projectId) {
                try {
                  await requestRender(projectId);
                } catch (err) {
                  console.error("Request render error:", err);
                }
              }
              setActiveTab(4);
            }}
          />
        )}

        {activeTab === 4 && (
          <PreviewScreen
            videoUrl={finalVideoUrl}
            onDownload={() => {
              if (finalVideoUrl) {
                window.open(finalVideoUrl, "_blank");
              }
            }}
            onRevise={() => {
              setActiveTab(3);
            }}
          />
        )}
      </div>
    </div>
  );
}
