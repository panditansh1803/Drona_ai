"use client";

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageIcon, VideoIcon, MicIcon, CheckIcon, LoaderCircleIcon } from "lucide-react";
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
  image:     { label: "Image",     Icon: ImageIcon },
  video:     { label: "Video",     Icon: VideoIcon },
  voiceover: { label: "Voiceover", Icon: MicIcon   },
};

interface AssetCardProps {
  shotId: string;
  type: AssetType;
  status: AssetStatus;
  assetUrl?: string | null;
  onRun: (shotId: string, type: AssetType) => void;
}

function AssetCard({ shotId, type, status, assetUrl, onRun }: AssetCardProps) {
  const { label, Icon } = ASSET_META[type];

  return (
    <div className="flex flex-1 flex-col justify-between rounded-md bg-muted p-2 gap-1.5 min-h-[64px]">
      <div className="flex items-center justify-between gap-1 text-muted-foreground">
        <div className="flex items-center gap-1">
          <Icon className="size-3.5 shrink-0" />
          <span className="text-xs font-medium">{label}</span>
        </div>

        {/* Status indicator */}
        {status === "loading" && (
          <LoaderCircleIcon className="size-3.5 animate-spin text-primary" />
        )}
        {status === "done" && (
          <CheckIcon className="size-3.5 text-green-600 dark:text-green-400" />
        )}
      </div>

      {/* Asset Preview Thumbnail or Audio Player */}
      {status === "done" && assetUrl && (
        <div className="mt-1 overflow-hidden rounded border bg-background text-[10px]">
          {type === "image" && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={assetUrl} alt="Shot image" className="h-14 w-full object-cover" />
          )}
          {type === "video" && (
            <div className="relative">
              <video src={assetUrl} className="h-14 w-full object-cover" autoPlay muted loop />
            </div>
          )}
          {type === "voiceover" && (
            <audio src={assetUrl} controls className="w-full h-7 text-xs" />
          )}
        </div>
      )}

      {/* Action button */}
      <div className="flex justify-end">
        <Button
          size="sm"
          variant={status === "done" ? "outline" : "default"}
          className="h-6 px-2 text-[11px]"
          disabled={status === "loading"}
          onClick={() => onRun(shotId, type)}
        >
          {status === "done" ? "Regenerate" : status === "loading" ? "Generating..." : "Generate"}
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
    if (statuses[key]) return statuses[key]!;

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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* ─── Heading ─── */}
      <h2 className="text-sm font-medium">Multi-modal asset generation studio</h2>

      {/* ─── Batch generate buttons ─── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleRunAll("image")}>
          <ImageIcon className="size-3.5" />
          Regenerate all images
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleRunAll("video")}>
          <VideoIcon className="size-3.5" />
          Regenerate all videos
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleRunAll("voiceover")}>
          <MicIcon className="size-3.5" />
          Regenerate all voiceovers
        </Button>
      </div>

      {/* ─── Shot rows ─── */}
      <div className="flex flex-col gap-3">
        {shots.map((shot) => (
          <div
            key={shot.id}
            className="flex flex-col md:flex-row md:items-center gap-2.5 border-t pt-3"
          >
            {/* Shot number badge */}
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className="min-w-[64px] justify-center shrink-0 text-[11px]"
              >
                Shot {String(shot.number).padStart(2, "0")}
              </Badge>
            </div>

            {/* Three asset sub-cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 flex-1">
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
      <div className="border-t pt-4">
        <Button disabled={!allDone} onClick={onComplete} className="w-full md:w-auto">
          Proceed to final video preview
        </Button>
      </div>
    </div>
  );
}
