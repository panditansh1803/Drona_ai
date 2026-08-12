"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, SparklesIcon } from "lucide-react";

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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      {/* ─── Heading ─── */}
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-[#F3F4F6]">Topic and Context</h2>
        <p className="text-xs text-[#737D8C]">
          Provide your educational topic and target explanation context for pedagogical analysis.
        </p>
      </div>

      {/* ─── Error Alert ─── */}
      {errors.submit && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-400">
          <strong className="font-semibold">Analysis Error:</strong> {errors.submit}
        </div>
      )}

      {/* ─── Topic name ─── */}
      <div className="flex flex-col gap-2">
        <label htmlFor="topic-name" className="text-xs font-medium text-[#A7B0BE]">
          Topic Name <span className="text-red-400">*</span>
        </label>
        <Input
          id="topic-name"
          placeholder="e.g. Photosynthesis or Quantum Computing Basics"
          value={topic}
          disabled={isSubmitting}
          className="bg-[#161D27] border-[#263241] text-[#F3F4F6] placeholder-[#737D8C] focus:border-indigo-500 focus:ring-indigo-500/20"
          onChange={(e) => {
            setTopic(e.target.value);
            if (errors.topic) setErrors((prev) => ({ ...prev, topic: undefined }));
          }}
          aria-invalid={!!errors.topic}
        />
        {errors.topic && (
          <p className="text-xs text-red-400">{errors.topic}</p>
        )}
      </div>

      {/* ─── Description ─── */}
      <div className="flex flex-col gap-2">
        <label htmlFor="topic-desc" className="text-xs font-medium text-[#A7B0BE]">
          Description and Examples <span className="text-red-400">*</span>
        </label>
        <Textarea
          id="topic-desc"
          rows={4}
          placeholder="Describe the topic, target audience, key concepts to cover, and preferred analogies..."
          value={description}
          disabled={isSubmitting}
          className="bg-[#161D27] border-[#263241] text-[#F3F4F6] placeholder-[#737D8C] focus:border-indigo-500 focus:ring-indigo-500/20"
          onChange={(e) => {
            setDescription(e.target.value);
            if (errors.description) setErrors((prev) => ({ ...prev, description: undefined }));
          }}
          aria-invalid={!!errors.description}
        />
        {errors.description && (
          <p className="text-xs text-red-400">{errors.description}</p>
        )}
      </div>

      {/* ─── Submit Button ─── */}
      <div className="pt-2">
        <Button
          variant="default"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 gap-2 px-5 py-2"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-white" />
              Analyzing topic with Gemini AI...
            </>
          ) : (
            <>
              <SparklesIcon className="size-4" />
              Proceed to Analysis
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
