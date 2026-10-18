#!/usr/bin/env node
// web-svg: drive the Chrome/Edge/Brave already installed on this machine, take screenshots
// along a scripted path and turn them into an animated browser-window SVG.
// Zero dependencies: talks to the browser over the DevTools protocol with Node's built-in WebSocket.
//
// Usage: node web-svg.mjs <scenario.json> [--out demo.svg]

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const THEMES = {
  dark: { window: '#161b22', border: '#30363d', bar: '#0d1117', url: '#8b949e', caption: '#e6edf3', captionBg: 'rgba(13,17,23,0.85)' },
  light: { window: '#f6f8fa', border: '#d0d7de', bar: '#ffffff', url: '#57606a', caption: '#1f2328', captionBg: 'rgba(255,255,255,0.9)' },
};

const BAR_H = 44;

// ---------- finding a browser ----------

function findBrowser() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const env = process.env;
  const candidates = {
    win32: [
      `${env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${env.ProgramFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ],
  }[process.platform];
  for (const p of candidates ?? []) if (p && existsSync(p)) return p;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']) {
    const r = spawnSync('which', [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  throw new Error('No Chrome, Edge, Chromium or Brave found. Install one or set CHROME_PATH.');
}

// ---------- tiny DevTools protocol client ----------

async function launch(viewport) {
  const exe = findBrowser();
  const profile = mkdtempSync(join(tmpdir(), 'repo-trailer-'));
  const proc = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    `--window-size=${viewport.width},${viewport.height}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((ok, fail) => {
    let buf = '';
    const timer = setTimeout(() => fail(new Error('Browser did not start in 20s')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); ok(m[1]); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); fail(new Error(`Browser exited early (code ${code})`)); });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    } else if (msg.method) {
      for (const l of [...listeners]) l(msg);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    const id = nextId++;
    pending.set(id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  const waitEvent = (name, timeoutMs) => new Promise((ok) => {
    const timer = setTimeout(() => { remove(); ok(false); }, timeoutMs);
    const l = (msg) => { if (msg.method === name && msg.sessionId === sessionId) { clearTimeout(timer); remove(); ok(true); } };
    const remove = () => listeners.splice(listeners.indexOf(l), 1);
    listeners.push(l);
  });

  await page('Page.enable');
  await page('Runtime.enable');
  await page('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale ?? 1, mobile: !!viewport.mobile,
  });
  if (viewport.colorScheme) {
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: viewport.colorScheme }] });
  }

  const close = async () => {
    try { await send('Browser.close'); } catch {}
    ws.close();
    await new Promise((r) => setTimeout(r, 300));
    try { proc.kill(); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  };
  return { page, waitEvent, close };
}

