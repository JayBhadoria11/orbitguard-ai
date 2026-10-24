# ORBITGUARD AI — Phase 1

A **webcam-based laboratory demonstration**, not real space-debris detection.
The browser owns the camera; it samples JPEGs and sends them through Vite's
same-origin proxy to local FastAPI. OpenCV decodes images and returns actual
metadata. Frames are held in memory only, never saved or logged by the app.
No API key, cloud service, camera network-stream URL, or OpenCV camera capture is used.

Detection, tracking, collision prediction, mitigation, orbital data, LLMs, and
simulated object results are **not implemented**. `objects` is always `[]`.

## Prerequisites and versions

Windows with Python **3.10–3.13**, Node.js **22.12+**, npm, and a current Chrome or
Edge browser. Tested here with **Python 3.13.15, Node 25.9.0, npm 11.12.1**.
Other runtime versions have not been tested. Python 3.14 is outside this pinned
NumPy/OpenCV combination's supported setup.

Direct dependencies are pinned in the requirements files and package.json;
`frontend/package-lock.json` records the complete npm resolution.

| Component | Version used |
| --- | --- |
| FastAPI / Uvicorn | 0.115.12 / 0.34.2 |
| NumPy / OpenCV headless | 2.2.6 / 4.12.0.88 |
| pytest / httpx | 8.3.5 / 0.28.1 |
| React / React DOM | 19.1.0 / 19.1.0 |
| Vite / React plugin | 6.4.5 / 4.4.1 |
| TypeScript / Vitest / jsdom | 5.8.3 / 4.1.12 / 26.1.0 |
| React Testing Library / jest-dom | 16.3.0 / 6.6.3 |

## Windows setup and startup

These commands use the actual project root: `C:\Users\Admin\Music\aerospace`.
If you copy the project, replace that path throughout. Internet access is needed
to install dependencies; operation afterward is local.

Backend setup (once):

```powershell
Set-Location 'C:\Users\Admin\Music\aerospace\backend'
python --version
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

`python` was used because the installed `py` launcher reports "No installed
Python found" on this machine. On a machine with a working launcher, use
`py -3.13 -m venv .venv` instead. No PowerShell activation or execution-policy
change is needed.

Backend terminal:

```powershell
Set-Location 'C:\Users\Admin\Music\aerospace\backend'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Frontend in a separate terminal:

