export interface Health { status: 'ok'; service: 'orbitguard-api'; phase: 1 }
export interface FrameResponse {
  frame_id: number; captured_at_ms: number; received_at_ms: number; processing_ms: number;
  image: { width_px: number; height_px: number; channels: 3; encoding: 'jpeg'; payload_bytes: number };
  objects: never[];
}
