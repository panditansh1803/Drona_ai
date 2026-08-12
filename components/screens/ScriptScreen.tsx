"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PencilIcon, Loader2, SparklesIcon } from "lucide-react";
import type { Shot } from "@/types/shot";

interface ScriptScreenProps {
  shots: Shot[];
  onAccept: () => Promise<void> | void;
}

interface EditState {
  shotId: string;
  draft: string;
}

export default function ScriptScreen({ shots, onAccept }: ScriptScreenProps) {
  const [editedTextMap, setEditedTextMap] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<EditState | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  const displayShots = shots.map((s) => ({
    ...s,
    text: editedTextMap[s.id] ?? s.text,
  }));

  function startEdit(shot: Shot) {
    setEditing({ shotId: shot.id, draft: shot.text });
  }

  function cancelEdit() {
    setEditing(null);
  }

  function saveEdit() {
    if (!editing) return;
    setEditedTextMap((prev) => ({
      ...prev,
      [editing.shotId]: editing.draft,
    }));
    setEditing(null);
  }

  async function handleAccept() {
    setIsAccepting(true);
    try {
      await onAccept();
    } finally {
      setIsAccepting(false);
    }
  }

  if (displayShots.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-indigo-600/10 border border-indigo-500/20">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
        </div>
        <h3 className="text-sm font-semibold text-[#F3F4F6]">Generating script breakdown...</h3>
        <p className="text-xs text-[#737D8C] max-w-sm">
          Gemini AI is structuring your topic into narrative-arc shot scripts.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {/* ─── Heading ─── */}
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-[#F3F4F6]">Shot-Level Script Breakdown</h2>
        <p className="text-xs text-[#737D8C]">
          Review and fine-tune narration text for each shot sequence before asset generation.
        </p>
      </div>

      {/* ─── Shot list ─── */}
      <div className="flex flex-col gap-3">
        {displayShots.map((shot) => {
          const isEditing = editing?.shotId === shot.id;

          return (
            <div
              key={shot.id}
              className="flex items-start gap-3 rounded-xl border border-[#263241] bg-[#161D27] p-3.5 transition-all hover:border-[#38bdf8]/30"
            >
              {/* Shot number badge */}
              <Badge
                variant="secondary"
                className="mt-0.5 min-w-[72px] justify-center shrink-0 text-[11px] font-semibold bg-[#1B2430] border border-[#263241] text-indigo-400 py-1"
              >
                Shot {String(shot.number).padStart(2, "0")}
              </Badge>

              {/* Text or editable textarea */}
              <div className="flex flex-1 flex-col gap-2">
                {isEditing ? (
                  <>
                    <Textarea
                      rows={3}
                      value={editing.draft}
                      className="bg-[#111720] border-[#263241] text-[#F3F4F6] placeholder-[#737D8C] focus:border-indigo-500"
                      onChange={(e) =>
                        setEditing((prev) =>
                          prev ? { ...prev, draft: e.target.value } : prev
                        )
                      }
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={saveEdit}
                        disabled={isAccepting}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs h-7 px-3"
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={cancelEdit}
                        disabled={isAccepting}
                        className="bg-[#111720] border-[#263241] text-[#A7B0BE] hover:text-[#F3F4F6] text-xs h-7 px-3"
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm leading-relaxed text-[#F3F4F6]">{shot.text}</p>
                )}
              </div>

              {/* Duration */}
              <span className="mt-0.5 shrink-0 text-xs font-mono text-[#737D8C] bg-[#111720] border border-[#263241] px-2 py-0.5 rounded-md">
                {shot.durationSeconds}s
              </span>

              {/* Edit button */}
              {!isEditing && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="mt-0.5 shrink-0 text-[#737D8C] hover:text-[#F3F4F6] hover:bg-[#1B2430]"
                  onClick={() => startEdit(shot)}
                  disabled={isAccepting}
                  aria-label={`Edit shot ${shot.number}`}
                >
                  <PencilIcon className="size-3.5" />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── Accept sequence ─── */}
      <div className="border-t border-[#263241] pt-4">
        <Button
          onClick={handleAccept}
          disabled={isAccepting}
          className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 gap-2 px-5 py-2"
        >
          {isAccepting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-white" />
              Generating Images, Videos & Audio...
            </>
          ) : (
            <>
              <SparklesIcon className="size-4" />
              Accept Sequence & Generate Assets
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
