# ORBITGUARD AI — Phase 2

**Tabletop simulation — image-space measurements.** This is a webcam laboratory
computer-vision demonstration, not real space-debris or orbital observation.

Phase 2 adds calibrated HSV prop detection, a measured Earth outline, multiple
debris detections, bounded tracking, pixel velocities, calibration controls and
aligned SVG overlays. There are no collision predictions, orbital mechanics,
mitigation recommendations, confidence percentages, cloud APIs or heavy models.

The user reports physical Phase 1 DroidCam verification (108 successful frames,
about 3.06 ms processing and 11.6 ms HTTP round-trip). **Phase 2 physical acceptance
is pending**. Synthetic tests below are not recorded-camera or DroidCam evidence.

## Start on Windows

Actual project root: `C:\Users\Admin\Music\aerospace`. Python 3.10–3.13 and
Node.js 22.12+ are supported by the pinned setup; tested runtimes are Python
3.13.15, Node 25.9.0 and npm 11.12.1. Existing dependencies are unchanged:
FastAPI 0.115.12, Uvicorn 0.34.2, NumPy 2.2.6, opencv-python-headless 4.12.0.88,
pytest 8.3.5, httpx 0.28.1; React/React DOM 19.1.0, Vite 6.4.5, TypeScript 5.8.3,
Vitest 4.1.12 and jsdom 26.1.0. See package.json and package-lock.json for tooling.
No API keys, model downloads, Docker, GPU or additional dependencies are needed.

One-time backend setup, if the existing virtual environment is absent:

```powershell
Set-Location 'C:\Users\Admin\Music\aerospace\backend'
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

The `py` launcher was unavailable here. If it works on your machine, you can use
`py -3.13 -m venv .venv`. Invoke the environment directly; activation and execution
policy changes are unnecessary. Use Python 3.10–3.13, not 3.14 for these pins.

Backend terminal (restart an existing backend to load Phase 2):

```powershell
Set-Location 'C:\Users\Admin\Music\aerospace\backend'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Frontend in another terminal:

