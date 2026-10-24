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
    throw new Error(`Browser condition timed out: ${expression}\n${await evaluate('JSON.stringify(window.qaCalibration ?? [])')}\n${await evaluate('document.body.innerText')}`);
  };
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`);
  await send('Runtime.enable');
  let syntheticCameraScript = '';
  if (process.argv.includes('--vision')) {
    syntheticCameraScript = `
      window.qaOffset = 0; window.qaEarth = true; window.qaTokens = true;
      navigator.mediaDevices.enumerateDevices = async () => [{kind:'videoinput',deviceId:'synthetic-tabletop',label:'Synthetic tabletop (test only)',groupId:''}];
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
        const context = canvas.getContext('2d');
        const draw = () => {
          context.fillStyle = 'rgb(20,20,20)'; context.fillRect(0,0,640,480);
          const circle = (x,y,r,color) => { context.fillStyle=color; context.beginPath(); context.arc(x,y,r,0,Math.PI*2); context.fill(); };
          if (window.qaEarth) circle(100,110,40,'rgb(25,70,230)');
          if (window.qaTokens) { circle(260+window.qaOffset,150,13,'rgb(245,130,15)'); circle(390+window.qaOffset,240,13,'rgb(245,130,15)'); circle(480,130,12,'rgb(35,235,40)'); }
        };
        draw(); const timer = setInterval(draw,50); const stream=canvas.captureStream(15);
        stream.getTracks().forEach(track => { const stop=track.stop.bind(track); track.stop=()=>{clearInterval(timer);stop();}; const settings=track.getSettings.bind(track);track.getSettings=()=>({...settings(),deviceId:'synthetic-tabletop'}); });
        return stream;
      };`;
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: process.env.ORBITGUARD_FRONTEND_URL ?? 'http://127.0.0.1:5173' });
  await until(`document.body.innerText.includes('Camera is off')`);
  await until(`document.body.innerText.includes('Connected')`);
  if (syntheticCameraScript) await evaluate(syntheticCameraScript);
  if (process.argv.includes('--vision')) await evaluate(`(() => { window.qaCalibration=[];const original=window.fetch;window.fetch=(...args)=>original(...args).then(async response=>{if(String(args[0]).includes('/calibration/preview')){const data=await response.clone().json();window.qaCalibration.push({request:JSON.parse(args[1].body),profile:data.profile,error:data.detail});}return response;});})()`);
  await click('Start camera');
  await until(`!Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Start processing').disabled`);
  await evaluate(`window.qaTracks = document.querySelector('video').srcObject.getTracks()`);
  await click('Start processing');
  await until(`Number(document.querySelector('.counter strong').textContent) >= 3`);
  assert.ok((await evaluate('document.body.innerText')).includes('640 × 480 pixels'));
  if (process.argv.includes('--vision')) {
    await click('Capture calibration snapshot');
    await until(`!!document.querySelector('.roi-selector')`);
    for (const [profileId, x,y,w,h] of [['earth',58,68,84,84],['debris1',245,135,30,30],['debris2',466,116,28,28]]) {
      await evaluate(`(() => {const select=document.querySelector('.roi-fields select'); select.value='${profileId}'; select.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('.roi-selector').scrollIntoView({block:'center'});})()`);
      await sleep(200);
      const rect = await evaluate(`(() => {const r=document.querySelector('.roi-selector').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
      const from={x:rect.x+x*rect.width/640,y:rect.y+y*rect.height/480};
      const to={x:rect.x+(x+w)*rect.width/640,y:rect.y+(y+h)*rect.height/480};
      await send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',...to,button:'left',buttons:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',clickCount:1});
      await until(`document.querySelector('.roi-fields input').value >= ${x-1} && document.querySelector('.roi-fields input').value <= ${x+1}`);
      await click('Preview color mask');
      await until(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Accept calibration').disabled`);
      await click('Accept calibration');
      await until(`document.body.innerText.includes('${profileId} calibrated.')`);
    }
    await click('Return to live detection');
    await until(`document.body.innerText.includes('Earth: detected') && document.body.innerText.includes('Visible debris: 3')`);
    assert.equal(await evaluate(`document.querySelectorAll('.live-overlay rect').length`),4);
    await evaluate(`window.qaOffset=15`);
    await until(`document.querySelectorAll('.live-overlay line').length >= 2`);
    await evaluate(`window.qaEarth=false`);
    await until(`document.body.innerText.includes('Earth: not_detected')`);
    await evaluate(`window.qaEarth=true`);
    await until(`document.body.innerText.includes('Earth: detected')`);
    await evaluate(`window.qaTokens=false`);
    await until(`document.body.innerText.includes('Visible debris: 0 · retained lost: 0')`);
    await evaluate(`window.qaTokens=true`);
    await until(`document.body.innerText.includes('Visible debris: 3')`);
    console.log('PASS: synthetic tabletop calibration through actual ROI gestures, mask preview/accept for 3 profiles, measured Earth removal/return, 3 stationary debris, velocity arrows and lost-track expiry.');
  }
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
