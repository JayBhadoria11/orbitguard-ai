import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function device(id: string, label: string) { return { deviceId: id, label, kind: 'videoinput', groupId: '', toJSON: () => ({}) } as MediaDeviceInfo; }
function stream(id = 'phone') {
  const track = Object.assign(new EventTarget(), { stop: vi.fn(), readyState: 'live', getSettings: () => ({ deviceId: id }) });
  const value = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { value, track };
}
let media: EventTarget & { enumerateDevices: ReturnType<typeof vi.fn>; getUserMedia: ReturnType<typeof vi.fn> };
let current: ReturnType<typeof stream>;
let fetcher: ReturnType<typeof vi.fn>;
let response: (url: string, init: RequestInit) => Promise<unknown>;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
function success(url: string, init: RequestInit) {
  const params = new URL(url, 'http://localhost').searchParams;
  return { ok: true, json: async () => ({ frame_id: Number(params.get('frame_id')), captured_at_ms: Number(params.get('captured_at_ms')), received_at_ms: Date.now(), processing_ms: 2.4,
    image: { width_px: 640, height_px: 480, channels: 3, encoding: 'jpeg', payload_bytes: (init.body as Blob).size }, objects: [] }) };
}
const frameCalls = () => fetcher.mock.calls.filter(([url]) => String(url).includes('/frames/'));
async function startCamera() {
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' })); await flush();
  fireEvent.loadedData(document.querySelector('video')!); await flush();
}
async function startProcessing() { fireEvent.click(screen.getByRole('button', { name: 'Start processing' })); await flush(); }

