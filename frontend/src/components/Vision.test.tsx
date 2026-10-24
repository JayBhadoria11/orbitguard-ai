import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ObjectTelemetry } from './ObjectTelemetry';
import { VisionOverlay } from './VisionOverlay';
import { makeVision, measuredTrack } from '../test/visionFixture';
it('renders measured telemetry with unavailable velocity and separately retained tracks', () => {
  const vision = makeVision({ debris: [measuredTrack], visible_count: 1, retained_count: 1,
    lost_tracks: [{...measuredTrack,track_id:2,status:'lost'}] });
  render(<ObjectTelemetry vision={vision} session={vision} />);
  expect(screen.getAllByText('vx: — · vy: — · speed: — px/s')).toHaveLength(2);
  expect(screen.getByText('Visible debris: 1 · retained lost: 1')).toBeInTheDocument();
  expect(screen.getByText('Last measured position: 200.0, 100.0 px')).toBeInTheDocument();
});
it('draws only observed tracks using the image viewBox and no velocity arrow for new tracks', () => {
  const vision = makeVision({ debris:[measuredTrack],lost_tracks:[{...measuredTrack,track_id:2,status:'lost'}] });
  const { container } = render(<VisionOverlay vision={vision} live />);
  expect(screen.getByLabelText('Live measured overlays')).toHaveAttribute('viewBox','0 0 640 480');
  expect(screen.getByText('#1 debris1')).toBeInTheDocument();
  expect(screen.queryByText('#2 debris1')).not.toBeInTheDocument();
  expect(container.querySelector('line')).toBeNull();
});
