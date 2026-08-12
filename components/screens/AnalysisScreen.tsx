"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      {/* ─── Heading ─── */}
      <h2 className="text-sm font-medium">Analysis and verification</h2>

      {/* ─── Analysis report card ─── */}
      <div className="rounded-lg bg-muted p-3">
        <p className="mb-1 text-xs text-muted-foreground">Analysis report</p>
        <p className="text-sm whitespace-pre-line">{report}</p>
      </div>

      {/* ─── Suggested changes card ─── */}
      <div className="rounded-lg bg-muted p-3">
        <p className="mb-1 text-xs text-muted-foreground">Suggested changes</p>
        <p className="text-sm whitespace-pre-line">{suggestions}</p>
      </div>

      {/* ─── Actions ─── */}
      <div className="flex items-center gap-2">
        <Button onClick={handleAccept} disabled={isLoading}>
          {isAccepting ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Generating script shots with Gemini AI...
            </>
          ) : (
            "Accept analysis"
          )}
        </Button>
        <Button variant="outline" onClick={() => setDialogOpen(true)} disabled={isLoading}>
          Reject / suggest changes
        </Button>
      </div>

      {/* ─── Reject dialog ─── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suggest revisions</DialogTitle>
            <DialogDescription>
              Describe what should be changed. The analysis will be re-run with
              your feedback.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            rows={4}
            placeholder="e.g. Focus more on beginner-level examples…"
            value={feedback}
            disabled={isRejecting}
            onChange={(e) => setFeedback(e.target.value)}
          />

          <DialogFooter>
            <Button onClick={handleResubmit} disabled={!feedback.trim() || isRejecting}>
              {isRejecting ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
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
