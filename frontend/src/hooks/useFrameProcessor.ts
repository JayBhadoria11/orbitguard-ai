import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ApiError, post, processFrame, releaseSession } from '../api';
import type { Box, CalibrationPreview, FrameResponse, ProfileId, SessionInfo, SnapshotInfo } from '../types';

export function useFrameProcessor(videoRef: RefObject<HTMLVideoElement | null>, ready: boolean, cameraSession: number) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [controlError, setControlError] = useState('');
  const [notice, setNotice] = useState('Start processing, then capture a snapshot to calibrate the prop colors.');
  const [result, setResult] = useState<{ data: FrameResponse; rtt: number; updated: number; captured: number; blob: Blob } | null>(null);
  const [count, setCount] = useState(0);
  const [stale, setStale] = useState(true);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [working, setWorking] = useState(false);
  const generation = useRef(0);
  const nextId = useRef(0);
  const active = useRef(false);
  const pending = useRef<Promise<unknown> | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);
  const dimensions = useRef('');
  const timer = useRef<number | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const publishSession = (value: SessionInfo | null) => { sessionRef.current = value; setSession(value); };
  const pause = useCallback(() => {
    active.current = false; generation.current++;
    clearTimeout(timer.current); controller.current?.abort();
    setEnabled(false); setStale(true); setWorking(false);
  }, []);

  useEffect(() => { pause(); return pause; }, [ready, pause]);
  useEffect(() => {
    pause(); publishSession(null); dimensions.current = ''; setControlError('');
    setNotice('Camera session changed. Start processing and recalibrate.');
    return () => {
      pause();
      if (sessionRef.current) releaseSession(sessionRef.current.session_id);
      sessionRef.current = null;
    };
  }, [cameraSession, pause]);

  const recoverSession = (err: unknown) => {
    if (err instanceof ApiError && ['SESSION_EXPIRED', 'STALE_REVISION', 'STALE_FRAME'].includes(err.code)) {
      if (sessionRef.current) releaseSession(sessionRef.current.session_id);
      publishSession(null); setResult(null);
      setNotice('Session lost or changed. A fresh session will be created; calibration must be repeated.');
    }
  };

  const start = () => {
    if (!ready || active.current || working) return;
    active.current = true; setEnabled(true); setError(''); setStale(true);
    const token = ++generation.current;
    let resetMotion = true;
    const canvas = document.createElement('canvas');
    const current = () => active.current && generation.current === token;
    const schedule = (delay: number) => { if (current()) timer.current = window.setTimeout(() => void sample(), delay); };
    async function runSample() {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight)
        throw new Error('Camera has no usable frame. Check the camera connection.');
      controller.current = new AbortController();
      const signal = controller.current.signal;
      const size = `${video.videoWidth}x${video.videoHeight}`;
      if (dimensions.current && dimensions.current !== size) {
        if (sessionRef.current) releaseSession(sessionRef.current.session_id);
        publishSession(null); setResult(null); setStale(true);
        setNotice('Camera resolution changed. Calibration and tracks were cleared; recalibrate.');
      }
      dimensions.current = size;
      if (!sessionRef.current) {
        const created = await post<SessionInfo>('/api/sessions', {}, signal);
        if (!current()) { releaseSession(created.session_id); return; }
        publishSession(created); resetMotion = false;
      } else if (resetMotion) {
        const reset = await post<SessionInfo>(`/api/sessions/${sessionRef.current.session_id}/reset`,
          { expected_revision: sessionRef.current.revision, scope: 'tracks' }, signal);
        if (!current()) return;
        publishSession(reset); resetMotion = false;
      }
      const scale = Math.min(1, 640 / video.videoWidth, 480 / video.videoHeight);
      canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Browser cannot create a frame canvas.');
      const capturedAt = performance.now();
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const id = nextId.current++;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        value => value ? resolve(value) : reject(new Error('JPEG encoding failed. Try restarting the camera.')), 'image/jpeg', 0.7));
      if (!current()) return;
      if (blob.type !== 'image/jpeg') throw new Error('Browser did not encode a JPEG frame.');
      const response = await processFrame(blob, id, capturedAt, signal, sessionRef.current!);
      if (!current()) return;
      if (response.data.vision) {
        publishSession(response.data.vision);
        if (response.data.vision.warnings.length) setNotice(response.data.vision.warnings.join(' '));
      }
      setResult({ ...response, updated: Date.now(), captured: capturedAt, blob }); setCount(value => value + 1);
      setError(''); setStale(false);
    }
    async function sample() {
      if (!current()) return;
      if (pending.current) { schedule(50); return; }
      const started = performance.now();
      let delay = 1000 / 3;
      const task = runSample(); pending.current = task;
      try { await task; }
      catch (err) {
        if (!current()) return;
        recoverSession(err);
        setError(err instanceof Error ? err.message : 'Frame processing failed.'); setStale(true);
        delay = 2000;
      } finally {
        if (pending.current === task) pending.current = null;
        if (current()) schedule(delay === 2000 ? delay : Math.max(0, delay - (performance.now() - started)));
      }
    }
    void sample();
  };

  async function control<T>(operation: (info: SessionInfo, signal: AbortSignal) => Promise<T>): Promise<T | null> {
    pause(); setWorking(true); setControlError('');
    const token = generation.current;
    let task: Promise<T> | null = null;
    try {
      await pending.current?.catch(() => {});
      if (token !== generation.current) return null;
      if (!sessionRef.current) throw new Error('Start processing to create a session first.');
      controller.current = new AbortController();
      task = operation(sessionRef.current, controller.current.signal); pending.current = task;
      const value = await task;
      if (token !== generation.current) return null;
      return value;
    } catch (err) {
      if (token === generation.current) { recoverSession(err); setControlError(err instanceof Error ? err.message : 'Scene operation failed.'); }
      return null;
    } finally {
      if (task && pending.current === task) pending.current = null;
      if (token === generation.current) setWorking(false);
    }
  }
  const reset = async (scope: 'tracks' | 'scene') => {
    const value = await control<SessionInfo>((info, signal) => post(`/api/sessions/${info.session_id}/reset`, { expected_revision: info.revision, scope }, signal));
    if (value) { publishSession(value); setResult(null); setNotice(scope === 'scene' ? 'Scene cleared. Capture a new snapshot and recalibrate.' : 'Motion history cleared. Resume processing when ready.'); }
  };
  const snapshot = () => control<SnapshotInfo>((info, signal) => {
    if (!result || result.data.vision?.session_id !== info.session_id) throw new Error('Process a fresh frame before capturing a snapshot.');
    return post(`/api/sessions/${info.session_id}/snapshot`, { frame_id: result.data.frame_id, expected_revision: info.revision }, signal);
  });
  const preview = (frozen: SnapshotInfo, profile: ProfileId, roi: Box) => control<CalibrationPreview>((info, signal) =>
    post(`/api/sessions/${info.session_id}/calibration/preview`, { snapshot_id: frozen.snapshot_id, frame_id: frozen.frame_id, profile_id: profile, roi, expected_revision: info.revision }, signal));
  const accept = async (draft: CalibrationPreview) => {
    const value = await control<SessionInfo>((info, signal) => post(`/api/sessions/${info.session_id}/calibration/accept`, { preview_id: draft.preview_id, expected_revision: info.revision }, signal));
    if (value) { publishSession(value); setNotice(`${draft.profile.profile_id} calibrated. Select the next prop, or return to live detection.`); }
    return value;
  };
  return { enabled, error, controlError, result, count, stale, session, working, notice, start, pause, reset, snapshot, preview, accept };
}
