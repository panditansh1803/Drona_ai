"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface TopicInputScreenProps {
  onSubmit: (topic: string, description: string) => Promise<void>;
}

export default function TopicInputScreen({ onSubmit }: TopicInputScreenProps) {
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<{ topic?: string; description?: string; submit?: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    const next: typeof errors = {};

    if (!topic.trim()) {
      next.topic = "Topic name is required";
    }
    if (!description.trim()) {
      next.description = "Description is required";
    }

    setErrors(next);

    if (Object.keys(next).length > 0) return;

    setIsSubmitting(true);
    setErrors({});

    try {
      await onSubmit(topic.trim(), description.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to analyze topic with Gemini AI";
      setErrors({ submit: msg });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      {/* ─── Heading ─── */}
      <h2 className="text-sm font-medium">Topic and context</h2>

      {/* ─── Error Alert ─── */}
      {errors.submit && (
        <div className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
          <strong>Analysis Error:</strong> {errors.submit}
        </div>
      )}

      {/* ─── Topic name ─── */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="topic-name" className="text-sm text-muted-foreground">
          Topic name <span className="text-destructive">*</span>
        </label>
        <Input
          id="topic-name"
          placeholder="e.g. Photosynthesis or Quantum Computing"
          value={topic}
          disabled={isSubmitting}
          onChange={(e) => {
            setTopic(e.target.value);
            if (errors.topic) setErrors((prev) => ({ ...prev, topic: undefined }));
          }}
          aria-invalid={!!errors.topic}
        />
        {errors.topic && (
          <p className="text-xs text-destructive">{errors.topic}</p>
        )}
      </div>

      {/* ─── Description ─── */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="topic-desc" className="text-sm text-muted-foreground">
          Description and examples <span className="text-destructive">*</span>
        </label>
        <Textarea
          id="topic-desc"
          rows={3}
          placeholder="Describe the topic, target audience, key points to cover…"
          value={description}
          disabled={isSubmitting}
          onChange={(e) => {
            setDescription(e.target.value);
            if (errors.description) setErrors((prev) => ({ ...prev, description: undefined }));
          }}
          aria-invalid={!!errors.description}
        />
        {errors.description && (
          <p className="text-xs text-destructive">{errors.description}</p>
        )}
      </div>

      {/* ─── Submit ─── */}
      <div>
        <Button variant="default" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Analyzing topic with Gemini AI...
            </>
          ) : (
            "Proceed to analysis"
          )}
        </Button>
      </div>
    </div>
  );
}