// ---------- actions ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(b, expression) {
  const r = await b.page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function centerOf(b, selector, timeoutMs = 10000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const box = await evaluate(b, `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (box) return box;
    await sleep(200);
  }
  throw new Error(`Element not found or not visible: ${selector}`);
}

// A fake mouse pointer drawn into the page so screenshots show where we clicked.
async function showPointer(b, x, y) {
  await evaluate(b, `(() => {
    let p = document.getElementById('__trailer_pointer');
    if (!p) {
      p = document.createElement('div');
      p.id = '__trailer_pointer';
      p.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:28px;height:28px;margin:-4px 0 0 -4px';
      p.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><circle cx="5" cy="5" r="13" fill="rgba(88,166,255,0.25)"/><path d="M4 3l16 7-7 2-3 7z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(p);
    }
    p.style.left = '${x}px';
    p.style.top = '${y}px';
  })()`);
}

const KEYS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Space: { code: 'Space', keyCode: 32, text: ' ', key: ' ' },
};

async function press(b, name) {
  const k = KEYS[name] ?? { code: name, keyCode: 0 };
  const base = { key: k.key ?? name, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
  await b.page('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(k.text ? { text: k.text } : {}) });
  await b.page('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function navigate(b, url, waitMs) {
  const loaded = b.waitEvent('Page.loadEventFired', 20000);
  await b.page('Page.navigate', { url });
  if (!(await loaded)) process.stderr.write(`warning: ${url} did not finish loading in 20s\n`);
  await sleep(waitMs);
}

async function runSteps(b, scenario, baseDir) {
  const frames = [];
  let currentUrl = 'about:blank';
  const waitMs = scenario.settleMs ?? 600;

  if (scenario.url) {
    currentUrl = scenario.url;
    await navigate(b, currentUrl, waitMs);
  }

  for (const step of scenario.steps ?? []) {
    if (step.goto) {
      currentUrl = step.goto;
      await navigate(b, currentUrl, step.waitMs ?? waitMs);
    } else if (step.click) {
      const { x, y } = await centerOf(b, step.click);
      if (step.pointer !== false) await showPointer(b, x, y);
      await b.page('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await b.page('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await b.page('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await sleep(step.waitMs ?? waitMs);
    } else if (step.type !== undefined) {
      if (step.into) {
        const { x, y } = await centerOf(b, step.into);
        await b.page('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await b.page('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      }
      for (const ch of [...step.type]) {
        await b.page('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch });
        await b.page('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      }
      await sleep(step.waitMs ?? 200);
    } else if (step.press) {
      await press(b, step.press);
      await sleep(step.waitMs ?? waitMs);
    } else if (step.scroll !== undefined) {
      await evaluate(b, `window.scrollBy({ top: ${Number(step.scroll)}, behavior: 'instant' })`);
      await sleep(step.waitMs ?? 300);
    } else if (step.waitFor) {
      await centerOf(b, step.waitFor, step.timeoutMs ?? 15000);
      await sleep(step.waitMs ?? 200);
    } else if (step.wait !== undefined) {
      await sleep(Number(step.wait));
    } else if (step.eval) {
      await evaluate(b, step.eval);
      await sleep(step.waitMs ?? 200);
    }

    if (step.shot !== undefined && step.shot !== false) {
      const url = await evaluate(b, 'location.href').catch(() => currentUrl);
      const { data } = await b.page('Page.captureScreenshot', { format: 'jpeg', quality: scenario.quality ?? 80 });
      frames.push({ data, url, caption: typeof step.shot === 'string' ? step.shot : '', holdMs: step.holdMs ?? scenario.holdMs ?? 2200 });
      process.stderr.write(`shot ${frames.length}: ${url}${frames.at(-1).caption ? ' — ' + frames.at(-1).caption : ''}\n`);
    }
  }
  if (!frames.length) throw new Error('No screenshots taken. Add "shot": "caption" to at least one step.');
  return frames;
}

// ---------- SVG rendering ----------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(frames, scenario, theme) {
  const vw = scenario.viewport?.width ?? 1200;
  const vh = scenario.viewport?.height ?? 750;
  const W = vw;
  const H = vh + BAR_H;
  const fade = 350;
  const total = frames.reduce((s, f) => s + f.holdMs, 0);
  const pct = (ms) => ((ms / total) * 100).toFixed(3) + '%';
  const dur = (total / 1000).toFixed(2) + 's';
  const displayWidth = scenario.displayWidth ?? Math.min(W, 960);

  const css = [`text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}`];
  const groups = [];
  let t = 0;
  frames.forEach((f, i) => {
    const anim = i > 0 && frames.length > 1;
    if (anim) {
      css.push(`@keyframes f${i}{0%{opacity:0}${pct(Math.max(t - fade, 0))}{opacity:0}${pct(t)}{opacity:1}100%{opacity:1}}#f${i}{animation:f${i} ${dur} linear infinite}`);
    }
    const caption = f.caption
      ? `<g transform="translate(${W / 2} ${H - 36})"><rect x="${-(f.caption.length * 5.2 + 24)}" y="-20" width="${f.caption.length * 10.4 + 48}" height="40" rx="20" fill="${theme.captionBg}"/><text x="0" y="6" text-anchor="middle" fill="${theme.caption}" style="font-size:17px;font-weight:600">${esc(f.caption)}</text></g>`
      : '';
    groups.push(`<g id="f${i}">
<rect x="150" y="10" width="${W - 300}" height="26" rx="13" fill="${theme.bar}" stroke="${theme.border}"/>
<text x="${W / 2}" y="28" text-anchor="middle" fill="${theme.url}" style="font-size:13px">${esc(f.url.replace(/^https?:\/\//, '').slice(0, 90))}</text>
<image x="0" y="${BAR_H}" width="${vw}" height="${vh}" href="data:image/jpeg;base64,${f.data}"/>
${caption}
</g>`);
    t += f.holdMs;
  });

  const title = scenario.title ?? 'demo';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${displayWidth}" height="${Math.round((displayWidth * H) / W)}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>${css.join('\n')}</style>
<defs><clipPath id="win"><rect width="${W}" height="${H}" rx="12"/></clipPath></defs>
<g clip-path="url(#win)">
<rect width="${W}" height="${H}" fill="${theme.window}"/>
<circle cx="24" cy="23" r="7" fill="#ff5f57"/><circle cx="46" cy="23" r="7" fill="#febc2e"/><circle cx="68" cy="23" r="7" fill="#28c840"/>
${groups.join('\n')}
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${theme.border}"/>
</svg>
`;
}

// ---------- CLI ----------

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node web-svg.mjs <scenario.json> [--out demo.svg]');
    process.exit(args.length ? 0 : 1);
  }
  const scenarioPath = resolve(args[0]);
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
  const baseDir = dirname(scenarioPath);
  const outIdx = args.indexOf('--out');
  const out = resolve(baseDir, outIdx >= 0 ? args[outIdx + 1] : scenario.out ?? 'web-demo.svg');
  const theme = THEMES[scenario.theme ?? 'dark'] ?? THEMES.dark;
  const viewport = { width: 1200, height: 750, ...(scenario.viewport ?? {}) };
  scenario.viewport = viewport;

  const b = await launch(viewport);
  let frames;
  try {
    frames = await runSteps(b, scenario, baseDir);
  } finally {
    await b.close();
  }

  if (scenario.framesDir) {
    const dir = resolve(baseDir, scenario.framesDir);
    mkdirSync(dir, { recursive: true });
    frames.forEach((f, i) => writeFileSync(join(dir, `${String(i + 1).padStart(2, '0')}.jpg`), Buffer.from(f.data, 'base64')));
    console.log(`saved ${frames.length} screenshots in ${relative(process.cwd(), dir)}`);
  }
  const svg = render(frames, scenario, theme);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, svg);
  console.log(`wrote ${relative(process.cwd(), out)} (${(svg.length / 1024).toFixed(0)} KB, ${frames.length} frames)`);
  if (svg.length > 5 * 1024 * 1024) console.log('warning: over 5 MB, GitHub may not display it. Use fewer shots, a smaller viewport or a lower "quality".');
}

main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
