import type { VisionResult, TrackResult } from '../types';
export const measuredTrack: TrackResult = { track_id: 1, profile_id: 'debris1', status: 'observed', center: { x: 200, y: 100 }, bbox: { x: 190, y: 90, width: 20, height: 20 }, area_px: 300, last_seen_ms: 0, velocity: null, trail: [{ x: 200, y: 100 }] };
export function makeVision(overrides: Partial<VisionResult> = {}): VisionResult {
  return { session_id: 'session-1', revision: 0, profiles: [], width_px: 640, height_px: 480, frame_id: 0,
    earth: { status: 'uncalibrated', center: null, radius_px: null, bbox: null }, debris: [], lost_tracks: [],
    visible_count: 0, retained_count: 0, calibration_status: 'uncalibrated', warnings: [], ...overrides };
}
