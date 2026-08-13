"use client";

import { Button } from "@/components/ui/button";
import { DownloadIcon, RefreshCwIcon, FilmIcon, LoaderCircleIcon } from "lucide-react";

interface PreviewScreenProps {
  videoUrl?: string;
  projectStatus?: string;
  onDownload: () => void;
  onRevise: () => void;
}

export default function PreviewScreen({
  videoUrl,
  projectStatus,
  onDownload,
  onRevise,
}: PreviewScreenProps) {
  const isRendering = projectStatus === "RENDERING";
  const isFailed = projectStatus === "FAILED";

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      {/* ─── Heading ─── */}
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-[#F3F4F6]">Final Preview and Export</h2>
        <p className="text-xs text-[#737D8C]">
          Watch your rendered multi-modal video lesson composition and export the final output file.
        </p>
      </div>

      {/* ─── Video Display Frame ─── */}
      <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-[#263241] bg-[#0B0F14] shadow-2xl shadow-black/80">
        {videoUrl && !isRendering ? (
          <video
            src={videoUrl}
            controls
            autoPlay
            className="h-full w-full object-contain"
          />
        ) : isRendering ? (
          /* ─── Rendering in-progress state ─── */
          <div className="flex flex-col items-center justify-center gap-4 text-[#737D8C] p-6 text-center">
            <div className="relative flex size-16 items-center justify-center">
              {/* Pulsing outer ring */}
              <div className="absolute inset-0 rounded-full border-2 border-indigo-500/30 animate-ping" />
              <div className="flex size-14 items-center justify-center rounded-2xl bg-[#161D27] border border-indigo-500/30 shadow-inner">
                <LoaderCircleIcon className="size-7 text-indigo-400 animate-spin" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-[#F3F4F6]">
                Rendering Final Composition…
              </span>
              <span className="text-xs text-[#737D8C]">
                Stitching shots, voiceovers, and captions into one MP4.
              </span>
              <span className="text-xs text-indigo-400 font-mono mt-1">
                Watch the server console for per-shot progress logs.
              </span>
            </div>
          </div>
        ) : isFailed ? (
          /* ─── Failed state ─── */
          <div className="flex flex-col items-center justify-center gap-3 text-[#737D8C] p-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-red-500/10 border border-red-500/30 shadow-inner">
              <FilmIcon className="size-7 text-red-400" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-red-400">Render Failed</span>
              <span className="text-xs text-[#737D8C]">
                Check the server console for error details. You can revise and retry.
              </span>
            </div>
          </div>
        ) : (
          /* ─── Idle / waiting state ─── */
          <div className="flex flex-col items-center justify-center gap-3 text-[#737D8C] p-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-[#161D27] border border-[#263241] shadow-inner">
              <FilmIcon className="size-7 text-indigo-400" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-[#F3F4F6]">
                Final Video Composition Render
              </span>
              <span className="text-xs text-[#737D8C]">
                Click below to request Remotion composition render
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ─── Actions ─── */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button
          onClick={onDownload}
          disabled={!videoUrl || isRendering}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 gap-2 px-5 py-2 disabled:opacity-50"
        >
          <DownloadIcon className="size-4" />
          Download Rendered Video
        </Button>
        <Button
          variant="outline"
          onClick={onRevise}
          className="bg-[#161D27] border-[#263241] text-[#A7B0BE] hover:bg-[#1B2430] hover:text-[#F3F4F6] gap-2"
        >
          <RefreshCwIcon className="size-4" />
          Revise Asset Studio
        </Button>
      </div>
    </div>
  );
}
