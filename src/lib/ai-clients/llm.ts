import { GoogleGenAI } from "@google/genai";
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

// ─── Verbatim System Prompts ──────────────────────────────────────────────────

export const VERIFY_TOPIC_SYSTEM_PROMPT = `You are the pedagogical verification engine for Drona AI, a platform that turns educator-submitted topics into short narrated video tutorials.

You will receive a TOPIC and a DESCRIPTION (how the educator wants it explained). Do two things:

1. VERIFY: Check the explanation for factual accuracy and pedagogical soundness. Note any gaps, oversimplifications, or missing prerequisite concepts a learner would need. Be specific and cite what's missing, not generic.

2. ESTABLISH A STYLE BIBLE: Before any visuals are generated, decide the single consistent visual language every shot in this video will share. This is the most important thing you produce — every image and video prompt downstream will be built on top of it, so be concrete and specific, not vague ("colorful and engaging" is useless; "flat 2D vector illustration, warm amber and teal palette, soft rounded shapes, no outlines, consistent character design for any recurring figures" is usable).

Return ONLY this JSON, no other text:

{
  "accurate": boolean,
  "report": "2-3 sentence plain-language assessment of accuracy and clarity",
  "suggestions": ["specific improvement 1", "specific improvement 2"],
  "style_bible": {
    "visual_style": "concrete art direction: medium, rendering style, line quality — e.g. 'flat 2D vector illustration, no outlines, soft shadows'",
    "color_palette": "3-5 specific named colors or hex-adjacent descriptions",
    "tone": "one phrase — e.g. 'calm and curious, museum-exhibit energy'",
    "recurring_motifs": "any repeating visual elements that should appear across shots for continuity — e.g. a mascot, a consistent framing device, a recurring background texture. If none fit, say 'none'"
  }
}`;

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

Return ONLY this JSON, no other text:

{
  "shots": [
    {
      "number": 1,
      "duration_seconds": 20,
      "narration": "...",
      "image_prompt": "...",
      "video_prompt": "..."
    }
  ]
}`;

export const REGENERATE_SHOT_PROMPTS_SYSTEM_PROMPT = `You are regenerating ONE shot's prompts after the educator edited its narration text, or requested a redo of just this shot.

You will receive: the STYLE BIBLE (unchanged, must still be honored exactly), the edited/unchanged NARRATION for this one shot, and optionally FEEDBACK on what was wrong with the previous version.

Produce a new image_prompt and video_prompt for this shot only, following the same rules as before: image_prompt fully incorporates the style_bible, video_prompt describes motion only. Do not alter the narration text — the educator's edit to narration is final. Do not reference or reconsider any other shot.

Return ONLY this JSON:

{ "image_prompt": "...", "video_prompt": "..." }`;

// ─── Zod Schemas for Validation ──────────────────────────────────────────────

const StyleBibleZodSchema = z.object({
  visual_style: z.string(),
  color_palette: z.string(),
  tone: z.string(),
  recurring_motifs: z.string(),
});

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

// ─── Helper: Gemini Client & Timeout Wrapper ─────────────────────────────────

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new LLMError("GEMINI_API_KEY environment variable is missing");
  }
  return new GoogleGenAI({ apiKey });
}

const PRIMARY_MODEL = "gemini-flash-latest";

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
  try {
    const ai = getGeminiClient();

    const content = await fetchWithTimeout(
      async () => {
        const response = await ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents: [
            {
              role: "user",
              parts: [{ text: `TOPIC: ${topic}\nDESCRIPTION: ${description}` }],
            },
          ],
          config: {
            systemInstruction: VERIFY_TOPIC_SYSTEM_PROMPT,
            responseMimeType: "application/json",
            temperature: 0.3,
          },
        });
        return response.text;
      },
      30,
      "verifyTopic"
    );

    if (!content) {
      throw new LLMError("Gemini returned an empty response for verifyTopic");
    }

    console.log("[verifyTopic Raw Gemini Response]:\n", content);

    const rawJson = JSON.parse(content);
    const parsed = VerifyTopicZodSchema.safeParse(rawJson);

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
  } catch (error) {
    if (error instanceof LLMError) throw error;
    throw new LLMError("Failed to verify topic", error);
  }
}

// ─── Function 2: breakdownScript ─────────────────────────────────────────────

export async function breakdownScript(
  topic: string,
  description: string,
  analysisReport: string,
  styleBible: StyleBible
): Promise<Shot[]> {
  try {
    const ai = getGeminiClient();

    const styleBiblePayload = {
      visual_style: styleBible.visual_style || styleBible.visualStyle || "",
      color_palette: styleBible.color_palette || styleBible.colorPalette || "",
      tone: styleBible.tone || "",
      recurring_motifs: styleBible.recurring_motifs || styleBible.recurringMotifs || "",
    };

    const content = await fetchWithTimeout(
      async () => {
        const response = await ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `TOPIC: ${topic}\nDESCRIPTION: ${description}\nANALYSIS REPORT: ${analysisReport}\nSTYLE BIBLE: ${JSON.stringify(
                    styleBiblePayload
                  )}`,
                },
              ],
            },
          ],
          config: {
            systemInstruction: BREAKDOWN_SCRIPT_SYSTEM_PROMPT,
            responseMimeType: "application/json",
            temperature: 0.5,
          },
        });
        return response.text;
      },
      45,
      "breakdownScript"
    );

    if (!content) {
      throw new LLMError("Gemini returned an empty response for breakdownScript");
    }

    console.log("[breakdownScript Raw Gemini Response]:\n", content);

    const rawJson = JSON.parse(content);
    const parsed = BreakdownScriptZodSchema.safeParse(rawJson);

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
  } catch (error) {
    if (error instanceof LLMError) throw error;
    throw new LLMError("Failed to break down script", error);
  }
}

// ─── Function 3: regenerateShotPrompts ───────────────────────────────────────

export async function regenerateShotPrompts(
  styleBible: StyleBible,
  narration: string,
  feedback?: string
): Promise<{ imagePrompt: string; videoPrompt: string }> {
  try {
    const ai = getGeminiClient();

    const styleBiblePayload = {
      visual_style: styleBible.visual_style || styleBible.visualStyle || "",
      color_palette: styleBible.color_palette || styleBible.colorPalette || "",
      tone: styleBible.tone || "",
      recurring_motifs: styleBible.recurring_motifs || styleBible.recurringMotifs || "",
    };

    const content = await fetchWithTimeout(
      async () => {
        const response = await ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `NARRATION: ${narration}\nSTYLE BIBLE: ${JSON.stringify(
                    styleBiblePayload
                  )}\nFEEDBACK: ${feedback || "None"}`,
                },
              ],
            },
          ],
          config: {
            systemInstruction: REGENERATE_SHOT_PROMPTS_SYSTEM_PROMPT,
            responseMimeType: "application/json",
            temperature: 0.5,
          },
        });
        return response.text;
      },
      30,
      "regenerateShotPrompts"
    );

    if (!content) {
      throw new LLMError("Gemini returned an empty response for regenerateShotPrompts");
    }

    console.log("[regenerateShotPrompts Raw Gemini Response]:\n", content);

    const rawJson = JSON.parse(content);
    const parsed = RegenerateShotPromptsZodSchema.safeParse(rawJson);

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
  } catch (error) {
    if (error instanceof LLMError) throw error;
    throw new LLMError("Failed to regenerate shot prompts", error);
  }
}
