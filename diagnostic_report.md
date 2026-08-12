# Drona AI — Full Asset Generation Pipeline Diagnostic Report

---

## Step 1: API Key Loading

### GEMINI_API_KEY
**Status**: ✅ Present — 55 characters, starts with `AQ.Ab...`

Both [llm.ts](file:///c:/Users/vashi/OneDrive/Desktop/drona-ai/src/lib/ai-clients/llm.ts#L120) and [image-gen.ts](file:///c:/Users/vashi/OneDrive/Desktop/drona-ai/src/lib/ai-clients/image-gen.ts#L36) read it via `process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY`. The key is non-empty in `.env.local`.

### ELEVENLABS_API_KEY
**Status**: ❌ **Empty string** (`""`)

[voice-gen.ts](file:///c:/Users/vashi/OneDrive/Desktop/drona-ai/src/lib/ai-clients/voice-gen.ts#L23) checks `process.env.ELEVENLABS_API_KEY`. Because this is an empty string, JavaScript treats `""` as falsy, so the code **always takes the mock fallback path** (line 26). This is by design — it generates a 45-byte stub MP3, not real audio. This is **working as intended for local dev**.

### Other Keys
| Key | Value | Effect |
|-----|-------|--------|
| `USE_REAL_VIDEO_GEN` | `"false"` | Skips real Veo video generation entirely |
| `RUNWAY_API_KEY` | `""` | Skips Runway path |
| `REPLICATE_API_TOKEN` | `""` | Skips Replicate path |
| `INNGEST_EVENT_KEY` | `""` | Inngest events will fail silently |
| `INNGEST_SIGNING_KEY` | `""` | Inngest webhook validation will fail |

---

## Step 2: Error-Swallowing try/catch Analysis

> [!CAUTION]
> **This is the #1 root cause.** Multiple catch blocks silently succeed instead of propagating failures.

### [image-gen.ts](file:///c:/Users/vashi/OneDrive/Desktop/drona-ai/src/lib/ai-clients/image-gen.ts#L71-L74) — Gemini Image Model Loop
```typescript
// Lines 71-74: Inside the for-loop trying each model
} catch (error: unknown) {
  const errMsg = error instanceof Error ? error.message : String(error);
  console.warn(`[generateShotImage] Model ${model} unavailable or rate-limited:`, errMsg);
  // ← Falls through to try the next model, then falls through to SVG fallback
}
```
**Verdict**: After BOTH models fail (429 rate limit on free tier), the function falls through to the SVG fallback (lines 78–87) and **returns a valid URL successfully**. The caller never sees an error. **This is why images are always SVG placeholders — this is intentional fallback behavior, but the user thinks "nothing is generating" because they expected real Gemini images, not placeholder SVGs.**

### [video-gen.ts](file:///c:/Users/vashi/OneDrive/Desktop/drona-ai/src/lib/ai-clients/video-gen.ts#L119-L281) — Full video path
```
Line 124: USE_REAL_VIDEO_GEN === "false"  → Skips entire Veo block
Line 220: runwayKey is ""               → Skips Runway block
Line 252: replicateToken is ""          → Skips Replicate block
Line 277: Falls through to → return sourceImageUrl (the SVG placeholder URL from image-gen)
```
**Verdict**: `generateShotVideo()` returns `sourceImageUrl` — which is the **SVG placeholder image URL from image-gen**, not a video at all. The "video" field in the database is actually an `.svg` file path. **This is why the database shows identical image and video URLs for every shot.**

### [voice-gen.ts](file:///c:/Users/vashi/OneDrive/Desktop/drona-ai/src/lib/ai-clients/voice-gen.ts#L25-L49) — Mock fallback
```typescript
if (!apiKey) {
  // Generates 45-byte mock MP3 and returns successfully
  return { audioUrl, durationSeconds: duration, wordTimestamps: timestamps };
}
```
**Verdict**: Returns a valid-looking result with a 45-byte MP3 file. No error thrown. **Audio "works" but is a tiny stub file that won't play audibly.**

### [approve-script/route.ts](file:///c:/Users/vashi/OneDrive/Desktop/drona-ai/app/api/projects/%5Bid%5D/approve-script/route.ts#L85-L87) — Per-shot catch block
```typescript
} catch (shotErr) {
  console.error(`[approve-script] Error generating assets for Shot #${shot.number}:`, shotErr);
  // ← Error logged but NOT re-thrown — loop continues, returns { success: true }
}
```
**Verdict**: If any individual shot's asset generation fails entirely, the error is logged to the server console but the API still returns `{ success: true }`. The UI will show the loading spinner finish and advance to Asset Studio, but the shot's DB fields remain `null`.

---

## Step 3: Storage Directory Check

**Status**: ✅ `public/generated/` exists and has files.

```
public/generated/audio/    — 6 .mp3 files (45 bytes each = mock stubs)
public/generated/images/   — 6 .svg files (856 bytes each = SVG placeholders)
```

[local.ts](file:///c:/Users/vashi/OneDrive/Desktop/drona-ai/src/lib/storage/local.ts#L71-L72) correctly uses `fsSync.mkdirSync(folderPath, { recursive: true })` before writing, and verifies with `fsSync.statSync()` after writing (line 79). **Storage is NOT the problem.**

> [!NOTE]
> There is no `public/generated/videos/` directory — no real video file has ever been written. All "video" URLs in the DB point to SVG image files.

---

## Step 4: Inngest Workflow Reachability

**Status**: ❌ **Inngest is completely non-functional — the workflow is NEVER reached.**

Evidence chain:

1. `.env.local` has `INNGEST_EVENT_KEY=""` and `INNGEST_SIGNING_KEY=""`.
2. The Inngest client at [src/inngest/client.ts](file:///c:/Users/vashi/OneDrive/Desktop/drona-ai/src/inngest/client.ts) has no event key or signing key configured.
3. All `inngest.send()` calls in the API routes are wrapped in try/catch that **swallows the error**:
   - [projects/route.ts L47-58](file:///c:/Users/vashi/OneDrive/Desktop/drona-ai/app/api/projects/route.ts#L47-L58): `catch (inngestErr) { console.warn(...) }`
   - [approve-topic/route.ts L68-75](file:///c:/Users/vashi/OneDrive/Desktop/drona-ai/app/api/projects/%5Bid%5D/approve-topic/route.ts#L68-L75): same pattern
   - [approve-script/route.ts L34-41](file:///c:/Users/vashi/OneDrive/Desktop/drona-ai/app/api/projects/%5Bid%5D/approve-script/route.ts#L34-L41): same pattern

4. **There is no Inngest dev server running.** The user has only `npm run dev` in their terminal (running for 8+ hours). There is no `npx inngest-cli dev` process. This means:
   - `inngest.send()` has nowhere to deliver events
   - The workflow at [generate-project.ts](file:///c:/Users/vashi/OneDrive/Desktop/drona-ai/src/inngest/functions/generate-project.ts) is registered in the codebase but **never executes**
   - The entire multi-step pipeline (verify → approve → breakdown → generate assets → render) defined in that function is dead code

**However**: The API routes were already updated to do asset generation **directly** (not via Inngest). So Inngest's non-functionality is NOT the reason assets aren't generating — the direct inline code in `approve-script/route.ts` IS running. The problem is what that code produces (see Step 2).

---

## Step 5: Inngest Dev Server Dashboard

**Status**: ❌ **No Inngest dev server is running.** There is nothing at `localhost:8288`.

There are no workflow runs to inspect because:
- No `inngest-cli dev` process exists
- No Inngest keys are configured
- All `inngest.send()` calls fail silently

---

## Summary: What's Actually Happening End-to-End

The pipeline IS executing. Here's exactly what each step produces:

| Step | What Runs | What It Produces | The Problem |
|------|-----------|-----------------|-------------|
| **Topic Analysis** | `verifyTopic()` → Gemini Flash | ✅ Real analysis report + style bible | Working correctly |
| **Script Breakdown** | `breakdownScript()` → Gemini Flash | ✅ Real shot scripts with prompts | Working correctly |
| **Image Generation** | `generateShotImage()` → Gemini 3.1 Flash Image | 856-byte SVG placeholder | Gemini free-tier image quota is **exhausted** (429). Both models return `RESOURCE_EXHAUSTED`. Fallback SVG is returned as "success". |
| **Voice Generation** | `generateVoiceover()` → Mock path | 45-byte stub MP3 | `ELEVENLABS_API_KEY` is empty. Mock path produces a file that won't play. |
| **Video Generation** | `generateShotVideo()` → Placeholder path | Returns the SVG image URL as the "video" | `USE_REAL_VIDEO_GEN=false`, no Runway key, no Replicate key. Falls through to `return sourceImageUrl`. |
| **Duration Matching** | `matchVideoDuration()` → FFmpeg | Fails with `'ffmpeg' is not recognized` | FFmpeg not installed on this Windows machine. Falls back to returning input URL unchanged. |

> [!IMPORTANT]
> ### Root Cause
> **Nothing is broken.** Everything is executing exactly as coded. The problem is that:
> 1. The Gemini free-tier image generation quota is **permanently exhausted** (0 remaining requests per day) — so every image is an SVG placeholder
> 2. No `ELEVENLABS_API_KEY` is set — so every voiceover is a 45-byte stub
> 3. No video generation API key is set and `USE_REAL_VIDEO_GEN=false` — so every "video" is actually the SVG image URL passed through
> 4. FFmpeg is not installed — so duration matching always falls back to no-op
> 5. All of these failures are **caught and produce valid-looking outputs** — so the UI shows "success" with invisible/non-functional assets