```powershell
Set-Location 'C:\Users\Admin\Music\aerospace\frontend'
npm.cmd ci
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open **http://127.0.0.1:5173**. API docs: **http://127.0.0.1:8000/docs**.
Use Ctrl+C in each terminal to stop its server. `dist/` is a production build
artifact; the documented Phase 1 setup uses Vite's development `/api` proxy.
Deployment and production API routing are outside this phase.

## Controls and DroidCam

1. Connect phone and laptop to the same Wi-Fi network that permits device-to-device traffic.
2. Start DroidCam on Android and its Windows client. Establish the phone connection
   there and enable its Windows virtual webcam. Confirm it appears in Windows Camera,
   then close Windows Camera to free the device.
3. Open the app. Choose the virtual camera in **Camera input**, then **Start camera**.
   Labels may be hidden until permission is granted. If necessary start the default
   camera to grant permission, then select the actual DroidCam device from the list.
   No fixed DroidCam label or device ID is assumed.
4. Click **Start processing** when a usable video frame is ready. Switching cameras
   stops old tracks and processing; click Start processing again after switching.
5. **Pause processing** leaves the preview active. **Stop camera** releases tracks,
   cancels requests and sampling, and clears the preview. Stop also cancels a pending start.

The camera list refreshes on device changes and via **Refresh devices**. If DroidCam
is not exposed as a browser video input, enable/repair its Windows virtual webcam
and verify browser/Windows settings. Another webcam can be selected. There is no
HTTP/MJPEG fallback or embedded phone IP address.

Keep the webcam stationary. Use a well-lit, high-contrast background for later
tracking phases. Preview and sampled image coordinates are unmirrored.

Capture requests ideal 640 × 480, ideal 15 fps with a maximum of 20 fps. Sampling
preserves aspect ratio, never upscales, and fits inside 640 × 480. JPEG quality is
0.7; the loop targets 3 requests/second with at most one in flight and no frame queue.
Requests time out after 5 seconds. Failed processing retries after 2 seconds while
enabled. The preview continues, old metadata is marked stale, and valid replies
restore the status automatically. Health is checked independently on startup and
approximately every 5 seconds; a successful health check does not mean a frame succeeded.
Successful-frame count and increasing frame IDs last for the current mounted page session.

## API contract

`GET /api/health` → HTTP 200:

```json
{"status":"ok","service":"orbitguard-api","phase":1}
```

`POST /api/frames/process?frame_id=12&captured_at_ms=1730000000123.25`
requires `Content-Type: image/jpeg` and a raw JPEG body (not multipart or base64).
`frame_id` is an integer ≥ 0. `captured_at_ms` is finite and ≥ 0, recorded when
drawing the sample using `performance.timeOrigin + performance.now()` and echoed unchanged.

Example successful response (metadata and timing vary with the actual image):

```json
{
  "frame_id": 12,
  "captured_at_ms": 1730000000123.25,
  "received_at_ms": 1730000000140,
  "processing_ms": 2.4,
  "image": {"width_px":640,"height_px":480,"channels":3,"encoding":"jpeg","payload_bytes":28451},
  "objects": []
}
```

`received_at_ms` is server epoch time near endpoint entry. `processing_ms` measures
validation, decode and metadata work with a monotonic timer, excluding body transfer
and thread-pool waiting. OpenCV decodes to three-channel BGR; dimensions and payload
length come from the uploaded bytes. Client HTTP round-trip time is measured separately.

Limits: **1,048,576 bytes**, each decoded side **≤ 1920 pixels**, total decoded area
**≤ 2,073,600 pixels**. Content-Length is checked when supplied; every streamed chunk
is also counted. PNG content labeled JPEG is rejected. Decode runs in a worker thread.

| Condition | Status | Code |
| --- | --- | --- |
| Empty body | 400 | EMPTY_FRAME |
| Wrong/missing media type | 415 | UNSUPPORTED_MEDIA_TYPE |
| Invalid JPEG/decode failure | 400 | INVALID_FRAME |
| Body exceeds byte limit | 413 | FRAME_TOO_LARGE |
| Decoded dimensions exceed limits | 413 | FRAME_DIMENSIONS_EXCEEDED |

Application errors use `{"detail":{"code":"INVALID_FRAME","message":"The uploaded frame could not be decoded as a JPEG image."}}`.
Missing or invalid query parameters use FastAPI's standard 422 error format.
The frontend handles both formats. The backend is stateless, with no broad CORS policy.

## Files

```text
backend/
  requirements.txt, requirements-dev.txt  Pinned runtime and test dependencies
  app/main.py                            Routes, stream limit, thread handoff
  app/schemas.py                         Response contracts
  app/frame_processing.py                JPEG validation and decoded metadata
  tests/test_health.py, test_frames.py    Automated contract tests
  tests/smoke_http.py                     Real HTTP generated-JPEG smoke check
frontend/
  src/App.tsx, styles.css                 Dashboard and health polling
  src/hooks/useCamera.ts                 Discovery, permission and stream lifecycle
  src/hooks/useFrameProcessor.ts          Sampling, cancellation, retries, stale state
  src/api.ts, types.ts                    HTTP client and matching response types
  src/App.test.tsx, api.test.ts           Mocked-media and HTTP behavior tests
  scripts/smoke-browser.mjs               Optional Windows Chrome synthetic-camera check
  vite.config.ts                         React tooling, tests and local API proxy
  package.json, package-lock.json         Scripts and reproducible npm dependencies
