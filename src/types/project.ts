import { z } from "zod";
import type {
  Project as PrismaProject,
  Shot as PrismaShot,
} from "@prisma/client";

export const PROJECT_STATUSES = [
  "DRAFT",
  "ANALYZING",
  "AWAITING_APPROVAL",
  "SCRIPT_GENERATION",
  "AWAITING_SCRIPT_APPROVAL",
  "ASSET_GENERATION_IN_PROGRESS",
  "READY_FOR_REVIEW",
  "RENDERING",
  "COMPLETE",
  "FAILED",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ProjectStatusZodSchema = z.enum(PROJECT_STATUSES);

export interface StyleBible {
  visual_style: string;
  color_palette: string;
  tone: string;
  recurring_motifs: string;
  visualStyle?: string;
  colorPalette?: string;
  recurringMotifs?: string;
}

export interface ProjectAnalysis {
  accurate?: boolean;
  report: string;
  suggestions: string[] | string;
  style_bible?: StyleBible;
  render_error?: string;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface CaptionCue {
  text: string;
  start: number;
  end: number;
}

export interface ShotModel {
  shot_id: string;
  project_id: string;
  number: number;
  text: string;
  duration_seconds: number;
  image_prompt?: string | null;
  generated_image_url?: string | null;
  video_prompt?: string | null;
  generated_video_url?: string | null;
  voiceover_prompt?: string | null;
  generated_voiceover_url?: string | null;
  voiceover_duration_seconds?: number | null;
  word_timestamps?: WordTimestamp[] | null;
  caption_cues?: CaptionCue[] | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface ProjectModel {
  project_id: string;
  status: ProjectStatus | string;
  topic_name: string;
  analysis?: ProjectAnalysis | null;
  shots?: ShotModel[];
  final_video_url?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export type PrismaProjectStatus = ProjectStatus;
export type { PrismaProject, PrismaShot };
