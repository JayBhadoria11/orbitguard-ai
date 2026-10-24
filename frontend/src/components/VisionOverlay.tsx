import { useId } from 'react';
import type { VisionResult } from '../types';

export function VisionOverlay({ vision, live = false }: { vision: VisionResult; live?: boolean }) {
  const clip = useId();
  const width = vision.width_px!, height = vision.height_px!;
  const earth = vision.earth;
  const label = (x: number, y: number, text: string, color: string) => <text x={Math.max(2, Math.min(width - 125, x))} y={Math.max(13, Math.min(height - 3, y))} fill={color}>{text}</text>;
  return <svg aria-label={live ? 'Live measured overlays' : 'Recorded frame measurements'} className={`vision-overlay ${live ? 'live-overlay' : ''}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
    <defs><clipPath id={clip}><rect width={width} height={height} /></clipPath>
      <marker id={`${clip}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10" fill="none" stroke="#e8f5c9" strokeWidth="2" /></marker></defs>
    <g clipPath={`url(#${clip})`} fill="none" strokeWidth="2">
      {earth.status === 'detected' && earth.center && earth.radius_px !== null && <g stroke="#6acbff">
        <circle cx={earth.center.x} cy={earth.center.y} r={earth.radius_px} />
        <path d={`M${earth.center.x-4},${earth.center.y}h8 M${earth.center.x},${earth.center.y-4}v8`} />
        {label(earth.center.x-earth.radius_px, earth.center.y-earth.radius_px-7, 'Earth — simulated', '#6acbff')}
      </g>}
      {vision.debris.filter(track => track.status === 'observed').map(track => <g key={track.track_id} stroke={track.profile_id === 'debris1' ? '#ffbb69' : '#9ae787'}>
        <rect x={track.bbox.x} y={track.bbox.y} width={track.bbox.width} height={track.bbox.height} />
        <circle cx={track.center.x} cy={track.center.y} r="2" />
        <polyline points={track.trail.map(p => `${p.x},${p.y}`).join(' ')} strokeOpacity=".7" />
        {track.velocity && track.velocity.speed > 1 && <line markerEnd={`url(#${clip}-arrow)`} x1={track.center.x} y1={track.center.y} x2={track.center.x+track.velocity.vx*0.25} y2={track.center.y+track.velocity.vy*0.25} />}
        {label(track.bbox.x, track.bbox.y-6, `#${track.track_id} ${track.profile_id}`, track.profile_id === 'debris1' ? '#ffbb69' : '#9ae787')}
      </g>)}
    </g>
  </svg>;
}
