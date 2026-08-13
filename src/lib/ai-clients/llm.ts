import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Shot } from "@/types/shot";
import type { StyleBible } from "@/src/types/project";

export class LLMError extends Error {
  constructor(message: string, public override cause?: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : "";
    const fullMsg = causeMsg && !message.includes(causeMsg)
      ? `${message} (${causeMsg})`
      : message;
    super(fullMsg);
    this.name = "LLMError";
  }
}

// ─── Verbatim System Prompts (Unchanged) ──────────────────────────────────────

export const VERIFY_TOPIC_SYSTEM_PROMPT = `You are the pedagogical verification engine for Drona AI, a platform that turns educator-submitted topics into short narrated video tutorials.

You will receive a TOPIC and a DESCRIPTION (how the educator wants it explained). Do two things:

1. VERIFY: Check the explanation for factual accuracy and pedagogical soundness. Note any gaps, oversimplifications, or missing prerequisite concepts a learner would need. Be specific and cite what's missing, not generic.

2. ESTABLISH A STYLE BIBLE: Before any visuals are generated, decide the single consistent visual language every shot in this video will share. This is the most important thing you produce — every image and video prompt downstream will be built on top of it, so be concrete and specific, not vague ("colorful and engaging" is useless; "flat 2D vector illustration, warm amber and teal palette, soft rounded shapes, no outlines, consistent character design for any recurring figures" is usable).

Submit your structured response using the submit_verification tool.`;

export const BREAKDOWN_SCRIPT_SYSTEM_PROMPT = `You are the scriptwriting and shot-direction engine for Drona AI.

You will receive: TOPIC, DESCRIPTION, the ANALYSIS REPORT, and the STYLE BIBLE established during verification. Produce a complete shot-by-shot script.

THINK IN NARRATIVE ARC, not equal-sized information chunks:
- Shot 1 is a hook — a concrete, curious, or surprising entry point, not a dictionary-style definition
- Middle shots build the explanation progressively, each one depending on what the last one established
- The final shot is a payoff — a synthesis or a "why this matters" close, not just "and that's the last step"

CONSTRAINTS:
- Each shot is 15-30 seconds of narration (roughly 40-75 spoken words at natural pace)
- Produce between 4 and 8 shots depending on topic complexity — don't pad a simple topic to hit a shot count, and don't cram a complex topic into too few

FOR EACH SHOT, write three parallel outputs that must agree with each other (the narration, the image, and the video should all be describing the same moment, not three different ideas):

- narration: the exact voiceover script text for this shot
- image_prompt: a rich, specific visual description of this shot's key frame, written for an image generation model. ALWAYS incorporate the style_bible's visual_style, color_palette, and any recurring_motifs verbatim or near-verbatim so every shot's image prompt inherits the same visual language. Describe composition, subject, and mood concretely.
- video_prompt: a short motion/camera direction describing how this still frame should animate — e.g. "slow push in", "gentle parallax as the chloroplast rotates", "camera holds, particles drift upward". This will be used for image-to-video generation, so describe MOTION ONLY, not the scene itself (the scene is already fully specified in image_prompt) — assume the video model will see the generated image and only needs direction on how it should move.

Submit your structured response using the submit_script_breakdown tool.`;

export const REGENERATE_SHOT_PROMPTS_SYSTEM_PROMPT = `You are regenerating ONE shot's prompts after the educator edited its narration text, or requested a redo of just this shot.

You will receive: the STYLE BIBLE (unchanged, must still be honored exactly), the edited/unchanged NARRATION for this one shot, and optionally FEEDBACK on what was wrong with the previous version.

Produce a new image_prompt and video_prompt for this shot only, following the same rules as before: image_prompt fully incorporates the style_bible, video_prompt describes motion only. Do not alter the narration text — the educator's edit to narration is final. Do not reference or reconsider any other shot.

Submit your structured response using the submit_shot_prompts tool.`;

// ─── Zod Schemas for Validation ──────────────────────────────────────────────

const RawStyleBibleSchema = z.object({
  visual_style: z.string(),
  color_palette: z.union([z.string(), z.array(z.string())]).transform((val) =>
    Array.isArray(val) ? val.join(", ") : val
  ),
  tone: z.string(),
  recurring_motifs: z.string(),
});

const StyleBibleZodSchema = z.preprocess((val) => {
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
}, RawStyleBibleSchema);

