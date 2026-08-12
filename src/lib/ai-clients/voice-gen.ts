import { saveGeneratedFile } from "@/src/lib/storage/local";
import { getEnvVar } from "@/src/lib/env";

export class VoiceGenError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(`VoiceGen Error: ${message}`);
    this.name = "VoiceGenError";
  }
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface VoiceoverResult {
  audioUrl: string;
  durationSeconds: number;
  wordTimestamps: WordTimestamp[];
}

export async function generateVoiceover(text: string): Promise<VoiceoverResult> {
  const apiKey = getEnvVar("ELEVENLABS_API_KEY", false);

  if (!apiKey) {
    console.log(`[VoiceGen Dev Fallback] ELEVENLABS_API_KEY missing. Generating mock audio file for "${text.slice(0, 40)}..."`);
    const words = text.split(/\s+/).filter(Boolean);
    const duration = Math.max(5, Math.round((words.length / 2.5) * 100) / 100);
    const timestamps = words.map((w, idx) => ({
      word: w,
      start: Math.round((idx * 0.4) * 100) / 100,
      end: Math.round(((idx + 1) * 0.4) * 100) / 100,
    }));

    const mockAudioBase64 = "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA";
    const audioBuffer = Buffer.from(mockAudioBase64, "base64");
    const fileName = `voice_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;
    const audioUrl = await saveGeneratedFile(audioBuffer, fileName, "audio", "audio/mp3");

    console.log(
      `[VoiceGen Success (Mock Saved)] Text: "${text.slice(0, 60)}..." | URL: ${audioUrl} | Duration: ${duration}s`
    );

    return {
      audioUrl,
      durationSeconds: duration,
      wordTimestamps: timestamps,
    };
  }

  const voiceId = "21m00Tcm4TlvDq8ikWAM"; // Rachel voice ID

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new VoiceGenError(`ElevenLabs API failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      audio_base64?: string;
      alignment?: {
        characters: string[];
        character_start_times_seconds: number[];
        character_end_times_seconds: number[];
      };
    };

    if (!data.audio_base64) {
      throw new VoiceGenError("ElevenLabs API returned no audio data");
    }

    const audioBuffer = Buffer.from(data.audio_base64, "base64");
    const fileName = `voice_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;
    const audioUrl = await saveGeneratedFile(audioBuffer, fileName, "audio", "audio/mp3");
    
    const wordTimestamps: WordTimestamp[] = [];
    let durationSeconds = 0;

    if (data.alignment && Array.isArray(data.alignment.characters)) {
      const { characters, character_start_times_seconds, character_end_times_seconds } = data.alignment;

      let currentWord = "";
      let wordStart = 0;
      let wordEnd = 0;

      for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        const start = character_start_times_seconds[i] ?? 0;
        const end = character_end_times_seconds[i] ?? 0;

        if (end > durationSeconds) {
          durationSeconds = end;
        }

        if (/\s/.test(char)) {
          if (currentWord.length > 0) {
            wordTimestamps.push({
              word: currentWord,
              start: Math.round(wordStart * 100) / 100,
              end: Math.round(wordEnd * 100) / 100,
            });
            currentWord = "";
          }
        } else {
          if (currentWord.length === 0) {
            wordStart = start;
          }
          currentWord += char;
          wordEnd = end;
        }
      }

      if (currentWord.length > 0) {
        wordTimestamps.push({
          word: currentWord,
          start: Math.round(wordStart * 100) / 100,
          end: Math.round(wordEnd * 100) / 100,
        });
      }
    }

    if (durationSeconds === 0) {
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      durationSeconds = Math.max(3, Math.round((wordCount / 2.5) * 100) / 100);
    }

    const finalDuration = Math.round(durationSeconds * 100) / 100;

    console.log(
      `[VoiceGen Success] Text: "${text.slice(0, 60)}..." | URL: ${audioUrl} | Duration: ${finalDuration}s`
    );

    return {
      audioUrl,
      durationSeconds: finalDuration,
      wordTimestamps,
    };
  } catch (error) {
    if (error instanceof VoiceGenError) throw error;
    throw new VoiceGenError("Failed to generate voiceover via ElevenLabs", error);
  }
}
