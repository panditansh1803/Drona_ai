"use client";

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageIcon, VideoIcon, MicIcon, CheckIcon, LoaderCircleIcon, SparklesIcon, ArrowRightIcon } from "lucide-react";
import type { Shot } from "@/types/shot";

// ─── Types ───────────────────────────────────────────────────────────────────

type AssetType = "image" | "video" | "voiceover";
type AssetStatus = "idle" | "loading" | "done";

/** Composite key: "<shotId>:<assetType>" */
type AssetKey = `${string}:${AssetType}`;

function makeKey(shotId: string, type: AssetType): AssetKey {
  return `${shotId}:${type}`;
}

// ─── Sub-card ─────────────────────────────────────────────────────────────────

const ASSET_META: Record<AssetType, { label: string; Icon: React.ElementType }> = {
  image:     { label: "Image Keyframe", Icon: ImageIcon },
  video:     { label: "Video Clip",     Icon: VideoIcon },
  voiceover: { label: "Voiceover Audio", Icon: MicIcon   },
};

interface AssetCardProps {
  shotId: string;
  type: AssetType;
  status: AssetStatus;
  /** The real generated URL from the database — always passed, regardless of local status state */
  assetUrl?: string | null;
  onRun: (shotId: string, type: AssetType) => void;
}

