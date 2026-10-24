"""Run against an already-running backend; creates an image only in memory."""
import cv2
import httpx
import numpy as np

with httpx.Client(base_url='http://127.0.0.1:8000', timeout=5) as client:
    health = client.get('/api/health')
    health.raise_for_status()
    assert health.json() == {'status': 'ok', 'service': 'orbitguard-api', 'phase': 1}
    ok, image = cv2.imencode('.jpg', np.full((240, 320, 3), 96, dtype=np.uint8))
    assert ok
    response = client.post('/api/frames/process', params={'frame_id': 42, 'captured_at_ms': 1730000000123.25},
                           content=image.tobytes(), headers={'Content-Type': 'image/jpeg'})
    response.raise_for_status()
    data = response.json()
    assert data['image']['width_px'] == 320 and data['image']['height_px'] == 240
    assert data['image']['payload_bytes'] == image.nbytes
    assert data['frame_id'] == 42 and data['captured_at_ms'] == 1730000000123.25
    assert data['objects'] == []
    print('Real HTTP health + generated JPEG: PASS', data)
