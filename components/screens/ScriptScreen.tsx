"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PencilIcon, Loader2 } from "lucide-react";
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
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center gap-3 py-12 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <h3 className="text-sm font-medium">Generating script breakdown...</h3>
        <p className="text-xs text-muted-foreground">
          Gemini AI is structuring your topic into narrative-arc shot scripts.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {/* ─── Heading ─── */}
      <h2 className="text-sm font-medium">Shot-level script breakdown</h2>

      {/* ─── Shot list ─── */}
      <div className="flex flex-col">
        {displayShots.map((shot) => {
          const isEditing = editing?.shotId === shot.id;

          return (
            <div
              key={shot.id}
              className="flex items-start gap-2.5 border-t py-2"
            >
              {/* Shot number badge */}
              <Badge
                variant="secondary"
                className="mt-0.5 min-w-[64px] justify-center shrink-0 text-[11px]"
              >
                Shot {String(shot.number).padStart(2, "0")}
              </Badge>

              {/* Text or editable textarea */}
              <div className="flex flex-1 flex-col gap-1.5">
                {isEditing ? (
                  <>
                    <Textarea
                      rows={3}
                      value={editing.draft}
                      onChange={(e) =>
                        setEditing((prev) =>
                          prev ? { ...prev, draft: e.target.value } : prev
                        )
                      }
                      autoFocus
                    />
                    <div className="flex gap-1.5">
                      <Button size="sm" onClick={saveEdit} disabled={isAccepting}>
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={cancelEdit} disabled={isAccepting}>
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm leading-relaxed">{shot.text}</p>
                )}
              </div>

              {/* Duration */}
              <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">
                {shot.durationSeconds}s
              </span>

              {/* Edit button */}
              {!isEditing && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="mt-0.5 shrink-0"
                  onClick={() => startEdit(shot)}
                  disabled={isAccepting}
                  aria-label={`Edit shot ${shot.number}`}
                >
                  <PencilIcon />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── Accept sequence ─── */}
      <div className="border-t pt-3">
        <Button onClick={handleAccept} disabled={isAccepting}>
          {isAccepting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating Images, Videos & Audio...
            </>
          ) : (
            "Accept sequence & generate assets"
          )}
        </Button>
      </div>
    </div>
  );
}
