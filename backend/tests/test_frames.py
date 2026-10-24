import asyncio
import math
import cv2
import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.frame_processing import MAX_BYTES

client = TestClient(app)
PATH = '/api/frames/process?frame_id=12&captured_at_ms=1730000000123.25'
HEADERS = {'Content-Type': 'image/jpeg'}


def jpeg(width=640, height=480, extension='.jpg'):
    ok, encoded = cv2.imencode(extension, np.zeros((height, width, 3), dtype=np.uint8))
    assert ok
    return encoded.tobytes()


def test_valid():
    body = jpeg()
    response = client.post(PATH, content=body, headers=HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data['frame_id'] == 12
    assert data['captured_at_ms'] == 1730000000123.25
    assert data['image'] == dict(width_px=640, height_px=480, channels=3, encoding='jpeg', payload_bytes=len(body))
    assert data['objects'] == []
    for key in ['processing_ms', 'received_at_ms']:
        assert math.isfinite(data[key]) and data[key] >= 0


@pytest.mark.parametrize('body,media,status,code', [
    (b'', 'image/jpeg', 400, 'EMPTY_FRAME'),
    (b'not jpeg', 'image/jpeg', 400, 'INVALID_FRAME'),
    (b'\xff\xd8\xffgarbage\xff\xd9', 'image/jpeg', 400, 'INVALID_FRAME'),
    (jpeg(), 'image/png', 415, 'UNSUPPORTED_MEDIA_TYPE'),
    (jpeg(extension='.png'), 'image/jpeg', 400, 'INVALID_FRAME'),
    (b'x' * (MAX_BYTES + 1), 'image/jpeg', 413, 'FRAME_TOO_LARGE'),
    (jpeg(1921, 10), 'image/jpeg', 413, 'FRAME_DIMENSIONS_EXCEEDED'),
    (jpeg(10, 1921), 'image/jpeg', 413, 'FRAME_DIMENSIONS_EXCEEDED'),
    (jpeg(1500, 1500), 'image/jpeg', 413, 'FRAME_DIMENSIONS_EXCEEDED'),
], ids=['empty', 'invalid', 'decode-failure', 'media-type', 'disguised-png', 'byte-limit', 'width-limit', 'height-limit', 'pixel-limit'])
def test_errors(body, media, status, code):
    response = client.post(PATH, content=body, headers={'Content-Type': media})
    assert response.status_code == status
    assert response.json()['detail']['code'] == code
    assert response.json()['detail']['message']


@pytest.mark.parametrize('length', [None, '12'])
def test_stream_limit(length):
    async def run():
        async def chunks():
            for _ in range(17):
                yield b'x' * 65536
        headers = dict(HEADERS)
        if length: headers['Content-Length'] = length
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as ac:
            request = ac.build_request('POST', PATH, content=chunks(), headers=headers)
            if length is None: assert 'content-length' not in request.headers
            response = await ac.send(request)
            assert response.status_code == 413
            assert response.json()['detail']['code'] == 'FRAME_TOO_LARGE'
    asyncio.run(run())


@pytest.mark.parametrize('query', [
    '', 'frame_id=0', 'captured_at_ms=0',
    'frame_id=-1&captured_at_ms=0', 'frame_id=0&captured_at_ms=-1',
    'frame_id=wat&captured_at_ms=0', 'frame_id=1.5&captured_at_ms=0',
    'frame_id=nan&captured_at_ms=0', 'frame_id=inf&captured_at_ms=0',
    'frame_id=0&captured_at_ms=nan', 'frame_id=0&captured_at_ms=inf',
    'frame_id=0&captured_at_ms=-inf', 'frame_id=0&captured_at_ms=wat',
])
def test_query_validation(query):
    assert client.post('/api/frames/process?' + query, content=jpeg(), headers=HEADERS).status_code == 422


def test_recovers_after_invalid_frame():
    assert client.post(PATH, content=b'bad', headers=HEADERS).status_code == 400
    assert client.post(PATH, content=jpeg(), headers=HEADERS).status_code == 200
