import type { SessionInfo, VisionResult } from '../types';
export function ObjectTelemetry({ vision, session }: { vision: VisionResult | null; session: SessionInfo | null }) {
  const earth = vision?.earth;
  const fmt = (value: number | undefined | null) => value == null ? '—' : value.toFixed(1);
  return <section className="panel objects"><h2>Object telemetry</h2>
    <p className="hint">Tabletop simulation — image-space measurements</p>
    <p>Calibration: {session?.profiles.map(p => p.profile_id).join(', ') || 'uncalibrated'} · revision {session?.revision ?? '—'}</p>
    <p>Earth: {earth?.status ?? (session?.profiles.some(p => p.profile_id === 'earth') ? 'awaiting fresh frame' : 'uncalibrated')}</p>
    <p>Center: {earth?.center ? `${fmt(earth.center.x)}, ${fmt(earth.center.y)} px` : '—'} · approximate radius: {earth?.radius_px != null ? `${fmt(earth.radius_px)} px` : '—'}</p>
    <p>Visible debris: {vision?.visible_count ?? '—'} · retained lost: {vision?.retained_count ?? '—'}</p>
    {!session?.profiles.length && <p>Calibrate Earth and one or two debris colors to begin measured detection.</p>}
    <div className="track-list">{[...(vision?.debris ?? []), ...(vision?.lost_tracks ?? [])].map(track => <article key={track.track_id}>
      <strong>#{track.track_id} · {track.profile_id} · {track.status}</strong>
      <p>{track.status === 'lost' ? 'Last measured position' : 'Position'}: {fmt(track.center.x)}, {fmt(track.center.y)} px</p>
      <p>vx: {fmt(track.velocity?.vx)} · vy: {fmt(track.velocity?.vy)} · speed: {fmt(track.velocity?.speed)} px/s</p>
    </article>)}</div>
    {vision?.warnings.map(warning => <p className="error" key={warning}>{warning}</p>)}
  </section>;
}