```

## Checks and verification

Run backend checks from the backend directory:

```powershell
Set-Location 'C:\Users\Admin\Music\aerospace\backend'
.\.venv\Scripts\python.exe -m pytest -q
```

Run frontend checks:

```powershell
Set-Location 'C:\Users\Admin\Music\aerospace\frontend'
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
```

With the backend already running, check a real HTTP submission independently:

```powershell
Set-Location 'C:\Users\Admin\Music\aerospace\backend'
.\.venv\Scripts\python.exe tests\smoke_http.py
```

Optional browser check, with both servers running and Chrome installed at the
standard `C:\Program Files\Google\Chrome\Application\chrome.exe` path:

```powershell
Set-Location 'C:\Users\Admin\Music\aerospace\frontend'
node scripts\smoke-browser.mjs
```

This script launches hidden headless Chrome with a **synthetic camera**, uses a
temporary isolated browser profile, and closes that browser afterward. Port 9223
must be free. It tests actual browser JPEGs against the real backend through Vite.

Verified on 24 October 2026:

- Backend: **27 tests passed** (generated in-memory JPEGs, limits, streaming without
  Content-Length and with an underreported length, query validation and recovery).
- Frontend: **20 tests passed**, TypeScript check passed, production build passed.
- `python -m pip check` passed. pytest emits one upstream Starlette/AnyIO
  `BlockingPortal` deprecation warning; it does not affect the passing tests.
- `npm.cmd audit --json`: initial advisories corrected; subsequent install audit
  reported **0 vulnerabilities**.
- Real HTTP: health 200 and generated 320 × 240 JPEG 200, 1,827 bytes, frame ID 42,
  capture timestamp echoed unchanged, 3 channels and no objects.
- Real Chrome with synthetic camera: camera start, successful metadata/count updates,
  pause with live preview, resume, Stop track release, no uncaught browser errors,
  no horizontal overflow at 1366 × 768 and 390 × 844.
- Mocked-camera tests cover multiple devices, selection, switching, disconnection,
  permission denial, pending startup cancellation, late responses, request bounds,
  unmount cleanup, encoding failure and backend failure/recovery.

**Physical webcam/DroidCam compatibility has not been verified.** Code, automated
checks and synthetic browser integration are complete; physical demonstration
readiness requires the following checks on the actual phone/laptop pair.

## Physical verification still required

1. Connect phone and laptop to the same Wi-Fi, start DroidCam on both, and confirm
   the virtual camera appears in Windows Camera. Close Windows Camera afterward.
2. Start backend and frontend and open the frontend URL.
3. Select DroidCam, start camera, and allow permission. Refresh/select after granting
   permission if device labels were hidden.
4. Start processing.
5. Confirm frame count increases and dimensions appear.
6. Pause; confirm frame count stops while preview continues.
7. Resume, stop the backend with Ctrl+C, and confirm an error while preview continues.
8. Restart the backend and confirm automatic processing recovery.
9. Stop camera; confirm preview/processing stop and camera tracks are released.

## Troubleshooting

- **Permission denied / unavailable APIs:** use localhost (`127.0.0.1`) or HTTPS,
  allow camera access in site settings, and enable Windows camera access for desktop
  apps. An HTTP LAN address is generally not a secure camera context.
- **Camera in use:** close Windows Camera, conferencing apps, and other browser tabs.
  Check DroidCam's connection before retrying. A dropped camera requires a new Start.
- **DroidCam Wi-Fi failure:** check phone/client connection details in DroidCam itself.
  Guest networks, client isolation, VPNs or firewall rules may block device traffic.
  Use a network that permits the connection; never enter the phone address into this app.
- **DroidCam missing:** verify its virtual webcam installation/functionality in Windows
  and browser settings, grant permission to reveal labels, then Refresh devices.
  Restart the browser after installing a virtual camera driver if necessary.
- **Backend unavailable:** open `http://127.0.0.1:8000/api/health`, check the backend
  terminal, and use the frontend through Vite on port 5173. The proxy targets port 8000.
- **Port occupied:** stop the other process you own using that port, then retry.
  `Get-NetTCPConnection -LocalPort 8000,5173 -State Listen` identifies listeners.
  If changing the backend port, also change the target in `frontend/vite.config.ts`.
- **Python launcher/runtime unavailable:** use `python --version` and `Get-Command python`
  to locate a real Python 3.10–3.13 interpreter. Install Python 3.13 if needed, reopen
  the terminal, or invoke its full executable path with `& 'C:\path\to\python.exe'`.
  Do not reuse a virtual environment created with an unsupported interpreter.
- **PowerShell npm policy:** use `npm.cmd` as above rather than `npm.ps1`.
- **Slow hardware/network:** resolution and sampling are deliberately bounded.
  Three requests/second is a target, not a guarantee; slow operations reduce throughput
  without queuing frames. The backend is a local demonstration, not a public upload service.
