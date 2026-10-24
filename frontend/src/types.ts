export interface Health { status: 'ok'; service: 'orbitguard-api'; phase: 1 }
export interface FrameResponse {
  frame_id: number; captured_at_ms: number; received_at_ms: number; processing_ms: number;
  image: { width_px: number; height_px: number; channels: 3; encoding: 'jpeg'; payload_bytes: number };
  objects: never[];
  vision?: VisionResult | null;
}

export type ProfileId = 'earth' | 'debris1' | 'debris2';
export interface Point { x: number; y: number }
export interface Box extends Point { width: number; height: number }
export interface Velocity { vx: number; vy: number; speed: number }
export interface ProfileInfo { profile_id: ProfileId; hue_center: number; hue_half_width: number; saturation_min: number; value_min: number; reference_area_px: number }
export interface SessionInfo { session_id: string; revision: number; profiles: ProfileInfo[]; width_px: number | null; height_px: number | null }
export interface TrackResult { track_id: number; profile_id: ProfileId; status: 'observed' | 'lost'; center: Point; bbox: Box; area_px: number; last_seen_ms: number; velocity: Velocity | null; trail: Point[] }
export interface EarthResult { status: 'uncalibrated' | 'detected' | 'not_detected' | 'ambiguous'; center: Point | null; radius_px: number | null; bbox: Box | null }
export interface VisionResult extends SessionInfo { frame_id: number; earth: EarthResult; debris: TrackResult[]; lost_tracks: TrackResult[]; visible_count: number; retained_count: number; calibration_status: 'uncalibrated' | 'partial' | 'ready'; warnings: string[] }
export interface SnapshotInfo { session_id: string; snapshot_id: string; frame_id: number; revision: number; width_px: number; height_px: number }
export interface CalibrationPreview { preview_id: string; snapshot_id: string; frame_id: number; revision: number; profile: ProfileInfo; mask_png: string; contour: Point[] }
