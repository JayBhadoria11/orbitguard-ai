import { afterEach, describe, expect, it, vi } from 'vitest';
import { processFrame, request } from './api';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('HTTP client', () => {
  it('sends JPEG bytes and required capture parameters with separately measured RTT', async () => {
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ frame_id: 7, captured_at_ms: 123.5, received_at_ms: 140, processing_ms: 2,
      image: { width_px: 640, height_px: 480, channels: 3, encoding: 'jpeg', payload_bytes: 4 }, objects: [] }) });
    vi.stubGlobal('fetch', fetcher);
    const result = await processFrame(blob, 7, 123.5, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledWith('/api/frames/process?frame_id=7&captured_at_ms=123.5', expect.objectContaining({ method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } }));
    expect(result.rtt).toBeGreaterThanOrEqual(0);
  });
  it.each([{ detail: { code: 'INVALID_FRAME', message: 'Bad JPEG' } }, { detail: [{ msg: 'Bad JPEG' }] }])('handles application and validation errors', async data => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => data }));
    await expect(request('/api/test')).rejects.toThrow('Bad JPEG');
  });
  it('times out a hung request after five seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))));
    const pending = expect(request('/api/test')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(5000); await pending;
  });
  it('rejects fabricated or malformed metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ frame_id: 99 }) }));
    await expect(processFrame(new Blob(), 0, 0, new AbortController().signal)).rejects.toThrow('invalid frame metadata');
  });
});
