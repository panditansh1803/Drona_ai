"use client";

import { Button } from "@/components/ui/button";
import { PlayCircleIcon, DownloadIcon, RefreshCwIcon } from "lucide-react";

interface PreviewScreenProps {
  videoUrl?: string;
  onDownload: () => void;
  onRevise: () => void;
}

export default function PreviewScreen({
  videoUrl,
  onDownload,
  onRevise,
}: PreviewScreenProps) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      {/* ─── Heading ─── */}
      <h2 className="text-sm font-medium">Final preview and export</h2>

      {/* ─── Video display ─── */}
      <div className="flex h-44 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            autoPlay
            className="h-full w-full rounded-lg bg-black object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <PlayCircleIcon className="size-10" />
            <span className="text-xs">Final video render preview</span>
          </div>
        )}
      </div>

      {/* ─── Actions ─── */}
      <div className="flex items-center gap-2">
        <Button className="gap-1.5" onClick={onDownload} disabled={!videoUrl}>
          <DownloadIcon className="size-3.5" />
          Download
        </Button>
        <Button variant="outline" className="gap-1.5" onClick={onRevise}>
          <RefreshCwIcon className="size-3.5" />
          Revise
        </Button>
      </div>
    </div>
  );
}
