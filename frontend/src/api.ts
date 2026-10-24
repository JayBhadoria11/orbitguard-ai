import type { FrameResponse, Health, SessionInfo } from './types';

export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}

export async function request<T>(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 5000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json();
    if (!response.ok) {
      const detail = data.detail;
      const message = Array.isArray(detail)
        ? detail.map((item: { msg?: string }) => item.msg ?? 'Invalid request').join('; ')
        : detail?.message ?? `Backend returned HTTP ${response.status}.`;
      throw new ApiError(message, detail?.code ?? 'HTTP_ERROR', response.status);
    }
    return data as T;
  } catch (error) {
    if (timedOut) throw new Error('Backend request timed out after 5 seconds.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function checkHealth(signal: AbortSignal): Promise<Health> {
  const data = await request<Health>('/api/health', {}, signal);
  if (data.status !== 'ok' || data.service !== 'orbitguard-api' || data.phase !== 1)
    throw new Error('Unexpected backend health response.');
  return data;
}

export async function processFrame(blob: Blob, frameId: number, capturedAt: number, signal: AbortSignal, session?: SessionInfo) {
  const started = performance.now();
  const data = await request<FrameResponse>(
    `/api/frames/process?frame_id=${frameId}&captured_at_ms=${capturedAt}${session ? `&session_id=${encodeURIComponent(session.session_id)}&revision=${session.revision}` : ''}`,
    { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob }, signal,
  );
  const rtt = performance.now() - started;
  if (data.frame_id !== frameId || data.captured_at_ms !== capturedAt ||
      !Number.isFinite(data.processing_ms) || data.processing_ms < 0 ||
      !Number.isFinite(data.received_at_ms) || data.received_at_ms < 0 ||
      !Number.isInteger(data.image?.width_px) || data.image.width_px < 1 || data.image.width_px > 1920 ||
      !Number.isInteger(data.image?.height_px) || data.image.height_px < 1 || data.image.height_px > 1920 ||
      data.image.width_px * data.image.height_px > 2073600 ||
      data.image.channels !== 3 || data.image.encoding !== 'jpeg' || data.image.payload_bytes !== blob.size ||
      !Array.isArray(data.objects) || data.objects.length !== 0)
    throw new Error('Backend returned invalid frame metadata.');
  if (session && (!data.vision || data.vision.session_id !== session.session_id || data.vision.frame_id !== frameId ||
      !Number.isInteger(data.vision.revision) || data.vision.revision < session.revision ||
      data.vision.width_px !== data.image.width_px || data.vision.height_px !== data.image.height_px))
    throw new Error('Backend returned mismatched vision metadata.');
  return { data, rtt };
}

export const post = <T,>(url: string, body: unknown, signal?: AbortSignal) => request<T>(url,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, signal);
export function releaseSession(id: string) {
  // Best-effort cleanup; server TTL handles tab closure/network failure.
  void fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true }).catch(() => {});
}
