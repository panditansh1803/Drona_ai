"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2Icon, MessageSquareDiffIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface AnalysisScreenProps {
  report: string;
  suggestions: string;
  onAccept: () => Promise<void> | void;
  onReject: (feedback: string) => Promise<void> | void;
}

export default function AnalysisScreen({
  report,
  suggestions,
  onAccept,
  onReject,
}: AnalysisScreenProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isAccepting, setIsAccepting] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  async function handleAccept() {
    setIsAccepting(true);
    try {
      await onAccept();
    } finally {
      setIsAccepting(false);
    }
  }

  async function handleResubmit() {
    if (!feedback.trim()) return;
    setIsRejecting(true);
    try {
      await onReject(feedback.trim());
      setFeedback("");
      setDialogOpen(false);
    } finally {
      setIsRejecting(false);
    }
  }

  const isLoading = isAccepting || isRejecting;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      {/* ─── Heading ─── */}
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-[#F3F4F6]">Analysis and Verification</h2>
        <p className="text-xs text-[#737D8C]">
          Gemini AI evaluation of pedagogical accuracy, structural soundess, and art direction.
        </p>
      </div>

      {/* ─── Analysis Report Card ─── */}
      <div className="rounded-xl border border-[#263241] bg-[#161D27] p-4 flex flex-col gap-2 shadow-sm">
        <div className="flex items-center gap-2 text-indigo-400">
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider">Analysis Report</span>
        </div>
        <p className="text-sm leading-relaxed text-[#F3F4F6] whitespace-pre-line">
          {report}
        </p>
      </div>

      {/* ─── Suggested Changes Card ─── */}
      <div className="rounded-xl border border-[#263241] bg-[#161D27] p-4 flex flex-col gap-2 shadow-sm">
        <div className="flex items-center gap-2 text-amber-400">
          <MessageSquareDiffIcon className="size-4 shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider">Suggested Revisions</span>
        </div>
        <p className="text-sm leading-relaxed text-[#A7B0BE] whitespace-pre-line">
          {suggestions}
        </p>
      </div>

      {/* ─── Action Buttons ─── */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button
          onClick={handleAccept}
          disabled={isLoading}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 px-5 py-2"
        >
          {isAccepting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-white" />
              Generating script shots with Gemini AI...
            </>
          ) : (
            "Accept Analysis"
          )}
        </Button>
        <Button
          variant="outline"
          onClick={() => setDialogOpen(true)}
          disabled={isLoading}
          className="bg-[#161D27] border-[#263241] text-[#A7B0BE] hover:bg-[#1B2430] hover:text-[#F3F4F6]"
        >
          Reject / Suggest Revisions
        </Button>
      </div>

      {/* ─── Reject Dialog ─── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-[#111720] border-[#263241] text-[#F3F4F6]">
          <DialogHeader>
            <DialogTitle className="text-[#F3F4F6]">Suggest Revisions</DialogTitle>
            <DialogDescription className="text-[#A7B0BE]">
              Describe what should be changed. The analysis and style bible will be re-evaluated.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            rows={4}
            placeholder="e.g. Focus more on beginner-level examples and real-world visual analogies…"
            value={feedback}
            disabled={isRejecting}
            className="bg-[#161D27] border-[#263241] text-[#F3F4F6] placeholder-[#737D8C] focus:border-indigo-500 focus:ring-indigo-500/20"
            onChange={(e) => setFeedback(e.target.value)}
          />

          <DialogFooter>
            <Button
              onClick={handleResubmit}
              disabled={!feedback.trim() || isRejecting}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20"
            >
              {isRejecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin text-white" />
                  Re-analyzing topic with Gemini AI...
                </>
              ) : (
                "Resubmit"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
