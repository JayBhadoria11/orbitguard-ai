from typing import Literal
from pydantic import BaseModel, Field
from .vision_models import VisionResult


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["orbitguard-api"] = "orbitguard-api"
    phase: Literal[1] = 1


class ImageMetadata(BaseModel):
    width_px: int
    height_px: int
    channels: Literal[3] = 3
    encoding: Literal["jpeg"] = "jpeg"
    payload_bytes: int


class FrameResponse(BaseModel):
    frame_id: int
    captured_at_ms: float
    received_at_ms: float
    processing_ms: float
    image: ImageMetadata
    objects: list = Field(default_factory=list, max_length=0)
    vision: VisionResult | None = None
