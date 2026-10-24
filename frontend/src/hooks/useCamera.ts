import { useCallback, useEffect, useRef, useState } from 'react';

const release = (stream: MediaStream | null) => stream?.getTracks().forEach(track => track.stop());
function cameraError(error: unknown) {
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission denied. Allow camera access in browser settings, then try again on localhost or HTTPS.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Selected camera is unavailable. Connect DroidCam or choose another camera.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Camera could not start. Close other apps using it and check the DroidCam connection.';
  return 'Camera capture failed. Check browser permissions and the Windows virtual webcam, then try again.';
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const selectedRef = useRef('');
  const wanted = useRef(false);
  const mounted = useRef(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState<'stopped' | 'starting' | 'active'>('stopped');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [discoveryError, setDiscoveryError] = useState('');
  const [session, setSession] = useState(0);

  const stop = useCallback(() => {
    generation.current++;
    wanted.current = false;
    release(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false); setStatus('stopped'); setSession(value => value + 1);
  }, []);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      if (!mounted.current) return;
      setDevices(inputs); setDiscoveryError('');
      if (selectedRef.current && !inputs.some(d => d.deviceId === selectedRef.current)) {
        stop(); selectedRef.current = ''; setSelected('');
        setError('Selected camera disconnected. Reconnect DroidCam or select another camera, then start again.');
      }
    } catch { if (mounted.current) setDiscoveryError('Unable to list cameras. Check browser permissions and refresh devices.'); }
  }, [stop]);

  const start = useCallback(async (deviceId = selectedRef.current) => {
    stop();
    const token = generation.current;
    wanted.current = true;
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      wanted.current = false;
      setError('Camera access is unavailable. Open this app on localhost or HTTPS in a browser with camera support.');
      return;
    }
    setStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 20 } },
      });
      if (!mounted.current || token !== generation.current) { release(stream); return; }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') throw new Error('Camera ended during startup');
      track.addEventListener('ended', () => {
        if (token !== generation.current || !mounted.current) return;
        stop(); setError('Camera disconnected or stopped unexpectedly. Check DroidCam and start the camera again.');
      }, { once: true });
      const actualId = track.getSettings().deviceId;
      if (actualId) { selectedRef.current = actualId; setSelected(actualId); }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (token !== generation.current || !mounted.current) return;
      setStatus('active');
      await refresh();
    } catch (err) {
      if (token !== generation.current || !mounted.current) return;
      stop(); setError(cameraError(err));
    }
  }, [refresh, stop]);

  const select = useCallback((id: string) => {
    const restart = wanted.current;
    selectedRef.current = id; setSelected(id);
    if (restart) void start(id); else stop();
  }, [start, stop]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => {
      mounted.current = false; generation.current++; wanted.current = false;
      release(streamRef.current); streamRef.current = null;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
    };
  }, [refresh]);

  const markReady = () => {
    const video = videoRef.current;
    if (streamRef.current && video && video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) setReady(true);
  };
  return { videoRef, devices, selected, status, ready, error, discoveryError, session, start, stop, select, refresh, markReady };
}
