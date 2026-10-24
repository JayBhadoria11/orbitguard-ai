"""Pixel coordinates use x right, y down, with origin at the image's top-left."""
from typing import Literal
from pydantic import BaseModel, Field

ProfileId = Literal['earth', 'debris1', 'debris2']


class Point(BaseModel):
    x: float
    y: float


class Box(BaseModel):
    x: int
    y: int
    width: int
    height: int


class Velocity(BaseModel):
    vx: float
    vy: float
    speed: float


class Measurement(BaseModel):
    profile_id: ProfileId
    center: Point
    bbox: Box
    area_px: float


class TrackResult(Measurement):
    track_id: int
    status: Literal['observed', 'lost']
    last_seen_ms: float
    velocity: Velocity | None = None
    trail: list[Point]


class EarthResult(BaseModel):
    status: Literal['uncalibrated', 'detected', 'not_detected', 'ambiguous']
    center: Point | None = None
    radius_px: float | None = None
    bbox: Box | None = None


class ProfileInfo(BaseModel):
    profile_id: ProfileId
    hue_center: float
    hue_half_width: float
    saturation_min: int
    value_min: int
    reference_area_px: float


class SessionInfo(BaseModel):
    session_id: str
    revision: int
    profiles: list[ProfileInfo]
    width_px: int | None = None
    height_px: int | None = None


class VisionResult(SessionInfo):
    frame_id: int
    earth: EarthResult
    debris: list[TrackResult]
    lost_tracks: list[TrackResult]
    visible_count: int
    retained_count: int
    calibration_status: Literal['uncalibrated', 'partial', 'ready']
    warnings: list[str]


class RevisionRequest(BaseModel):
    expected_revision: int = Field(ge=0)


class ResetRequest(RevisionRequest):
    scope: Literal['tracks', 'scene']


class SnapshotRequest(RevisionRequest):
    frame_id: int = Field(ge=0)


class SnapshotInfo(BaseModel):
    session_id: str
    snapshot_id: str
    frame_id: int
    revision: int
    width_px: int
    height_px: int


class ROI(BaseModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class CalibrationRequest(RevisionRequest):
    snapshot_id: str = Field(max_length=64)
    frame_id: int = Field(ge=0)
    profile_id: ProfileId
    roi: ROI


class CalibrationPreview(BaseModel):
    preview_id: str
    snapshot_id: str
    frame_id: int
    revision: int
    profile: ProfileInfo
    mask_png: str
    contour: list[Point]


class AcceptRequest(RevisionRequest):
    preview_id: str = Field(max_length=64)
