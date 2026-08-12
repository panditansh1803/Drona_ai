import { GoogleGenAI } from "@google/genai";
import { saveGeneratedFile } from "@/src/lib/storage/local";

export class ImageGenError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(`ImageGen Error: ${message}`);
    this.name = "ImageGenError";
  }
}

/**
 * Creates a clean SVG placeholder image buffer for local dev when image API quota is exhausted.
 */
function createPlaceholderSvgBuffer(prompt: string): Buffer {
  const safeText = prompt.slice(0, 90).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#1e293b"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <rect x="40" y="40" width="1200" height="640" rx="16" fill="none" stroke="#38bdf8" stroke-width="3" stroke-dasharray="8 6"/>
    <text x="640" y="320" font-family="sans-serif" font-size="34" font-weight="bold" fill="#38bdf8" text-anchor="middle">
      Drona AI Keyframe Concept
    </text>
    <text x="640" y="380" font-family="sans-serif" font-size="20" fill="#cbd5e1" text-anchor="middle">
      "${safeText}..."
    </text>
  </svg>`;
  return Buffer.from(svg);
}

export async function generateShotImage(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ImageGenError("GEMINI_API_KEY environment variable is missing");
  }

  const imageModels = ["gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"];

  for (const model of imageModels) {
    try {
      const ai = new GoogleGenAI({ apiKey });

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseModalities: ["IMAGE"],
        },
      });

      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts;
      const imagePart = parts?.find((p) => p.inlineData && p.inlineData.data);

      if (imagePart && imagePart.inlineData?.data) {
        const base64Data = imagePart.inlineData.data;
        const imageBuffer = Buffer.from(base64Data, "base64");
        const fileName = `img_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
        const imageUrl = await saveGeneratedFile(imageBuffer, fileName, "images", "image/png");

        console.log(
          `[ImageGen Success] Model: ${model} | Prompt: "${prompt.slice(0, 50)}..." | URL: ${imageUrl}`
        );

        return imageUrl;
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[generateShotImage] Model ${model} unavailable or rate-limited:`, errMsg);
    }
  }

  // Dev / rate-limit fallback: create clean SVG placeholder image
  console.log(`[ImageGen Fallback] Gemini image API rate limited. Generating local SVG keyframe placeholder.`);
  const placeholderBuffer = createPlaceholderSvgBuffer(prompt);
  const fileName = `img_placeholder_${Date.now()}_${Math.random().toString(36).substring(7)}.svg`;
  const imageUrl = await saveGeneratedFile(placeholderBuffer, fileName, "images", "image/svg+xml");

  console.log(
    `[ImageGen Success (SVG Fallback)] Prompt: "${prompt.slice(0, 50)}..." | URL: ${imageUrl}`
  );

  return imageUrl;
}
