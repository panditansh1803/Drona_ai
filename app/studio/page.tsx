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

  // Derive the effective displayed tab:
  // When backend finishes asset generation (READY_FOR_REVIEW) while the user
  // is still on the Script tab (2), automatically render the Asset Studio (3).
  // Pure derivation — avoids calling setState() inside a useEffect.
  const effectiveTab =
    activeTab === 2 && project?.status === "READY_FOR_REVIEW" ? 3 : activeTab;

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
    <div className="mx-auto w-full max-w-6xl px-6 py-8 flex flex-col gap-6">
      {/* ─── Header & Brand ─── */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#263241]">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 font-bold text-lg shadow-sm">
            D
          </div>
          <div>
            <h1 className="text-base font-semibold text-[#F3F4F6] tracking-tight">
              Drona AI Studio
            </h1>
            <p className="text-xs text-[#737D8C]">
              Pedagogical Video Creation Workflow
            </p>
          </div>
        </div>

        {/* ─── Status Badge ─── */}
        {project ? (
          <div className="flex items-center gap-3 rounded-lg bg-[#161D27] border border-[#263241] px-3.5 py-1.5 text-xs text-[#A7B0BE]">
            <span className="truncate max-w-[200px]">
              Topic: <strong className="text-[#F3F4F6] font-medium">{project.topic_name}</strong>
            </span>
            <div className="h-3 w-px bg-[#263241]" />
            <span className="inline-flex items-center gap-1.5 shrink-0">
              <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
              Status: <span className="font-semibold text-[#F3F4F6]">{project.status}</span>
            </span>
          </div>
        ) : (
          <div className="text-xs text-[#737D8C] hidden sm:block">
            Ready to generate new topic
          </div>
        )}
      </header>

      {/* ─── Step Navigation ─── */}
      <nav className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {TABS.map((label, index) => {
          const isActive = effectiveTab === index;
          return (
            <Button
              key={label}
              size="sm"
              variant={isActive ? "default" : "outline"}
              className={`rounded-full text-xs font-medium px-4 py-1.5 transition-all shrink-0 ${
                isActive
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 border-transparent"
                  : "bg-[#111720] border-[#263241] text-[#A7B0BE] hover:bg-[#161D27] hover:text-[#F3F4F6]"
              }`}
              onClick={() => setActiveTab(index)}
            >
              {label}
            </Button>
          );
        })}
      </nav>

      {/* ─── Content Surface ─── */}
      <main className="rounded-xl border border-[#263241] bg-[#111720] p-6 shadow-xl shadow-black/40">
        {effectiveTab === 0 && (
          <TopicInputScreen
            onSubmit={async (topic, description) => {
              const res = await createProject(topic, description);
              setProjectId(res.projectId);
              setActiveTab(1);
            }}
          />
        )}

        {effectiveTab === 1 && (
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

        {effectiveTab === 2 && (
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

        {effectiveTab === 3 && (
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

        {effectiveTab === 4 && (
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
      </main>
    </div>
  );
}
