import { useEffect, useState } from 'react';
import { checkHealth } from './api';
import { useCamera } from './hooks/useCamera';
import { useFrameProcessor } from './hooks/useFrameProcessor';

export default function App() {
  const camera = useCamera();
  const frames = useFrameProcessor(camera.videoRef, camera.ready, camera.session);
  const [health, setHealth] = useState('Checking');
  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    const poll = async () => {
      try { await checkHealth(controller.signal); if (!controller.signal.aborted) setHealth('Connected'); }
      catch { if (!controller.signal.aborted) setHealth('Unavailable'); }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, 5000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  const result = frames.result;
  const metadata = result?.data;
  const stopCamera = () => { frames.pause(); camera.stop(); };
  return <main>
    <header><div><p className="eyebrow">NAKSHATRA / CAMERA SYSTEMS LAB</p><h1>ORBITGUARD <span>AI</span></h1>
      <p>Webcam laboratory demonstration — Phase 1</p></div><span className="badge">FOUNDATION & WEBCAM</span></header>
    <div className="statusbar" aria-live="polite">
      <span>Backend: <strong>{frames.error ? 'Unavailable for frame processing' : health}</strong></span>
      <span>Camera: <strong>{camera.status}{camera.status === 'active' && !camera.ready ? ' · waiting for frame' : ''}</strong></span>
      <span>Processing: <strong>{frames.enabled ? (frames.error ? 'Retrying in 2 seconds' : 'Running') : 'Paused'}</strong></span>
    </div>
    <div className="dashboard">
      <section className="panel camera-panel" aria-label="Camera preview">
        <div className="panel-title"><h2>Camera feed</h2><span>ORIGINAL / UNMIRRORED</span></div>
        <div className="preview">
          <video ref={camera.videoRef} autoPlay playsInline muted onLoadedData={camera.markReady} onCanPlay={camera.markReady} />
          {camera.status !== 'active' && <div className="placeholder"><span className="reticle">＋</span><strong>{camera.status === 'starting' ? 'Waiting for camera permission…' : 'Camera is off'}</strong><p>Connect DroidCam or use your laptop camera.</p></div>}
        </div>
        <div className="camera-controls"><label htmlFor="camera">Camera input</label><div className="selection"><select id="camera" value={camera.selected} onChange={event => { frames.pause(); camera.select(event.target.value); }}>
          <option value="">Default camera</option>{camera.devices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}> {device.label || `Camera ${index + 1} (allow permission for label)`}</option>)}
        </select><button onClick={() => void camera.refresh()}>Refresh devices</button></div>
        <div className="buttons"><button className="primary" disabled={camera.status !== 'stopped'} onClick={() => void camera.start()}>Start camera</button>
          <button disabled={camera.status === 'stopped'} onClick={stopCamera}>Stop camera</button>
          <button className="primary" disabled={!camera.ready || frames.enabled} onClick={frames.start}>Start processing</button>
          <button disabled={!frames.enabled} onClick={frames.pause}>Pause processing</button></div>
        {camera.error && <p role="alert" className="error">{camera.error}</p>}{camera.discoveryError && <p role="alert" className="error">{camera.discoveryError}</p>}
        <p className="hint">DroidCam missing? Connect phone and laptop on the same Wi-Fi and enable the Windows virtual webcam. Verify it in Windows Camera, close that app, then refresh devices. Labels appear after permission; select the actual device label.</p>
        </div>
      </section>
      <aside>
        <section className="panel"><div className="panel-title"><h2>Frame telemetry</h2><span>{result ? (frames.stale ? 'STALE' : 'LATEST SUCCESS') : 'AWAITING DATA'}</span></div>
          <div className="counter"><strong>{frames.count}</strong><span>successful frames · page session</span></div>
          <dl>
            <dt>Last frame ID</dt><dd>{metadata?.frame_id ?? '—'}</dd>
            <dt>Decoded dimensions</dt><dd>{metadata ? `${metadata.image.width_px} × ${metadata.image.height_px} pixels` : '—'}</dd>
            <dt>JPEG payload</dt><dd>{metadata ? `${metadata.image.payload_bytes.toLocaleString()} bytes` : '—'}</dd>
            <dt>Backend processing</dt><dd>{metadata ? `${metadata.processing_ms.toFixed(2)} ms` : '—'}</dd>
            <dt>HTTP round-trip</dt><dd>{result ? `${result.rtt.toFixed(1)} ms` : '—'}</dd>
            <dt>Last successful update</dt><dd>{result ? new Date(result.updated).toLocaleTimeString() : 'Never'}</dd>
            <dt>Health endpoint</dt><dd>{health}</dd>
          </dl>
          {frames.error && <p role="alert" className="error">{frames.error} Preview remains active. Processing will retry while enabled.</p>}
          <p className="hint">Up to 640 × 480 · JPEG 0.7 · target 3 frames/s · one request at a time</p>
        </section>
        <section className="panel objects"><h2>Object information</h2><p>Detection and tracking will be added in Phase 2. No objects are being detected yet.</p></section>
      </aside>
    </div>
    <footer>Keep the webcam stationary. Use a well-lit, high-contrast background for later tracking phases.<br/><span>Local image decoding only. Frames are not stored. This is not real space-debris detection.</span></footer>
  </main>;
}
