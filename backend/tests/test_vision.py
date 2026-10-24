import math
from concurrent.futures import ThreadPoolExecutor
import cv2
import numpy as np
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.main import app
from app.detection import calibrate, detect, hue_distance
from app.sessions import SessionManager
from app.tracking import Tracker
from app.vision_models import Box, Measurement, Point, ROI


def scene(earth=True, tokens=((260, 150), (390, 240)), green=True, size=(640, 480)):
    image = np.full((size[1], size[0], 3), 20, np.uint8)
    if earth: cv2.circle(image, (100, 110), 40, (230, 70, 25), -1)
    for xy in tokens: cv2.circle(image, xy, 13, (15, 130, 245), -1)
    if green: cv2.circle(image, (480, 130), 12, (40, 235, 35), -1)
    return image


def jpeg(image):
    return cv2.imencode('.jpg', image)[1].tobytes()


ROIS = {'earth': ROI(x=58, y=68, width=84, height=84),
        'debris1': ROI(x=245, y=135, width=30, height=30),
        'debris2': ROI(x=466, y=116, width=28, height=28)}


def profiles():
    values = {}
    for name, roi in ROIS.items(): values[name] = calibrate(scene(), roi, name, values)[0]
    return values


def test_calibration_and_measured_earth():
    values = profiles()
    earth, debris, _ = detect(scene(), values)
    assert earth.status == 'detected'
    assert earth.center.x == pytest.approx(100, abs=1)
    assert earth.center.y == pytest.approx(110, abs=1)
    assert earth.radius_px == pytest.approx(40, abs=2)
    assert len(debris) == 3
    assert detect(scene(earth=False), values)[0].status == 'not_detected'
    assert detect(scene(), {})[0].status == 'uncalibrated'


@pytest.mark.parametrize('roi', [ROI(x=0,y=0,width=8,height=8), ROI(x=630,y=470,width=20,height=20), ROI(x=2,y=2,width=2,height=2)])
def test_bad_calibration(roi):
    with pytest.raises(HTTPException): calibrate(scene(), roi, 'earth', {})


def test_mixed_hue_rejected_and_conflict_rejected():
    image = scene()
    image[80:140, 100:140] = (20, 230, 40)
    with pytest.raises(HTTPException) as error: calibrate(image, ROIS['earth'], 'earth', {})
    assert error.value.detail['code'] == 'AMBIGUOUS_COLOR'
    with pytest.raises(HTTPException) as error: calibrate(scene(), ROIS['earth'], 'debris1', profiles())
    assert error.value.detail['code'] == 'COLOR_CONFLICT'


def test_hue_wraparound():
    hsv = np.zeros((80, 80, 3), np.uint8)
    cv2.circle(hsv, (40,40), 25, (179,230,230), -1)
    hsv[20:60, 40:60, 0] = 1
    image = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    profile, mask, _ = calibrate(image, ROI(x=13,y=13,width=54,height=54), 'debris1', {})
    assert hue_distance(profile.hue_center, 0) < 2
    assert np.count_nonzero(mask) > 1700


def test_stationary_noise_and_multiple_earth_ambiguity():
    values = profiles()
    image = scene()
    for x in range(10, 600, 30): cv2.circle(image, (x,400), 1, (15,130,245), -1)
    first = detect(image, values)
    second = detect(image, values)
    assert [d.model_dump() for d in first[1]] == [d.model_dump() for d in second[1]]
    assert len(first[1]) == 3
    cv2.circle(image, (200,320), 40, (230,70,25), -1)
    assert detect(image, values)[0].status == 'ambiguous'
    assert detect(image, values, Point(x=100,y=110))[0].status == 'detected'


def test_earth_exclusion():
    values = profiles()
    image = scene(tokens=(), green=False)
    cv2.circle(image, (100,110), 8, (15,130,245), -1)
    earth, debris, _ = detect(image, values)
    assert earth.status == 'detected' and debris == []