function AssetCard({ shotId, type, status, assetUrl, onRun }: AssetCardProps) {
  const { label, Icon } = ASSET_META[type];

  // Show preview whenever a real URL exists — even if the local status hasn't
  // been set to "done" yet (e.g. pre-populated by Inngest or from a previous session).
  const showPreview = Boolean(assetUrl);
  const isDone = status === "done" || showPreview;

  return (
    <div className="flex flex-1 flex-col justify-between rounded-lg border border-[#263241] bg-[#111720] p-3 gap-2 min-h-[90px] transition-all hover:border-[#38bdf8]/30 shadow-sm">
      <div className="flex items-center justify-between gap-1 text-[#A7B0BE]">
        <div className="flex items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-indigo-400" />
          <span className="text-xs font-medium text-[#F3F4F6]">{label}</span>
        </div>

        {/* Status indicator */}
        {status === "loading" && (
          <LoaderCircleIcon className="size-3.5 animate-spin text-indigo-400" />
        )}
        {isDone && status !== "loading" && (
          <div className="flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-400 font-medium">
            <CheckIcon className="size-3" />
            <span>Ready</span>
          </div>
        )}
      </div>

      {/* ── Asset Preview Thumbnail ── */}
      {showPreview && assetUrl && (
        <div className="mt-1 overflow-hidden rounded-md border border-[#263241] bg-[#0B0F14]">
          {type === "image" && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={assetUrl}
              alt="Shot image keyframe"
              className="h-16 w-full object-cover"
            />
          )}
          {type === "video" && (
            <video
              src={assetUrl}
              className="h-16 w-full object-cover"
              autoPlay
              muted
              loop
              playsInline
            />
          )}
          {type === "voiceover" && (
            <div className="p-1.5">
              <audio
                src={assetUrl}
                controls
                className="w-full h-8 text-xs accent-indigo-500"
              />
            </div>
          )}
        </div>
      )}

      {/* Loading skeleton while generating */}
      {status === "loading" && !showPreview && (
        <div className="mt-1 h-16 rounded-md border border-[#263241] bg-[#0B0F14] animate-pulse" />
      )}

      {/* Action button — always visible for regeneration */}
      <div className="flex justify-end pt-1">
        <Button
          size="sm"
          variant={isDone ? "outline" : "default"}
          className={`h-6 px-2.5 text-[11px] font-medium transition-all ${
            isDone
              ? "bg-[#161D27] border-[#263241] text-[#A7B0BE] hover:text-[#F3F4F6] hover:bg-[#1B2430]"
              : status === "loading"
              ? "bg-[#1B2430] text-[#737D8C]"
              : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm"
          }`}
          disabled={status === "loading"}
          onClick={() => onRun(shotId, type)}
        >
          {isDone ? "Regenerate" : status === "loading" ? "Generating..." : "Generate"}
        </Button>
      </div>
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

interface AssetStudioScreenProps {
  shots: Shot[];
  onRunAsset?: (shotId: string, type: AssetType) => Promise<void>;
  onComplete: () => void;
}

const ASSET_TYPES: AssetType[] = ["image", "video", "voiceover"];

export default function AssetStudioScreen({ shots, onRunAsset, onComplete }: AssetStudioScreenProps) {
  const [statuses, setStatuses] = useState<Partial<Record<AssetKey, AssetStatus>>>({});

  const getStatus = (shot: Shot, type: AssetType): AssetStatus => {
    const key = makeKey(shot.id, type);
    // Prefer local in-flight state (loading / just-done) over database state
    if (statuses[key]) return statuses[key]!;

    // Fall back to database-backed URL presence
    if (type === "image" && shot.generatedImageUrl) return "done";
    if (type === "video" && shot.generatedVideoUrl) return "done";
    if (type === "voiceover" && shot.generatedVoiceoverUrl) return "done";

    return "idle";
  };

  const getAssetUrl = (shot: Shot, type: AssetType): string | null | undefined => {
    if (type === "image") return shot.generatedImageUrl;
    if (type === "video") return shot.generatedVideoUrl;
    if (type === "voiceover") return shot.generatedVoiceoverUrl;
    return undefined;
  };

  const handleRun = useCallback(
    async (shotId: string, type: AssetType) => {
      const key = makeKey(shotId, type);
      setStatuses((prev) => ({ ...prev, [key]: "loading" }));

      try {
        if (onRunAsset) {
          await onRunAsset(shotId, type);
        } else {
          await new Promise<void>((resolve) => setTimeout(resolve, 1500));
        }
        setStatuses((prev) => ({ ...prev, [key]: "done" }));
      } catch (err) {
        console.error(`Asset generation error for ${key}:`, err);
        setStatuses((prev) => ({ ...prev, [key]: "idle" }));
      }
    },
    [onRunAsset]
  );

  /** Run all sub-cards of a single asset type across every shot in parallel */
  const handleRunAll = useCallback(
    async (type: AssetType) => {
      await Promise.all(
        shots.map((shot) => {
          return handleRun(shot.id, type);
        })
      );
    },
    [shots, handleRun]
  );

  /** True if all shots have assets or status done */
  const allDone =
    shots.length > 0 &&
    shots.every((shot) =>
      ASSET_TYPES.every(
        (type) => getStatus(shot, type) === "done"
      )
    );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {/* ─── Heading ─── */}
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-[#F3F4F6]">Multi-Modal Asset Generation Studio</h2>
        <p className="text-xs text-[#737D8C]">
          Generate and preview keyframe images, video clips, and voiceovers for each shot sequence.
        </p>
      </div>

      {/* ─── Batch generate buttons ─── */}
      <div className="flex items-center gap-2 flex-wrap bg-[#161D27] p-2.5 rounded-xl border border-[#263241]">
        <span className="text-xs text-[#737D8C] font-medium mr-1">Batch Actions:</span>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 bg-[#111720] border-[#263241] text-[#A7B0BE] hover:text-[#F3F4F6] hover:bg-[#1B2430] text-xs h-7"
          onClick={() => handleRunAll("image")}
        >
          <ImageIcon className="size-3.5 text-indigo-400" />
          Regenerate All Images
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 bg-[#111720] border-[#263241] text-[#A7B0BE] hover:text-[#F3F4F6] hover:bg-[#1B2430] text-xs h-7"
          onClick={() => handleRunAll("video")}
        >
          <VideoIcon className="size-3.5 text-sky-400" />
          Regenerate All Videos
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 bg-[#111720] border-[#263241] text-[#A7B0BE] hover:text-[#F3F4F6] hover:bg-[#1B2430] text-xs h-7"
          onClick={() => handleRunAll("voiceover")}
        >
          <MicIcon className="size-3.5 text-emerald-400" />
          Regenerate All Voiceovers
        </Button>
      </div>

      {/* ─── Shot rows ─── */}
      <div className="flex flex-col gap-4">
        {shots.map((shot) => (
          <div
            key={shot.id}
            className="flex flex-col gap-3 rounded-xl border border-[#263241] bg-[#161D27] p-4"
          >
            {/* Shot Header Badge & Narration snippet */}
            <div className="flex items-center justify-between gap-3 pb-1 border-b border-[#263241]/60">
              <div className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className="min-w-[72px] justify-center shrink-0 text-[11px] font-semibold bg-[#1B2430] border border-[#263241] text-indigo-400 py-0.5"
                >
                  Shot {String(shot.number).padStart(2, "0")}
                </Badge>
                <span className="text-xs text-[#A7B0BE] truncate max-w-md">
                  {shot.text}
                </span>
              </div>
              <span className="text-[11px] font-mono text-[#737D8C]">
                {shot.durationSeconds}s
              </span>
            </div>

            {/* Three asset sub-cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {ASSET_TYPES.map((type) => (
                <AssetCard
                  key={type}
                  shotId={shot.id}
                  type={type}
                  status={getStatus(shot, type)}
                  assetUrl={getAssetUrl(shot, type)}
                  onRun={handleRun}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ─── Make final video ─── */}
      <div className="border-t border-[#263241] pt-4">
        <Button
          disabled={!allDone}
          onClick={onComplete}
          className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 gap-2 px-5 py-2"
        >
          <SparklesIcon className="size-4" />
          Proceed to Final Video Preview
          <ArrowRightIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
