export interface Shot {
  /** Unique identifier for the shot */
  id: string;
  /** Display number, e.g. 1, 2, 3 */
  number: number;
  /** Narration script text */
  text: string;
  /** Duration in seconds */
  durationSeconds: number;
  /** Rich visual description prompt for image generation */
  imagePrompt?: string;
  /** Camera motion direction for video generation */
  videoPrompt?: string;
  /** Exact voiceover text for TTS voice generation */
  voiceoverPrompt?: string;

  /** Generated asset URLs */
  generatedImageUrl?: string | null;
  generatedVideoUrl?: string | null;
  generatedVoiceoverUrl?: string | null;
}
