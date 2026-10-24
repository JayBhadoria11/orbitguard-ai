"""Application-owned single-worker session storage. No frame data touches disk."""
import base64
from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass, field
from threading import Lock
from time import monotonic
from uuid import uuid4
import cv2
from .detection import calibrate, detect
from .frame_processing import process_frame, reject
from .tracking import Tracker
from .vision_config import MAX_SESSIONS, SESSION_TTL, MAX_VISION_WIDTH, MAX_VISION_HEIGHT, LOST_RETENTION_MS
from .vision_models import SessionInfo, VisionResult, SnapshotInfo, CalibrationPreview


@dataclass
class Session:
    session_id: str
    activity: float
    lock: Lock = field(default_factory=Lock)
    users: int = 0
    closed: bool = False
    revision: int = 0
    profiles: dict = field(default_factory=dict)
    tracker: Tracker = field(default_factory=Tracker)
    last_frame: int = -1
    last_capture: float = -1
    dimensions: tuple | None = None
    recent_frames: deque = field(default_factory=lambda: deque(maxlen=2))
    snapshot: tuple | None = None
    draft: CalibrationPreview | None = None
    earth_position: object = None
    earth_time: float = -1

    def info(self):
        return SessionInfo(session_id=self.session_id, revision=self.revision,
                           profiles=list(self.profiles.values()),
                           width_px=self.dimensions[0] if self.dimensions else None,
                           height_px=self.dimensions[1] if self.dimensions else None)

    def check_revision(self, revision):
        if revision != self.revision:
            reject(409, 'STALE_REVISION', 'Scene revision changed. Discard old results and create a fresh session if recovery is needed.')

    def reset(self, scene=False):
        self.revision += 1
        self.tracker.reset()
        self.earth_position = None
        self.draft = None
        if scene:
            self.profiles.clear()
            self.snapshot = None
            self.recent_frames.clear()

    def frame(self, body, frame_id, captured_at_ms, received_at_ms, revision):
        self.check_revision(revision)
        if frame_id <= self.last_frame or captured_at_ms <= self.last_capture:
            reject(409, 'STALE_FRAME', 'Frame ID and capture timestamp must both strictly increase within this session.')

        def analyze(image):
            height, width = image.shape[:2]
            if width > MAX_VISION_WIDTH or height > MAX_VISION_HEIGHT:
                reject(413, 'VISION_DIMENSIONS_EXCEEDED', 'Sample Phase 2 frames within 640 × 480 pixels.')
            warnings = []
            if self.dimensions and self.dimensions != (width, height):
                self.reset(scene=True)
                warnings.append('Resolution changed. Calibration and tracks were cleared; recalibrate the scene.')
            self.dimensions = (width, height)
            recent = self.earth_position if captured_at_ms - self.earth_time <= LOST_RETENTION_MS else None
            earth, detections, notes = detect(image, self.profiles, recent)
            if earth.center is not None:
                self.earth_position, self.earth_time = earth.center, captured_at_ms
            observed, lost = self.tracker.update(detections, captured_at_ms, width, height)
            if len(observed) < len(detections):
                warnings.append('Track capacity reached; wait for lost tracks to expire or reset tracks.')
            self.last_frame, self.last_capture = frame_id, captured_at_ms
            self.recent_frames.append((frame_id, image, body))
            status = 'ready' if 'earth' in self.profiles and len(self.profiles) >= 2 else ('partial' if self.profiles else 'uncalibrated')
            return VisionResult(**self.info().model_dump(), frame_id=frame_id, earth=earth, debris=observed,
                lost_tracks=lost, visible_count=len(observed), retained_count=len(lost), calibration_status=status,
                warnings=warnings + notes)
        return process_frame(body, frame_id, captured_at_ms, received_at_ms, analyze)

    def freeze(self, request):
        self.check_revision(request.expected_revision)
        frame = next((f for f in self.recent_frames if f[0] == request.frame_id), None)
        if frame is None:
            reject(409, 'SNAPSHOT_EXPIRED', 'That processed frame is no longer buffered. Resume processing and capture a new snapshot.')
        self.snapshot = (uuid4().hex, *frame)
        self.draft = None
        return SnapshotInfo(session_id=self.session_id, snapshot_id=self.snapshot[0], frame_id=frame[0],
                            revision=self.revision, width_px=self.dimensions[0], height_px=self.dimensions[1])

    def preview(self, request):
        self.check_revision(request.expected_revision)
        if not self.snapshot or self.snapshot[0] != request.snapshot_id or self.snapshot[1] != request.frame_id:
            reject(409, 'SNAPSHOT_EXPIRED', 'Calibration must use the current frozen snapshot and its exact frame ID.')
        profile, mask, contour = calibrate(self.snapshot[2], request.roi, request.profile_id, self.profiles)
        ok, encoded = cv2.imencode('.png', mask)
        if not ok:
            reject(400, 'CALIBRATION_FAILED', 'Could not encode the calibration preview. Capture another snapshot.')
        self.draft = CalibrationPreview(preview_id=uuid4().hex, snapshot_id=request.snapshot_id,
            frame_id=request.frame_id, revision=self.revision, profile=profile,
            mask_png=base64.b64encode(encoded).decode('ascii'), contour=contour)
        return self.draft

    def accept(self, request):
        self.check_revision(request.expected_revision)
        if self.draft is None or self.draft.preview_id != request.preview_id:
            reject(409, 'PREVIEW_EXPIRED', 'Preview this ROI again before accepting calibration.')
        profile = self.draft.profile
        self.reset()
        self.profiles[profile.profile_id] = profile
        return self.info()


class SessionManager:
    def __init__(self, max_sessions=MAX_SESSIONS, ttl=SESSION_TTL, clock=monotonic):
        self.sessions: dict[str, Session] = {}
        self.lock = Lock()
        self.max_sessions, self.ttl, self.clock = max_sessions, ttl, clock

    def _cleanup(self):
        now = self.clock()
        expired = [key for key, s in self.sessions.items() if s.users == 0 and now - s.activity > self.ttl]
        for key in expired:
            self.sessions.pop(key).closed = True

    def create(self):
        with self.lock:
            self._cleanup()
            if len(self.sessions) >= self.max_sessions:
                reject(503, 'SESSION_LIMIT', 'All local demo sessions are in use. Close other demos or wait five minutes for inactive sessions to expire.')
            session = Session(uuid4().hex, self.clock())
            self.sessions[session.session_id] = session
            return session.info()

    @contextmanager
    def use(self, session_id):
        with self.lock:
            self._cleanup()
            session = self.sessions.get(session_id)
            if session is None:
                reject(404, 'SESSION_EXPIRED', 'Session expired or the backend restarted. Create a new session and recalibrate.')
            session.users += 1
        try:
            with session.lock:
                if session.closed:
                    reject(404, 'SESSION_EXPIRED', 'Session was closed. Create a new session and recalibrate.')
                yield session
        finally:
            with self.lock:
                session.users -= 1
                session.activity = self.clock()

    def delete(self, session_id):
        with self.use(session_id) as session:
            with self.lock:
                self.sessions.pop(session_id, None)
                session.closed = True

    def process(self, session_id, body, frame_id, captured_at_ms, received_at_ms, revision):
        with self.use(session_id) as session:
            return session.frame(body, frame_id, captured_at_ms, received_at_ms, revision)
