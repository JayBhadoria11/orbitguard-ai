"""Deterministic profile-compatible greedy association with bounded measured history."""
import math
from .vision_config import (MAX_TRACKS, MAX_TRAIL, LOST_RETENTION_MS, MOTION_RESET_MS,
                            GATE_BASE_FRACTION, GATE_SPEED_FRACTION, GATE_MAX_FRACTION)
from .vision_models import TrackResult, Velocity


class Tracker:
    def __init__(self):
        self.tracks: dict[int, TrackResult] = {}
        self.next_id = 1
        self.last_time = None

    def reset(self):
        self.tracks.clear()
        self.last_time = None  # IDs never repeat within this session.

    def update(self, detections, captured_at_ms, width, height):
        if self.last_time is not None and captured_at_ms <= self.last_time:
            raise ValueError('Capture timestamps must increase.')
        if self.last_time is not None and captured_at_ms - self.last_time > MOTION_RESET_MS:
            self.reset()
        self.last_time = captured_at_ms
        self.tracks = {key: t for key, t in self.tracks.items() if captured_at_ms - t.last_seen_ms <= LOST_RETENTION_MS}
        diagonal = math.hypot(width, height)
        pairs = []
        for key, track in self.tracks.items():
            dt = (captured_at_ms - track.last_seen_ms) / 1000
            px, py = track.center.x, track.center.y
            if track.velocity:
                px += track.velocity.vx * dt
                py += track.velocity.vy * dt
            gate = min(diagonal * GATE_MAX_FRACTION, diagonal * (GATE_BASE_FRACTION + GATE_SPEED_FRACTION * dt))
            for index, detection in enumerate(detections):
                distance = math.hypot(px-detection.center.x, py-detection.center.y)
                if detection.profile_id == track.profile_id and distance <= gate:
                    pairs.append((distance, key, index))
        assigned_tracks, assigned_detections = set(), set()
        for _, key, index in sorted(pairs):
            if key in assigned_tracks or index in assigned_detections:
                continue
            previous = self.tracks[key]
            detected = detections[index]
            dt = (captured_at_ms - previous.last_seen_ms) / 1000
            vx = (detected.center.x - previous.center.x) / dt
            vy = (detected.center.y - previous.center.y) / dt
            velocity = Velocity(vx=vx, vy=vy, speed=math.hypot(vx, vy)) if previous.status == 'observed' and dt >= 0.05 and math.hypot(vx, vy) <= diagonal * 1.5 else None
            trail = previous.trail if previous.status == 'observed' else []
            self.tracks[key] = TrackResult(**detected.model_dump(), track_id=key, status='observed',
                last_seen_ms=captured_at_ms, velocity=velocity, trail=(trail + [detected.center])[-MAX_TRAIL:])
            assigned_tracks.add(key)
            assigned_detections.add(index)
        for key, track in self.tracks.items():
            if key not in assigned_tracks:
                track.status = 'lost'
                track.velocity = None
        for index, detection in enumerate(detections):
            if index in assigned_detections or len(self.tracks) >= MAX_TRACKS:
                continue
            key = self.next_id
            self.next_id += 1
            self.tracks[key] = TrackResult(**detection.model_dump(), track_id=key, status='observed',
                last_seen_ms=captured_at_ms, trail=[detection.center])
        return ([t.model_copy(deep=True) for t in self.tracks.values() if t.status == 'observed'],
                [t.model_copy(deep=True) for t in self.tracks.values() if t.status == 'lost'])
