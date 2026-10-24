import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { processFrame } from '../api';
import type { FrameResponse } from '../types';

export function useFrameProcessor(videoRef: RefObject<HTMLVideoElement | null>, ready: boolean, cameraSession: number) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ data: FrameResponse; rtt: number; updated: number } | null>(null);
  const [count, setCount] = useState(0);
  const [stale, setStale] = useState(true);
  const generation = useRef(0);
  const nextId = useRef(0);
  const active = useRef(false);
  const busy = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const pause = useCallback(() => {
    active.current = false; generation.current++;
    clearTimeout(timer.current); controller.current?.abort();
    setEnabled(false); setStale(true);
  }, []);

  useEffect(() => { pause(); return pause; }, [ready, cameraSession, pause]);

  const start = useCallback(() => {
    if (!ready || active.current) return;
    active.current = true; setEnabled(true); setError(''); setStale(true);
    const token = ++generation.current;
    const canvas = document.createElement('canvas');
    const current = () => active.current && generation.current === token;
    const schedule = (delay: number) => { if (current()) timer.current = window.setTimeout(() => void sample(), delay); };
    async function sample() {
      if (!current()) return;
      // A previous generation may still be completing toBlob or aborting fetch.
      if (busy.current) { schedule(50); return; }
      busy.current = true;
      const started = performance.now();
      let delay = 1000 / 3;
      try {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight)
          throw new Error('Camera has no usable frame. Check the camera connection.');
        const scale = Math.min(1, 640 / video.videoWidth, 480 / video.videoHeight);
        canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Browser cannot create a frame canvas.');
        const capturedAt = performance.timeOrigin + performance.now();
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const id = nextId.current++;
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
          value => value ? resolve(value) : reject(new Error('JPEG encoding failed. Try restarting the camera.')),
          'image/jpeg', 0.7,
        ));
        if (!current()) return;
        if (blob.type !== 'image/jpeg') throw new Error('Browser did not encode a JPEG frame.');
        controller.current = new AbortController();
        const response = await processFrame(blob, id, capturedAt, controller.current.signal);
        if (!current()) return;
        setResult({ ...response, updated: Date.now() }); setCount(value => value + 1);
        setError(''); setStale(false);
      } catch (err) {
        if (!current()) return;
        setError(err instanceof Error ? err.message : 'Frame processing failed.'); setStale(true);
        delay = 2000;
      } finally {
        busy.current = false;
        if (current()) schedule(delay === 2000 ? delay : Math.max(0, delay - (performance.now() - started)));
      }
    }
    void sample();
  }, [ready, videoRef]);
  return { enabled, error, result, count, stale, start, pause };
}
