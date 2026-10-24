import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { useFrameProcessor } from '../hooks/useFrameProcessor';
import type { Box, CalibrationPreview, Point, ProfileId, SnapshotInfo } from '../types';
import { imagePoint, selectionBox } from '../geometry';
import { VisionOverlay } from './VisionOverlay';

export function CalibrationPanel({ frames }: { frames: ReturnType<typeof useFrameProcessor> }) {
  const [snapshot, setSnapshot] = useState<SnapshotInfo | null>(null);
  const [roi, setROI] = useState<Box>({ x: 0, y: 0, width: 0, height: 0 });
  const [profile, setProfile] = useState<ProfileId>('earth');
  const [draft, setDraft] = useState<CalibrationPreview | null>(null);
  const [url, setUrl] = useState('');
  const drag = useRef<Point | null>(null);
  useEffect(() => { setSnapshot(null); setDraft(null); }, [frames.session?.session_id, frames.session?.width_px, frames.session?.height_px]);
  useEffect(() => { setDraft(null); }, [frames.session?.revision]);
  useEffect(() => {
    if (!frames.result) { setUrl(''); return; }
    const value = URL.createObjectURL(frames.result.blob); setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [frames.result]);
  const capture = async () => {
    const frozen = await frames.snapshot();
    if (frozen) { setSnapshot(frozen); setDraft(null); setROI({ x: 0, y: 0, width: 0, height: 0 }); }
  };
  const pointer = (event: PointerEvent<SVGSVGElement>, clamp = false) => {
    if (!snapshot) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    return imagePoint({ x: event.clientX, y: event.clientY }, { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, snapshot.width_px, snapshot.height_px, clamp);
  };
  const changeROI = (value: Box) => { setROI(value); setDraft(null); };
  return <section className="panel calibration">
    <div className="panel-title"><h2>Phase 2 · Calibrate the scene</h2><span>FROZEN SELECTION</span></div>
    <p>Use a matte blue Earth ball, orange and bright green debris props on a dark neutral background. Colors define the simulation classes; hands and unsupported objects are not recognized semantically.</p>
    <p className="hint">Start camera and processing → capture a processed snapshot → draw tightly around Earth → preview mask → accept. Repeat for one or two debris colors. The live camera remains available above.</p>
    <div className="buttons">
      <button disabled={!frames.result || !frames.session || frames.working} onClick={() => void capture()}>Capture calibration snapshot</button>
      <button disabled={!frames.session || frames.working} onClick={() => void frames.reset('tracks')}>Reset tracks</button>
      <button disabled={!frames.session || frames.working} onClick={() => { setSnapshot(null); setDraft(null); void frames.reset('scene'); }}>Reset scene</button>
    </div>
    <p role="status" className="hint">{frames.working ? 'Updating scene…' : frames.notice}</p>
    {frames.controlError && <p role="alert" className="error">{frames.controlError}</p>}
    {snapshot && <div className="calibration-workspace">
      <p>Frozen frame #{snapshot.frame_id} · {snapshot.width_px} × {snapshot.height_px} pixels</p>
      <div className="snapshot-image" style={{ aspectRatio: `${snapshot.width_px}/${snapshot.height_px}` }}>
        <img alt={`Calibration snapshot frame ${snapshot.frame_id}`} src={`/api/sessions/${snapshot.session_id}/snapshot/${snapshot.snapshot_id}`} />
        {draft && <img className="mask-preview" alt="Extracted color mask" src={`data:image/png;base64,${draft.mask_png}`} />}
        <svg aria-label="Draw calibration rectangle" className="roi-selector" viewBox={`0 0 ${snapshot.width_px} ${snapshot.height_px}`} preserveAspectRatio="xMidYMid meet"
          onPointerDown={event => { if (frames.working) return; const point = pointer(event); if (point) { drag.current = point; event.currentTarget.setPointerCapture?.(event.pointerId); changeROI(selectionBox(point, point)); } }}
          onPointerMove={event => { if (drag.current) { const point = pointer(event, true); if (point) changeROI(selectionBox(drag.current, point)); } }}
          onPointerUp={event => { if (drag.current) { const point = pointer(event, true); if (point) changeROI(selectionBox(drag.current, point)); drag.current = null; } }}
          onPointerCancel={() => { drag.current = null; }}>
          <rect {...roi} fill="rgba(255,255,255,.06)" stroke="#fff" strokeWidth="1.5" />
          {draft && <polygon points={draft.contour.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#80ffaf" strokeWidth="2" />}
        </svg>
      </div>
      <div className="roi-fields"><label>Profile<select value={profile} disabled={frames.working} onChange={event => { setProfile(event.target.value as ProfileId); setDraft(null); }}>
        <option value="earth">Earth</option><option value="debris1">Debris color 1</option><option value="debris2">Debris color 2</option>
      </select></label>
      {(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key} (px)<input type="number" min="0" step="1" value={roi[key]} disabled={frames.working} onChange={event => changeROI({ ...roi, [key]: Math.max(0, Math.round(Number(event.target.value))) })} /></label>)}</div>
      <div className="buttons"><button disabled={!roi.width || !roi.height || frames.working} onClick={async () => setDraft(await frames.preview(snapshot, profile, roi))}>Preview color mask</button>
        <button disabled={!draft || frames.working} onClick={async () => { if (draft && await frames.accept(draft)) setDraft(null); }}>Accept calibration</button>
        <button disabled={frames.working} onClick={() => { setSnapshot(null); setDraft(null); frames.start(); }}>Return to live detection</button></div>
      {draft && <p className="hint">Green contour and tinted mask show the measured selection. Accept only if they isolate the intended prop. Hue center {draft.profile.hue_center.toFixed(1)} ± {draft.profile.hue_half_width.toFixed(1)} (OpenCV 0–179).</p>}
    </div>}
    {!snapshot && url && frames.result && <details><summary>Last processed frame · exact image/results pair</summary>
      <p className="hint">Historical frame #{frames.result.data.frame_id}. This view is not a current measurement.</p>
      <div className="snapshot-image" style={{ aspectRatio: `${frames.result.data.image.width_px}/${frames.result.data.image.height_px}` }}>
        <img src={url} alt="Last successfully processed frame" />
        {frames.result.data.vision && <VisionOverlay vision={frames.result.data.vision} />}
      </div>
    </details>}
  </section>;
}
