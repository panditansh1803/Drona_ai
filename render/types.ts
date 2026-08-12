export interface CaptionCue {
  text: string;
  start: number;
  end: number;
}

export interface RenderShot {
  id: string;
  number: number;
  videoUrl: string;
  audioUrl?: string;
  durationSeconds: number;
  captionCues?: CaptionCue[];
}

export interface CompositionProps {
  shots?: RenderShot[];
  fps?: number;
}
