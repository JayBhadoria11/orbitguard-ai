"""Real HTTP synthetic scene check. Start uvicorn first; optional base URL argument."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
from test_vision import create, submit, freeze, preview, scene, ROIS

with httpx.Client(base_url=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8000', timeout=5) as client:
    assert client.get('/api/health').status_code == 200
    session = create(client)
    try:
        assert submit(client,session).status_code == 200
        frozen = freeze(client,session).json()
        for name in ROIS:
            draft_response = preview(client,session,frozen,name)
            draft_response.raise_for_status()
            draft = draft_response.json()
            response = client.post(f"/api/sessions/{session['session_id']}/calibration/accept",json={
                'expected_revision':session['revision'],'preview_id':draft['preview_id']})
            response.raise_for_status()
            session = response.json()
        result = submit(client,session,1,300).json()
        assert result['vision']['earth']['status'] == 'detected' and result['vision']['visible_count'] == 3
        assert all(t['velocity'] is None for t in result['vision']['debris'])
        result = submit(client,session,2,650,scene(tokens=((270,150),(400,240)))).json()
        assert result['vision']['debris'][0]['velocity']['vx'] > 20
        assert submit(client,session,3,1000,scene(earth=False)).json()['vision']['earth']['status'] == 'not_detected'
        print('PASS: real HTTP sessions, exact-frame calibration for Earth + two debris profiles, measured detections, motion and Earth absence.')
    finally:
        client.delete(f"/api/sessions/{session['session_id']}")