```powershell
Set-Location 'C:\Users\Admin\Music\aerospace\frontend'
npm.cmd ci
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open **http://127.0.0.1:5173**. API documentation is **http://127.0.0.1:8000/docs**.
Ctrl+C stops each server. Keep a **single backend worker**: session state is local
memory and is not shared across workers, processes or backend restarts. The Vite
proxy is the supported local demonstration setup; production hosting is out of scope.

## Camera and props

- Solid matte **blue Earth ball**, approximately round in the image.
- **Orange and bright green** debris tokens or small balls. Multiple separated
  props can share a calibrated debris color; two distinct debris profiles are supported.
- Dark neutral matte background, diffuse lighting, no harsh reflections/shadows.
- Fixed phone camera, slow prop movement and separation between objects.
- Both devices on the same Wi-Fi network, with traffic between them permitted.

Start DroidCam on Android and its Windows client; enable the Windows virtual
webcam. Confirm visibility in Windows Camera, then close that app to release it.
Select the actual device in the browser's Camera input list. Labels may appear
only after permission: start the default camera to grant access, then select the
DroidCam device if necessary. Refresh devices after installation or reconnection.
The browser owns the webcam; the app never opens it with OpenCV, fetches a phone
IP/MJPEG feed, mirrors the preview or substitutes simulated results in normal use.

## Calibration workflow

1. Start camera, allow permission, then **Start processing**.
2. Arrange Earth and debris props in view and click **Capture calibration snapshot**.
   Sampling pauses; the live camera preview continues. The frozen image is identified
   by its session, snapshot ID and exact processed frame ID.
3. Select **Earth**. Drag a tight rectangle around the ball in the frozen image.
   Numeric x/y/width/height fields provide a keyboard-accessible alternative.
4. Click **Preview color mask**. Inspect the tinted mask and green contour. Accept
   only if they isolate the intended object. Invalid samples return an actionable error.
5. Click **Accept calibration**. Repeat with **Debris color 1** and optionally
   **Debris color 2** on the same frozen image or capture a fresh one.
6. Click **Return to live detection**. Observe the measured Earth outline, debris
   boxes/IDs/trails, and pixel velocity telemetry.

Calibration learns color and size, not permanent coordinates. Removing Earth makes
its measured center/radius absent. Stationary debris remains detectable. Any object
with a matching color/size can trigger a detection: these are calibrated simulation
classes, not semantic recognition of hands, satellites or arbitrary objects.

**Last processed frame** displays the exact JPEG/results pair for alignment checks,
explicitly labeled historical. Live overlays are sampled and may lag moving props.
Result age is measured from capture, and live overlays disappear after 1.5 seconds
or immediately on pause, error, reset or session change. Historical measurements
remain labeled historical; they are not promoted to current detections.

## Lifecycle and recovery

| Action | Behavior |
| --- | --- |
| Pause processing | Abort submissions; hide live overlays; keep preview/calibration |
| Resume | Reset motion tracks before sampling; keep calibration only for same camera and dimensions |
| Reset tracks | Pause and clear tracks/trails/velocity; preserve calibration; IDs are not reused |
| Reset scene | Pause and clear profiles, snapshot and tracks; recalibrate |
| Stop/start or switch camera | Release old tracks; create a fresh session on next processing start |
| Resolution change | Clear calibration/tracks, including native-camera size changes that scale to the same sample size |
| Backend restart/session expiry | Display recovery notice; create a new session while processing retries; recalibration required |

Health polling remains independent of processing. Requests time out after 5 seconds;
failed frame processing retries after 2 seconds while enabled, preserving preview.
Only one sample request is in flight; no stale frames queue. Sample capture remains
up to 640 × 480, no upscaling, JPEG quality 0.7, about 3 FPS. Frame IDs increase for
the mounted page session. Capture timestamps now use **performance.now()**, a
session-local elapsed clock, never server arrival time or an assumed frame interval.

## Detection and tracking

The backend validates and decodes JPEG once, then runs OpenCV HSV thresholds,
3 × 3 opening/closing and external contours in a worker thread. Hue thresholds
wrap correctly around OpenCV's 0–179 range. Calibration uses the central 60% of
the ROI, sufficiently saturated/bright samples, circular hue statistics and robust
percentiles. Broad/mixed/low-saturation samples and weak/disconnected components
are rejected. Profiles with confusingly overlapping hue bands are rejected.

Earth candidates pass calibrated area and permissive circularity checks. Selection
uses size consistency and a recent measured location; similarly plausible candidates
produce `ambiguous` with no center/radius. The enclosing-circle radius is a 2D pixel
approximation, never real-world distance. Debris thresholds use calibrated area and
image area, exclude currently measured Earth with a four-pixel margin, and sort
candidates deterministically. No motion is required for detection.

Tracking predicts from the last measured position and velocity, constructs
profile-compatible gated pairs, then greedily assigns by distance, track ID and
detection index. Assignment is one-to-one. Velocity comes from measured position
differences divided by actual elapsed capture time. New/reset/reacquired tracks have
null velocity until another measurement; very short (<50 ms) or implausibly fast
samples suppress velocity. No heuristic confidence or risk percentages are generated.

**Predicted positions are internal association aids only.** Observed boxes are drawn
only for the returned frame. Lost tracks are listed separately with last measured
positions and no velocity; they are never drawn as current objects. Trails contain
measured centers only and are restarted after reacquisition.

Defaults in `backend/app/vision_config.py`:

| Bound | Default |
| --- | --- |
| Sessions | 8; reject additional live sessions with 503 |
| Inactive TTL | 300 seconds, server monotonic time; lazy cleanup on session access/create |
| Tracks / measured trail | 20 tracks / 20 points per track |
| Lost retention | 1.5 seconds since last measurement |
| Motion reset gap | Greater than 2 seconds |
| Phase 2 dimensions | 640 × 480 maximum |
| Debris minimum area | max(12 pixels², image area × 0.00012, calibration area × 0.12) |
| Debris maximum area | min(image area × 0.12, calibration area × 4) |
| Association gate | min(diagonal × 0.30, diagonal × (0.035 + 0.45 × elapsed seconds)) |

Per session, the server retains two recent validated images/JPEGs, one frozen
snapshot, one candidate calibration preview, at most three profiles and bounded
track history. Sessions have individual locks; calibration/reset/frame mutations
are serialized. The frontend holds one last successful JPEG and revokes old object
URLs. No frames are logged or written to disk. A snapshot is temporary in-memory
state, not a persisted recording. Close sessions best-effort on camera change or
unmount; inactivity expiry bounds orphaned sessions.

## API compatibility and exact additions

`GET /api/health` preserves `{"status":"ok","service":"orbitguard-api","phase":1}`
for existing clients. The OpenAPI application version is 2.0.0; the health field
remains the Phase 1 compatibility contract.

`POST /api/frames/process` still accepts raw `Content-Type: image/jpeg` with
required `frame_id` (integer ≥ 0) and `captured_at_ms` (finite number ≥ 0).
All original response fields are preserved: echoed frame/capture IDs, server epoch
`received_at_ms`, `processing_ms`, image width/height/channels/encoding/payload_bytes
and `objects: []`. **Requests without session_id remain stateless**, with `vision: null`.
No legacy client is placed into a shared tracker.

For Phase 2 add `session_id` and `revision` query parameters. Revision is required
with a session. IDs and timestamps must strictly increase. Stale requests return
409 before state mutation. Valid dimension changes invalidate calibration and
increment revision. `processing_ms` includes validation/decode/detection/tracking
and metadata, excluding body transfer and thread/lock wait. Client HTTP RTT remains
separately measured. `received_at_ms` is recorded near endpoint entry.

The 1 MiB (1,048,576-byte) streamed body limit, JPEG-only validation, legacy maximum
1920-pixel side and 2,073,600-pixel area limits remain. Phase 2 additionally requires
width ≤ 640 and height ≤ 480. Session operations cannot upload or bypass validated
images: they only reference buffered images previously accepted by the frame route.

New routes (all JSON except snapshot image):

| Route | Request → response |
| --- | --- |
| `POST /api/sessions` | Empty body → SessionInfo with opaque server-generated ID, revision 0 |
| `DELETE /api/sessions/{id}` | No body → 204 |
| `POST /api/sessions/{id}/reset` | `{expected_revision, scope: "tracks" or "scene"}` → SessionInfo, revision incremented |
| `POST /api/sessions/{id}/snapshot` | `{expected_revision, frame_id}` → SnapshotInfo |
| `GET /api/sessions/{id}/snapshot/{snapshot_id}` | Exact JPEG, `Cache-Control: no-store` |
| `POST /api/sessions/{id}/calibration/preview` | `{expected_revision, snapshot_id, frame_id, profile_id, roi:{x,y,width,height}}` → CalibrationPreview |
| `POST /api/sessions/{id}/calibration/accept` | `{expected_revision, preview_id}` → SessionInfo, revision incremented |

Exact typed fields are defined in `backend/app/vision_models.py` and mirrored in
`frontend/src/types.ts`; `/docs` provides their JSON schemas:

- **SessionInfo:** session_id, revision, profiles, width_px, height_px (dimensions
  null until a frame is accepted).
- **ProfileInfo:** profile_id (`earth`, `debris1`, `debris2`), hue_center,
  hue_half_width, saturation_min, value_min, reference_area_px.
- **SnapshotInfo:** session_id, snapshot_id, frame_id, revision, width_px, height_px.
- **CalibrationPreview:** preview_id, snapshot_id, frame_id, revision, profile,
  mask_png (base64 PNG, calibration only), contour (`{x,y}` points). Frame uploads
  remain raw JPEG; normal frame responses contain no encoded images.
- **vision:** SessionInfo fields plus frame_id, calibration_status
  (`uncalibrated`, `partial`, `ready`), earth, debris, lost_tracks, visible_count,
  retained_count (lost tracks only), warnings. `ready` means Earth plus at least one
  debris color; the second debris color is optional.
- **earth:** status (`uncalibrated`, `detected`, `not_detected`, `ambiguous`), center,
  radius_px, bbox. Measurements are null unless detected.
- **debris / lost_tracks entries:** track_id, profile_id, status (`observed`/`lost`),
  center, bbox, area_px, last_seen_ms, velocity (`{vx,vy,speed}` or null), trail.
  Centers/trails use `{x,y}`; boxes use `{x,y,width,height}`. x increases right,
  y down, origin at the top-left. Distances are pixels, velocities pixels/second.

Application errors retain `{detail:{code,message}}`; invalid query/body fields use
422. Additional codes include `REVISION_REQUIRED` (400), `STALE_REVISION`,
`STALE_FRAME`, `SNAPSHOT_EXPIRED`, `PREVIEW_EXPIRED`, `COLOR_CONFLICT` (409),
`SESSION_EXPIRED` (404), `SESSION_LIMIT` (503), `VISION_DIMENSIONS_EXCEEDED` (413),
`INVALID_ROI`, `UNSUITABLE_COLOR`, `AMBIGUOUS_COLOR`, `INVALID_COMPONENT`,
`EARTH_SHAPE`, `CALIBRATION_FAILED` (400). Missing snapshot images use 404.

## Files and checks

Backend additions: `detection.py`, `tracking.py`, `sessions.py`, `vision_config.py`,
`vision_models.py`, `vision_routes.py`. Existing validation, routes and response
schemas were extended. Frontend additions: `components/CalibrationPanel.tsx`,
`ObjectTelemetry.tsx`, `VisionOverlay.tsx`, `geometry.ts`; sampling/API/types/dashboard
were integrated without changing camera ownership. Phase 1 tests remain, with
frontend mock responses updated to include sessions and the new calibration empty state.

```powershell
Set-Location 'C:\Users\Admin\Music\aerospace\backend'
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe tests\benchmark_vision.py
# With the backend running:
.\.venv\Scripts\python.exe tests\smoke_http.py
.\.venv\Scripts\python.exe tests\smoke_phase2_http.py