beforeEach(() => {
  vi.useFakeTimers();
  current = stream();
  media = Object.assign(new EventTarget(), { enumerateDevices: vi.fn().mockResolvedValue([device('laptop', 'Laptop camera'), device('phone', 'DroidCam virtual webcam')]), getUserMedia: vi.fn().mockResolvedValue(current.value) });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  Object.defineProperties(HTMLVideoElement.prototype, { videoWidth: { configurable: true, get: () => 1280 }, videoHeight: { configurable: true, get: () => 960 }, readyState: { configurable: true, get: () => 2 } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) { callback(new Blob(['jpeg'], { type: 'image/jpeg' })); });
  response = async (url, init) => success(url, init);
  fetcher = vi.fn((url: string, init: RequestInit) => url.includes('/health')
    ? Promise.resolve({ ok: true, json: async () => ({ status: 'ok', service: 'orbitguard-api', phase: 1 }) }) : response(url, init));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('shows the placeholder, Phase 2 empty state and multiple cameras without asking permission', async () => {
  render(<App />); await flush();
  expect(screen.getByText('Camera is off')).toBeInTheDocument();
  expect(screen.getByText('Detection and tracking will be added in Phase 2. No objects are being detected yet.')).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Laptop camera' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'DroidCam virtual webcam' })).toBeInTheDocument();
  expect(media.getUserMedia).not.toHaveBeenCalled();
});
it('reports permission denial', async () => {
  media.getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  render(<App />); await startCamera();
  expect(screen.getByRole('alert')).toHaveTextContent('Camera permission denied');
});
it('selects DroidCam and attaches one stream under Strict Mode', async () => {
  render(<StrictMode><App /></StrictMode>); await flush();
  fireEvent.change(screen.getByLabelText('Camera input'), { target: { value: 'phone' } });
  await startCamera();
  expect(media.getUserMedia).toHaveBeenCalledTimes(1);
  expect(media.getUserMedia).toHaveBeenCalledWith({ audio: false, video: { deviceId: { exact: 'phone' }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 20 } } });
  expect(document.querySelector('video')!.srcObject).toBe(current.value);
});
it('stops tracks and processing and leaves previous metadata stale', async () => {
  render(<App />); await startCamera(); await startProcessing();
  expect(screen.getByText('640 × 480 pixels')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
  expect(current.track.stop).toHaveBeenCalled();
  expect(document.querySelector('video')!.srcObject).toBeNull();
  expect(screen.getByText('STALE')).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(3000)); expect(frameCalls()).toHaveLength(1);
});
it('releases a late camera permission result after Stop', async () => {
  const pending = deferred<MediaStream>(); media.getUserMedia.mockReturnValue(pending.promise);
  render(<App />); await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  fireEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
  await act(async () => pending.resolve(current.value));
  expect(current.track.stop).toHaveBeenCalled(); expect(document.querySelector('video')!.srcObject).toBeNull();
});
it('switches cameras, releases previous tracks, and requires processing to be explicitly restarted', async () => {
  render(<App />); await startCamera(); await startProcessing();
  const laptop = stream('laptop'); media.getUserMedia.mockResolvedValue(laptop.value);
  fireEvent.change(screen.getByLabelText('Camera input'), { target: { value: 'laptop' } }); await flush();
  expect(current.track.stop).toHaveBeenCalled(); expect(document.querySelector('video')!.srcObject).toBe(laptop.value);
  await act(() => vi.advanceTimersByTimeAsync(2000)); expect(frameCalls()).toHaveLength(1);
});
it('handles selection changes while startup is pending', async () => {
  const pending = deferred<MediaStream>(); const laptop = stream('laptop');
  media.getUserMedia.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(laptop.value);
  render(<App />); await flush(); fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  fireEvent.change(screen.getByLabelText('Camera input'), { target: { value: 'laptop' } }); await flush();
  await act(async () => pending.resolve(current.value));
  expect(current.track.stop).toHaveBeenCalled(); expect(document.querySelector('video')!.srcObject).toBe(laptop.value);
});
it('handles a disconnected DroidCam while processing', async () => {
  render(<App />); await startCamera(); await startProcessing();
  media.enumerateDevices.mockResolvedValue([device('laptop', 'Laptop camera')]);
  await act(async () => { media.dispatchEvent(new Event('devicechange')); });
  expect(screen.getByRole('alert')).toHaveTextContent('Selected camera disconnected'); expect(current.track.stop).toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(2000)); expect(frameCalls()).toHaveLength(1);
});
it('handles a track ending unexpectedly', async () => {
  render(<App />); await startCamera(); await startProcessing();
  act(() => current.track.dispatchEvent(new Event('ended')));
  expect(screen.getByRole('alert')).toHaveTextContent('stopped unexpectedly');
  expect(screen.getByRole('button', { name: 'Start processing' })).toBeDisabled();
});
it('sends scaled JPEG samples and shows real metadata', async () => {
  render(<App />); await startCamera(); await startProcessing();
  const [url, init] = frameCalls()[0]; expect(url).toMatch(/frame_id=0&captured_at_ms=\d/);
  expect(init.body).toBeInstanceOf(Blob); expect(init.body.type).toBe('image/jpeg');
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.7);
  const canvas = vi.mocked(HTMLCanvasElement.prototype.toBlob).mock.contexts[0] as unknown as HTMLCanvasElement;
  expect([canvas.width, canvas.height]).toEqual([640, 480]);
  expect(screen.getByText('640 × 480 pixels')).toBeInTheDocument(); expect(screen.getByText('2.40 ms')).toBeInTheDocument();
});
it('keeps preview on backend failure, retries and recovers', async () => {
  response = async () => ({ ok: false, status: 400, json: async () => ({ detail: { message: 'Decode unavailable' } }) });
  render(<App />); await startCamera(); await startProcessing();
  expect(screen.getByRole('alert')).toHaveTextContent('Decode unavailable'); expect(current.track.stop).not.toHaveBeenCalled();
  expect(document.querySelector('video')!.srcObject).toBe(current.value);
  response = async (url, init) => success(url, init);
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.getByText('LATEST SUCCESS')).toBeInTheDocument();
});
it('never overlaps requests and ignores late results after pause', async () => {
  const pending = deferred<unknown>(); response = () => pending.promise;
  render(<App />); await startCamera(); await startProcessing();
  await act(() => vi.advanceTimersByTimeAsync(1500)); expect(frameCalls()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Pause processing' }));
  const [url, init] = frameCalls()[0]; expect(init.signal.aborted).toBe(true);
  await act(async () => pending.resolve(success(url, init)));
  expect(screen.queryByText('640 × 480 pixels')).not.toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(2000)); expect(frameCalls()).toHaveLength(1);
});
it('ignores stale responses after switching cameras', async () => {
  const pending = deferred<unknown>(); response = () => pending.promise;
  render(<App />); await startCamera(); await startProcessing();
  media.getUserMedia.mockResolvedValue(stream('laptop').value);
  fireEvent.change(screen.getByLabelText('Camera input'), { target: { value: 'laptop' } }); await flush();
  const [url, init] = frameCalls()[0]; await act(async () => pending.resolve(success(url, init)));
  expect(screen.queryByText('640 × 480 pixels')).not.toBeInTheDocument(); expect(init.signal.aborted).toBe(true);
});
it('aborts and releases camera on unmount, ignoring late responses', async () => {
  const pending = deferred<unknown>(); response = () => pending.promise;
  const view = render(<App />); await startCamera(); await startProcessing(); view.unmount();
  const [url, init] = frameCalls()[0]; expect(init.signal.aborted).toBe(true); expect(current.track.stop).toHaveBeenCalled();
  await act(async () => pending.resolve(success(url, init))); await act(() => vi.advanceTimersByTimeAsync(6000));
  expect(frameCalls()).toHaveLength(1);
});
it('handles null JPEG encoding without sending a request', async () => {
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => callback(null));
  render(<App />); await startCamera(); await startProcessing();
  expect(screen.getByRole('alert')).toHaveTextContent('JPEG encoding failed'); expect(frameCalls()).toHaveLength(0);
});