def detection(x, y=100, profile='debris1'):
    return Measurement(profile_id=profile, center=Point(x=x,y=y), bbox=Box(x=int(x)-5,y=int(y)-5,width=10,height=10), area_px=100)


def test_irregular_time_velocity_stable_ids_and_one_to_one():
    tracker = Tracker()
    observed, _ = tracker.update([detection(100), detection(300)], 100, 640,480)
    assert [t.track_id for t in observed] == [1,2] and all(t.velocity is None for t in observed)
    observed, _ = tracker.update([detection(110), detection(310)], 300, 640,480)
    assert [t.track_id for t in observed] == [1,2]
    assert observed[0].velocity.vx == pytest.approx(50)
    observed, _ = tracker.update([detection(135), detection(335)], 800,640,480)
    assert [t.track_id for t in observed] == [1,2]
    assert observed[0].velocity.speed == pytest.approx(50)
    observed, lost = tracker.update([detection(150)], 1100,640,480)
    assert len(observed) == 1 and len(lost) == 1
    assert len({t.track_id for t in observed+lost}) == 2


def test_loss_reacquisition_expiry_and_profile_compatibility():
    tracker = Tracker()
    tracker.update([detection(100)], 0,640,480)
    observed, lost = tracker.update([], 400,640,480)
    assert not observed and lost[0].status == 'lost'
    observed, _ = tracker.update([detection(110)], 800,640,480)
    assert observed[0].track_id == 1 and observed[0].velocity is None
    observed, lost = tracker.update([detection(110,profile='debris2')], 1000,640,480)
    assert observed[0].track_id == 2 and lost[0].track_id == 1
    observed, lost = tracker.update([], 2601,640,480)
    assert observed == lost == []


def test_reset_long_gap_stale_time_and_bounds():
    tracker = Tracker()
    for i in range(30): observed, _ = tracker.update([detection(100+i)], i*100,640,480)
    assert len(observed[0].trail) == 20
    with pytest.raises(ValueError): tracker.update([], 2900,640,480)
    observed, _ = tracker.update([detection(130)], 5001,640,480)
    assert observed[0].track_id == 2 and observed[0].velocity is None
    tracker.reset()
    observed, _ = tracker.update([detection(130)], 5100,640,480)
    assert observed[0].track_id == 3 and observed[0].velocity is None
    tracker.reset()
    observed, _ = tracker.update([detection(i*10) for i in range(40)], 6000,640,480)
    assert len(observed) == 20


@pytest.fixture
def client():
    app.state.sessions = SessionManager()
    with TestClient(app) as client: yield client


def create(client): return client.post('/api/sessions').json()


def submit(client, session, frame_id=0, timestamp=0, image=None):
    return client.post('/api/frames/process', params={'frame_id':frame_id,'captured_at_ms':timestamp,
        'session_id':session['session_id'],'revision':session['revision']},
        content=jpeg(scene() if image is None else image), headers={'Content-Type':'image/jpeg'})


def freeze(client, session, frame=0):
    return client.post(f"/api/sessions/{session['session_id']}/snapshot", json={'expected_revision':session['revision'],'frame_id':frame})


def preview(client, session, frozen, name='earth', roi=None):
    return client.post(f"/api/sessions/{session['session_id']}/calibration/preview", json={
        'expected_revision':session['revision'],'snapshot_id':frozen['snapshot_id'],'frame_id':frozen['frame_id'],
        'profile_id':name,'roi':(roi or ROIS[name]).model_dump()})


