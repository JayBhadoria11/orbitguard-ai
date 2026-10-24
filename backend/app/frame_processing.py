from time import perf_counter
import cv2
import numpy as np
from fastapi import HTTPException
from .schemas import FrameResponse, ImageMetadata

MAX_BYTES = 1_048_576
MAX_SIDE = 1920
MAX_PIXELS = 2_073_600


def reject(status: int, code: str, message: str):
    raise HTTPException(status, detail={"code": code, "message": message})


def decode_frame(body: bytes):
    if not body:
        reject(400, "EMPTY_FRAME", "The uploaded frame is empty.")
    if not body.startswith(b"\xff\xd8\xff") or not body.endswith(b"\xff\xd9"):
        reject(400, "INVALID_FRAME", "The uploaded frame could not be decoded as a JPEG image.")
    try:
        decoded = cv2.imdecode(np.frombuffer(body, dtype=np.uint8), cv2.IMREAD_COLOR)
    except cv2.error:
        decoded = None
    if decoded is None:
        reject(400, "INVALID_FRAME", "The uploaded frame could not be decoded as a JPEG image.")
    height, width = decoded.shape[:2]
    if max(width, height) > MAX_SIDE or width * height > MAX_PIXELS:
        reject(413, "FRAME_DIMENSIONS_EXCEEDED", "Decoded image exceeds the 1920-pixel side or 2,073,600-pixel limit.")
    return decoded


def process_frame(body: bytes, frame_id: int, captured_at_ms: float,
                  received_at_ms: float, vision_processor=None) -> FrameResponse:
    started = perf_counter()
    decoded = decode_frame(body)
    height, width = decoded.shape[:2]
    vision = vision_processor(decoded) if vision_processor else None
    return FrameResponse(
        frame_id=frame_id, captured_at_ms=captured_at_ms, received_at_ms=received_at_ms,
        processing_ms=(perf_counter() - started) * 1000,
        image=ImageMetadata(width_px=width, height_px=height, payload_bytes=len(body)),
        vision=vision,
    )
