from time import time
from typing import Annotated
from fastapi import FastAPI, Query, Request
from starlette.concurrency import run_in_threadpool
from .frame_processing import MAX_BYTES, process_frame, reject
from .schemas import FrameResponse, Health

app = FastAPI(title="ORBITGUARD AI — webcam laboratory demonstration", version="1.0.0")


@app.get("/api/health", response_model=Health)
def health():
    return Health()


@app.post("/api/frames/process", response_model=FrameResponse, openapi_extra={
    "requestBody": {"required": True, "content": {"image/jpeg": {
        "schema": {"type": "string", "format": "binary"}
    }}}
})
async def frames(request: Request, frame_id: Annotated[int, Query(ge=0)],
                 captured_at_ms: Annotated[float, Query(ge=0, allow_inf_nan=False)]):
    received_at_ms = time() * 1000
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "image/jpeg":
        reject(415, "UNSUPPORTED_MEDIA_TYPE", "Send raw JPEG bytes with Content-Type: image/jpeg.")
    length = request.headers.get("content-length")
    if length is not None:
        try:
            too_large = int(length) > MAX_BYTES
        except ValueError:
            too_large = False  # The streamed byte count remains authoritative.
        if too_large:
            reject(413, "FRAME_TOO_LARGE", "Frame exceeds the 1 MiB upload limit.")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BYTES:
            reject(413, "FRAME_TOO_LARGE", "Frame exceeds the 1 MiB upload limit.")
        body.extend(chunk)
    return await run_in_threadpool(process_frame, bytes(body), frame_id, captured_at_ms, received_at_ms)