def test_api_calibration_exact_snapshot_revision_and_isolation(client):
    session = create(client)
    assert submit(client, session).status_code == 200
    frozen = freeze(client, session).json()
    assert submit(client, session, 1, 300, scene(earth=False)).status_code == 200
    draft = preview(client, session, frozen).json()  # uses frame 0, not latest frame 1
    assert draft['mask_png'] and draft['contour']
    accepted = client.post(f"/api/sessions/{session['session_id']}/calibration/accept", json={'expected_revision':0,'preview_id':draft['preview_id']})
    assert accepted.status_code == 200
    assert submit(client, session,2,600).json()['detail']['code'] == 'STALE_REVISION'
    session = accepted.json()
    assert submit(client,session,2,600).json()['vision']['earth']['status'] == 'detected'
    other = create(client)
    assert submit(client,other).json()['vision']['earth']['status'] == 'uncalibrated'
    assert preview(client,other,frozen).status_code == 409


@pytest.mark.parametrize('frame,timestamp', [(0,300),(1,0),(0,0)])
def test_stale_frames_never_mutate(client,frame,timestamp):
    session = create(client); submit(client,session)
    assert submit(client,session,frame,timestamp).json()['detail']['code'] == 'STALE_FRAME'
    with app.state.sessions.use(session['session_id']) as state: assert state.last_frame == state.last_capture == 0


def test_resolution_reset_reset_scope_and_invalid_images(client):
    session = create(client); submit(client,session)
    draft = preview(client,session,freeze(client,session).json()).json()
    session = client.post(f"/api/sessions/{session['session_id']}/calibration/accept",json={'expected_revision':0,'preview_id':draft['preview_id']}).json()
    reset = client.post(f"/api/sessions/{session['session_id']}/reset",json={'expected_revision':1,'scope':'tracks'}).json()
    assert len(reset['profiles']) == 1
    response = submit(client,reset,1,300,scene(size=(320,240)))
    assert response.json()['vision']['revision'] == 3 and response.json()['vision']['profiles'] == []
    assert response.json()['vision']['warnings']
    assert submit(client,{**reset,'revision':3},2,600,np.zeros((481,640,3),np.uint8)).status_code == 413
    bad = client.post('/api/frames/process?frame_id=2&captured_at_ms=600&session_id='+session['session_id']+'&revision=3',content=b'bad',headers={'Content-Type':'image/jpeg'})
    assert bad.status_code == 400


def test_session_ttl_bounds_and_delete():
    now = [0.0]
    manager = SessionManager(max_sessions=1,ttl=10,clock=lambda:now[0])
    first = manager.create()
    with pytest.raises(HTTPException) as error: manager.create()
    assert error.value.status_code == 503
    now[0] = 11
    second = manager.create()
    with pytest.raises(HTTPException):
        with manager.use(first.session_id): pass
    manager.delete(second.session_id)
    assert len(manager.sessions) == 0


def test_snapshot_bound_reset_and_invalid_rois(client):
    session = create(client)
    for i in range(5): submit(client,session,i,i*300)
    assert freeze(client,session,0).status_code == 409
    frozen = freeze(client,session,4).json()
    body = {'expected_revision':0,'snapshot_id':frozen['snapshot_id'],'frame_id':4,'profile_id':'earth','roi':{'x':1,'y':1,'width':0,'height':5}}
    assert client.post(f"/api/sessions/{session['session_id']}/calibration/preview",json=body).status_code == 422
    with app.state.sessions.use(session['session_id']) as state: assert len(state.recent_frames) == 2
    client.post(f"/api/sessions/{session['session_id']}/reset",json={'expected_revision':0,'scope':'scene'})
    assert client.get(f"/api/sessions/{session['session_id']}/snapshot/{frozen['snapshot_id']}").status_code == 404


def test_concurrent_reset_and_frame_are_serialized(client):
    session = create(client); submit(client,session)
    def frame(): return submit(client,session,1,300).status_code
    def reset(): return client.post(f"/api/sessions/{session['session_id']}/reset",json={'expected_revision':0,'scope':'tracks'}).status_code
    with ThreadPoolExecutor(2) as pool:
        a,b = pool.submit(frame),pool.submit(reset)
        assert a.result() in (200,409) and b.result() == 200
    assert submit(client,session,2,600).status_code == 409
