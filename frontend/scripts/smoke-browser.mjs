// Optional Windows Chrome smoke test. Uses Chromium's synthetic camera, not hardware.
// Start backend and Vite first, then: node scripts/smoke-browser.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const profile = await mkdtemp(join(tmpdir(), 'orbitguard-browser-'));
const browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9223', `--user-data-dir=${profile}`,
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let targets;
  for (let tries = 0; tries < 50; tries++) {
    try { targets = await (await fetch('http://127.0.0.1:9223/json')).json(); if (targets.length) break; } catch {}
    await sleep(200);
  }
  assert.ok(targets?.length, 'Chrome debugging endpoint started');
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params);
    if (message.id) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(message.error) : task.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let tries = 0; tries < 80; tries++) { if (await evaluate(expression)) return; await sleep(150); }
    throw new Error(`Browser condition timed out: ${expression}\n${await evaluate('document.body.innerText')}`);
  };
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`);
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:5173' });
  await until(`document.body.innerText.includes('Camera is off')`);
  await until(`document.body.innerText.includes('Connected')`);
  await click('Start camera');
  await until(`!Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Start processing').disabled`);
  await evaluate(`window.qaTracks = document.querySelector('video').srcObject.getTracks()`);
  await click('Start processing');
  await until(`Number(document.querySelector('.counter strong').textContent) >= 3`);
  assert.ok((await evaluate('document.body.innerText')).includes('640 × 480 pixels'));
  await click('Pause processing');
  const pausedCount = await evaluate(`document.querySelector('.counter strong').textContent`);
  await sleep(1000);
  assert.equal(await evaluate(`document.querySelector('.counter strong').textContent`), pausedCount);
  assert.equal(await evaluate(`document.querySelector('video').srcObject.getVideoTracks()[0].readyState`), 'live');
  await click('Start processing');
  await until(`Number(document.querySelector('.counter strong').textContent) > ${Number(pausedCount)}`);
  await click('Stop camera');
  assert.equal(await evaluate(`window.qaTracks.every(t => t.readyState === 'ended') && document.querySelector('video').srcObject === null`), true);
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= 1366`), true);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= 390`), true);
  assert.equal(exceptions.length, 0, 'No uncaught browser errors');
  console.log('PASS: Chrome synthetic camera → browser JPEG → Vite proxy → real FastAPI metadata; pause/resume, track release, desktop/mobile width, no browser exceptions. NOT a physical webcam test.');
} finally {
  socket?.close();
  browser.kill();
  await sleep(500);
  const resolvedProfile = await realpath(profile);
  assert.equal(dirname(resolvedProfile).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
  assert.ok(basename(resolvedProfile).startsWith('orbitguard-browser-'));
  await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
