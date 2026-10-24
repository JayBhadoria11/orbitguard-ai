"""Synthetic CPU latency benchmark; not a physical-camera performance claim."""
import json
import platform
import statistics
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from app.sessions import SessionManager
from app.detection import calibrate
from app.vision_models import ROI

image = np.full((480,640,3),20,np.uint8)
cv2.circle(image,(100,110),40,(230,70,25),-1)
cv2.circle(image,(260,150),13,(15,130,245),-1)
cv2.circle(image,(390,240),13,(15,130,245),-1)
cv2.circle(image,(480,130),12,(40,235,35),-1)
body = cv2.imencode('.jpg',image)[1].tobytes()
manager = SessionManager()
info = manager.create()
with manager.use(info.session_id) as session:
    for name, roi in [('earth',(58,68,84,84)),('debris1',(245,135,30,30)),('debris2',(466,116,28,28))]:
        session.profiles[name] = calibrate(image,ROI(x=roi[0],y=roi[1],width=roi[2],height=roi[3]),name,session.profiles)[0]
times = []
for i in range(110):
    result = manager.process(info.session_id,body,i,i*333,0,0)
    assert result.vision.earth.status == 'detected' and result.vision.visible_count == 3
    if i >= 10: times.append(result.processing_ms)
print(json.dumps({'environment':platform.platform(),'processor':platform.processor(),'python':platform.python_version(),
    'opencv':cv2.__version__,'numpy':np.__version__,'image':'640x480 synthetic JPEG, Earth + 3 tokens / 2 debris profiles',
    'warmup':10,'samples':len(times),'median_ms':statistics.median(times),'p95_ms':float(np.percentile(times,95)),
    'scope':'JPEG validation/decode + detection/tracking + metadata; excludes HTTP, capture and lock waiting'},indent=2))
