export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x,y,z,w
export type Side = "Left" | "Right";
export interface Point {
  x: number;
  y: number;
  z: number;
}
export interface RawHand {
  side: Side;
  score: number;
  landmarks: Point[];
  world: Point[];
}
export interface HandFeature {
  side: Side;
  score: number;
  shape: number[];
  quaternion: Quat;
  forward: Vec3;
  normal: Vec3;
  radial: Vec3;
  wrist: Vec3;
  curls: number[];
  spread: number;
  roll: number;
  elevation: number;
  landmarks: Point[];
  world: Point[];
}
export interface Frame {
  t: number;
  hands: HandFeature[];
}
export interface Sample {
  id: string;
  labelId: string;
  label: string;
  createdAt: string;
  sessionId: string;
  durationMs: number;
  frames: Frame[];
  schema: 1;
  videoBlob?: Blob;
  videoMime?: string;
  aspect?: number;
  trackingVariant?: "lite" | "full";
}
export interface VocabularyEntry {
  id: string;
  label: string;
  group: string;
  level: number;
  aliases: string[];
  definition: string;
  status: string;
}
export interface Match {
  labelId: string;
  label: string;
  distance: number;
  score: number;
  samples: number;
}
export interface Recognition {
  accepted: boolean;
  reason: string;
  matches: Match[];
}