Set-Location 'C:\Users\Admin\Music\aerospace\frontend'
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
# With both servers running and standard Windows Chrome installed:
node scripts\smoke-browser.mjs --vision
```

The browser script uses a generated canvas camera for `--vision`, actual pointer
ROI gestures, and the real HTTP backend. Without the flag it uses Chrome's default
synthetic camera for the original preview/processing smoke check. Neither tests
physical hardware or substitutes results in the normal app.

For isolated checks while existing demo servers are running, launch the backend on
8001, then set `$env:ORBITGUARD_API_TARGET='http://127.0.0.1:8001'` before launching
Vite on 5174. Set `$env:ORBITGUARD_FRONTEND_URL='http://127.0.0.1:5174'` for the browser
script. Pass `http://127.0.0.1:8001` to `smoke_phase2_http.py`. Defaults remain 8000/5173.

Warmed synthetic benchmark on the available Windows 10 build 19045 environment,
Intel64 Family 6 Model 140 Stepping 1, Python 3.13.15, OpenCV 4.12.0, NumPy 2.2.6:
**7.61 ms median / 11.80 ms p95**, 100 measured frames after 10 warm-up frames,
640 × 480 JPEG with Earth and three debris props across two profiles. This covers
validation/decode/detection/tracking/metadata, not camera transport, HTTP or UI.
It is not a sustained physical DroidCam performance claim. Target throughput remains
about 3 FPS; slow operations reduce throughput rather than queueing stale images.