const VerifyTopicZodSchema = z.object({
  accurate: z.boolean(),
  report: z.string(),
  suggestions: z.array(z.string()),
  style_bible: StyleBibleZodSchema,
});

const ScriptShotZodSchema = z.object({
  number: z.number(),
  duration_seconds: z.number(),
  narration: z.string(),
  image_prompt: z.string(),
  video_prompt: z.string(),
});

const BreakdownScriptZodSchema = z.object({
  shots: z.array(ScriptShotZodSchema),
});

const RegenerateShotPromptsZodSchema = z.object({
  image_prompt: z.string(),
  video_prompt: z.string(),
});

// ─── Anthropic Client & Timeout Helper ────────────────────────────────────────

import { getEnvVar } from "@/src/lib/env";

const MODEL_ID = "claude-haiku-4-5-20251001";

function getAnthropicClient(): Anthropic {
  const apiKey = getEnvVar("ANTHROPIC_API_KEY");

  if (!apiKey) {
    throw new LLMError("ANTHROPIC_API_KEY environment variable is missing");
  }

  return new Anthropic({ apiKey });
}

async function fetchWithTimeout<T>(
  promiseFn: () => Promise<T>,
  timeoutSeconds: number,
  actionName: string
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new LLMError(`LLM call timed out after ${timeoutSeconds}s during ${actionName}`));
    }, timeoutSeconds * 1000);
  });

  try {
    return await Promise.race([promiseFn(), timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

// ─── Function 1: verifyTopic ─────────────────────────────────────────────────

export interface VerifyTopicOutput {
  accurate: boolean;
  report: string;
  suggestions: string[];
  styleBible: {
    visualStyle: string;
    colorPalette: string;
    tone: string;
    recurringMotifs: string;
  };
}

export async function verifyTopic(
  topic: string,
  description: string
): Promise<VerifyTopicOutput> {
  const anthropic = getAnthropicClient();

  const response = await fetchWithTimeout(
    async () => {
      return await anthropic.messages.create({
        model: MODEL_ID,
        max_tokens: 2048,
        system: VERIFY_TOPIC_SYSTEM_PROMPT,
        tools: [
          {
            name: "submit_verification",
            description: "Submit the pedagogical verification analysis and style bible",
            input_schema: {
              type: "object",
              properties: {
                accurate: { type: "boolean" },
                report: { type: "string" },
                suggestions: { type: "array", items: { type: "string" } },
                style_bible: {
                  type: "object",
                  properties: {
                    visual_style: { type: "string" },
                    color_palette: { type: "string" },
                    tone: { type: "string" },
                    recurring_motifs: { type: "string" },
                  },
                  required: ["visual_style", "color_palette", "tone", "recurring_motifs"],
                },
              },
              required: ["accurate", "report", "suggestions", "style_bible"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "submit_verification" },
        messages: [
          {
            role: "user",
            content: `TOPIC: ${topic}\nDESCRIPTION: ${description}`,
          },
        ],
      });
    },
    30,
    "verifyTopic"
  );

  const toolBlock = response.content.find((c) => c.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new LLMError("Claude did not return a tool_use response for verifyTopic");
  }

  const rawInput = toolBlock.input;

  // Log raw response BEFORE validation runs
  console.log("[verifyTopic Raw Response from Claude]:\n", JSON.stringify(rawInput, null, 2));

  const parsed = VerifyTopicZodSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new LLMError(
      `Response failed Zod schema validation: ${parsed.error.message}`,
      parsed.error
    );
  }

  const data = parsed.data;

  return {
    accurate: data.accurate,
    report: data.report,
    suggestions: data.suggestions,
    styleBible: {
      visualStyle: data.style_bible.visual_style,
      colorPalette: data.style_bible.color_palette,
      tone: data.style_bible.tone,
      recurringMotifs: data.style_bible.recurring_motifs,
    },
  };
}

// ─── Function 2: breakdownScript ─────────────────────────────────────────────

export async function breakdownScript(
  topic: string,
  description: string,
  analysisReport: string,
  styleBible: StyleBible
): Promise<Shot[]> {
  const anthropic = getAnthropicClient();

  const styleBiblePayload = {
    visual_style: styleBible.visual_style || styleBible.visualStyle || "",
    color_palette: styleBible.color_palette || styleBible.colorPalette || "",
    tone: styleBible.tone || "",
    recurring_motifs: styleBible.recurring_motifs || styleBible.recurringMotifs || "",
  };

  const response = await fetchWithTimeout(
    async () => {
      return await anthropic.messages.create({
        model: MODEL_ID,
        max_tokens: 4096,
        system: BREAKDOWN_SCRIPT_SYSTEM_PROMPT,
        tools: [
          {
            name: "submit_script_breakdown",
            description: "Submit the multi-shot script breakdown with narration and image/video prompts",
            input_schema: {
              type: "object",
              properties: {
                shots: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      number: { type: "integer" },
                      duration_seconds: { type: "integer" },
                      narration: { type: "string" },
                      image_prompt: { type: "string" },
                      video_prompt: { type: "string" },
                    },
                    required: ["number", "duration_seconds", "narration", "image_prompt", "video_prompt"],
                  },
                },
              },
              required: ["shots"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "submit_script_breakdown" },
        messages: [
          {
            role: "user",
            content: `TOPIC: ${topic}\nDESCRIPTION: ${description}\nANALYSIS REPORT: ${analysisReport}\nSTYLE BIBLE: ${JSON.stringify(
              styleBiblePayload
            )}`,
          },
        ],
      });
    },
    45,
    "breakdownScript"
  );

  const toolBlock = response.content.find((c) => c.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new LLMError("Claude did not return a tool_use response for breakdownScript");
  }

  const rawInput = toolBlock.input;

  // Log raw response BEFORE validation runs
  console.log("[breakdownScript Raw Response from Claude]:\n", JSON.stringify(rawInput, null, 2));

  const parsed = BreakdownScriptZodSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new LLMError(
      `Response failed Zod schema validation: ${parsed.error.message}`,
      parsed.error
    );
  }

  return parsed.data.shots.map((s, index) => ({
    id: `shot-${s.number || index + 1}`,
    number: s.number || index + 1,
    text: s.narration,
    durationSeconds: Math.max(15, Math.min(30, s.duration_seconds)),
    imagePrompt: s.image_prompt,
    videoPrompt: s.video_prompt,
    voiceoverPrompt: s.narration,
  }));
}

// ─── Function 3: regenerateShotPrompts ───────────────────────────────────────

export async function regenerateShotPrompts(
  styleBible: StyleBible,
  narration: string,
  feedback?: string
): Promise<{ imagePrompt: string; videoPrompt: string }> {
  const anthropic = getAnthropicClient();

  const styleBiblePayload = {
    visual_style: styleBible.visual_style || styleBible.visualStyle || "",
    color_palette: styleBible.color_palette || styleBible.colorPalette || "",
    tone: styleBible.tone || "",
    recurring_motifs: styleBible.recurring_motifs || styleBible.recurringMotifs || "",
  };

  const response = await fetchWithTimeout(
    async () => {
      return await anthropic.messages.create({
        model: MODEL_ID,
        max_tokens: 2048,
        system: REGENERATE_SHOT_PROMPTS_SYSTEM_PROMPT,
        tools: [
          {
            name: "submit_shot_prompts",
            description: "Submit updated image and video prompts for a single shot",
            input_schema: {
              type: "object",
              properties: {
                image_prompt: { type: "string" },
                video_prompt: { type: "string" },
              },
              required: ["image_prompt", "video_prompt"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "submit_shot_prompts" },
        messages: [
          {
            role: "user",
            content: `NARRATION: ${narration}\nSTYLE BIBLE: ${JSON.stringify(
              styleBiblePayload
            )}\nFEEDBACK: ${feedback || "None"}`,
          },
        ],
      });
    },
    30,
    "regenerateShotPrompts"
  );

  const toolBlock = response.content.find((c) => c.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new LLMError("Claude did not return a tool_use response for regenerateShotPrompts");
  }

  const rawInput = toolBlock.input;

  // Log raw response BEFORE validation runs
  console.log("[regenerateShotPrompts Raw Response from Claude]:\n", JSON.stringify(rawInput, null, 2));

  const parsed = RegenerateShotPromptsZodSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new LLMError(
      `Response failed Zod schema validation: ${parsed.error.message}`,
      parsed.error
    );
  }

  return {
    imagePrompt: parsed.data.image_prompt,
    videoPrompt: parsed.data.video_prompt,
  };
}