No recorded camera sequence was found; added vision tests use synthetic images
and deterministic timestamps. One existing upstream Starlette/AnyIO BlockingPortal
deprecation warning is emitted by pytest.

Verification completed on 24 October 2026:

- `python -m pytest -q`: **46 passed**, including all 27 original backend tests.
- `npm.cmd test`: **31 passed**; TypeScript and production build passed.
- `python -m pip check`: no broken requirements. `git diff --check`: passed.
- Real HTTP Phase 2 smoke test passed against the isolated backend on port 8001.
- Headless Chrome on port 5174 passed actual ROI drag selection, mask preview and
  acceptance for Earth and both debris profiles, measured Earth removal/restoration,
  three stationary debris detections, velocity arrows and lost-track expiry.
- Browser pause/resume, track release, no uncaught exceptions and no horizontal
  overflow at 1366 × 768 and 390 × 844 passed. The browser source was a generated
  canvas camera, not DroidCam. Physical Phase 2 checks below remain pending.

## Troubleshooting and limitations

- **Unsuitable/mixed calibration:** use matte saturated props, tighten the ROI and
  exclude background/edges. Inspect mask before acceptance. White/gray/black props
  are unsuitable for this color-based method. Similar hues need different props.
- **Reflections or missing masks:** diffuse the light, lock camera exposure/white
  balance where possible, and recalibrate after lighting changes. Transparent or
  shiny props may fragment; heavy shadows can fall outside calibrated thresholds.
- **Merged objects:** separate props. Contours can merge and two objects can become
  one observation; this simple tracker cannot recover identities reliably through
  prolonged occlusion. Similar-color crossings can swap IDs. Reset tracks if needed.
- **Earth ambiguous:** remove same-color/size distractors. Calibration designates a
  color/shape profile, not a visually unique identity. Recent position helps but is
  not proof of identity.
- **Stale results:** check processing state/backend, then resume. Live overlays hide
  after 1.5 seconds. Last-processed-frame results are deliberately historical.
- **Overlay delay/alignment:** compare against the exact processed JPEG, not a moving
  preview. Slow down movement; do not mirror/crop the video with custom CSS. SVG
  viewBox uses decoded dimensions with the same centered contain-fit as video.
- **Session lost:** backend restart, TTL expiry or a revision conflict requires
  recalibration. Never run multiple Uvicorn workers with this in-memory manager.
- **Camera permission:** use localhost or HTTPS, allow site and Windows desktop-app
  camera access. HTTP LAN origins generally cannot use getUserMedia.
- **DroidCam missing/in use:** check the Windows virtual webcam, Wi-Fi connectivity,
  guest-network/client isolation, VPN/firewall settings; close Windows Camera and
  conferencing apps, refresh devices or restart the browser after driver installation.
- **Backend/port issues:** open `/api/health`, check terminals and Vite proxy target.
  `Get-NetTCPConnection -LocalPort 8000,5173 -State Listen` identifies listeners.
  Stop only servers you own or use the isolated test ports above. Restart an old
  Phase 1 backend before using session routes.
- **Python/npm issues:** inspect `python --version` and `Get-Command python`; use a
  real Python 3.10–3.13 executable. Use `npm.cmd` to avoid PowerShell script-policy
  issues. No activation-policy change is required.

## Manual DroidCam acceptance checklist — Phase 2 pending

1. Existing preview and health work.
2. Calibrate Earth and two distinct debris colors.
3. Earth outline matches the ball.
4. Remove Earth: measured detection disappears.
5. Restore Earth: detection returns.
6. Introduce two debris objects: both appear.
7. Leave debris stationary: detections remain.
8. Move them slowly: IDs and velocity update.
9. Remove debris: current boxes disappear and retained tracks expire.
10. Pause/resume: no stale boxes or velocity spikes.
11. Reset tracks/scene: intended state clears.
12. Switch camera/change resolution: recalibration is required.
13. Check responsive overlay alignment and processed-frame view.
14. Confirm sustained responsiveness on the physical laptop.

Implementation/test completion must not be confused with physical acceptance.
No Phase 3 work is included, and no commit or push is performed automatically.
