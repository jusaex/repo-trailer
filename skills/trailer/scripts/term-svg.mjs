#!/usr/bin/env node
// term-svg: run real commands and turn them into an animated terminal SVG.
// Zero dependencies. The SVG loops forever and renders inside a GitHub README.
//
// Usage: node term-svg.mjs <scenario.json> [--out demo.svg]

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const THEMES = {
  dark: {
    window: '#161b22', bg: '#0d1117', border: '#30363d', title: '#8b949e', fg: '#e6edf3',
    prompt: '#3fb950', comment: '#8b949e', cursor: '#e6edf3',
    ansi: ['#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4',
           '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#ffffff'],
  },
  light: {
    window: '#f6f8fa', bg: '#ffffff', border: '#d0d7de', title: '#57606a', fg: '#1f2328',
    prompt: '#116329', comment: '#6e7781', cursor: '#1f2328',
    ansi: ['#24292f', '#cf222e', '#116329', '#4d2d00', '#0969da', '#8250df', '#1b7c83', '#6e7781',
           '#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f'],
  },
};

const FONT_SIZE = 14;
const CHAR_W = FONT_SIZE * 0.6;
const LINE_H = 20;
const PAD = 16;
const BAR_H = 36;

// ---------- ANSI parsing ----------

function color256(n, theme) {
  if (n < 16) return theme.ansi[n];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return rgb(v, v, v);
  }
  n -= 16;
  const steps = [0, 95, 135, 175, 215, 255];
  return rgb(steps[Math.floor(n / 36)], steps[Math.floor(n / 6) % 6], steps[n % 6]);
}

function rgb(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Returns an array of lines; each line is an array of {text, fg, bold, dim, italic, underline}.
function parseAnsi(raw, theme, cols) {
  const cleaned = raw
    .replace(/\r\n/g, '\n')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '') // OSC (titles, links)
    .replace(/\x1b\[[0-9;?]*[A-Za-ln-z]/g, '') // every CSI except SGR (m)
    .replace(/\x1b[()][A-Za-z0-9]/g, '');

  const lines = [];
  const style = { fg: null, bold: false, dim: false, italic: false, underline: false };

  for (let rawLine of cleaned.split('\n')) {
    // Progress bars redraw with \r: keep only what was drawn last.
    if (rawLine.includes('\r')) {
      const parts = rawLine.split('\r').filter((p) => p.replace(/\x1b\[[0-9;]*m/g, '') !== '');
      rawLine = parts.length ? parts[parts.length - 1] : '';
    }
    const segs = [];
    const re = /\x1b\[([0-9;]*)m/g;
    let last = 0;
    let m;
    const push = (text) => {
      if (!text) return;
      text = text.replace(/\t/g, '        ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
      if (text) segs.push({ text, ...style });
    };
    while ((m = re.exec(rawLine))) {
      push(rawLine.slice(last, m.index));
      last = re.lastIndex;
      const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) Object.assign(style, { fg: null, bold: false, dim: false, italic: false, underline: false });
        else if (c === 1) style.bold = true;
        else if (c === 2) style.dim = true;
        else if (c === 3) style.italic = true;
        else if (c === 4) style.underline = true;
        else if (c === 22) style.bold = style.dim = false;
        else if (c === 23) style.italic = false;
        else if (c === 24) style.underline = false;
        else if (c >= 30 && c <= 37) style.fg = theme.ansi[c - 30];
        else if (c >= 90 && c <= 97) style.fg = theme.ansi[c - 90 + 8];
        else if (c === 39) style.fg = null;
        else if (c === 38 && codes[i + 1] === 5) { style.fg = color256(codes[i + 2] ?? 7, theme); i += 2; }
        else if (c === 38 && codes[i + 1] === 2) { style.fg = rgb(codes[i + 2] ?? 0, codes[i + 3] ?? 0, codes[i + 4] ?? 0); i += 4; }
        else if (c === 48 && (codes[i + 1] === 5)) i += 2; // backgrounds are ignored
        else if (c === 48 && (codes[i + 1] === 2)) i += 4;
      }
    }
    push(rawLine.slice(last));
    lines.push(...wrapLine(segs, cols));
  }
  return lines;
}

function wrapLine(segs, cols) {
  const out = [[]];
  let used = 0;
  for (const seg of segs) {
    let chars = [...seg.text];
    while (chars.length) {
      if (used === cols) { out.push([]); used = 0; }
      const take = chars.slice(0, cols - used);
      chars = chars.slice(take.length);
      out[out.length - 1].push({ ...seg, text: take.join('') });
      used += take.length;
    }
  }
  return out;
}

const plain = (text, fg = null, extra = {}) => ({ text, fg, bold: false, dim: false, italic: false, underline: false, ...extra });

// ---------- running the scenario ----------

function runCommand(cmd, step, scenario, baseDir) {
  // 2>&1 keeps stdout and stderr in the order the program printed them (works in sh and cmd.exe).
  const merge = step.mergeStderr ?? scenario.mergeStderr ?? true;
  const res = spawnSync(merge ? `${cmd} 2>&1` : cmd, {
    shell: scenario.shell ?? true,
    cwd: resolve(baseDir, step.cwd ?? scenario.cwd ?? '.'),
    encoding: 'utf8',
    timeout: step.timeoutMs ?? scenario.timeoutMs ?? 60000,
    env: {
      ...process.env,
      FORCE_COLOR: '1',
      CLICOLOR_FORCE: '1',
      COLUMNS: String(scenario.cols ?? 80),
      ...(scenario.env ?? {}),
      ...(step.env ?? {}),
    },
  });
  if (res.error && res.error.code === 'ETIMEDOUT') {
    process.stderr.write(`warning: "${cmd}" timed out, using the output captured so far\n`);
  }
  const out = (res.stdout ?? '') + (res.stderr ?? '');
  if (res.status !== 0 && !step.allowFail) {
    process.stderr.write(`warning: "${cmd}" exited with code ${res.status}. Add "allowFail": true if that is expected.\n`);
  }
  return out.replace(/\s+$/, '');
}

function buildTimeline(scenario, theme, baseDir) {
  const cols = scenario.cols ?? 80;
  const rows = scenario.rows ?? 18;
  const typingMs = scenario.typingMs ?? 45;
  const lineMs = scenario.lineMs ?? 30;
  const promptText = scenario.prompt ?? '$ ';

  const lines = []; // {segs, t, typing?}
  const scrolls = [{ t: 0, top: 0 }];
  let top = 0;
  let t = scenario.startMs ?? 500;

  const addLine = (segs, at, typing) => {
    lines.push({ segs, t: at, typing });
    const idx = lines.length - 1;
    if (idx - top >= rows) {
      top = idx - rows + 1;
      scrolls.push({ t: at, top });
    }
  };

  for (const step of scenario.steps ?? []) {
    if (step.clear) {
      t += step.pauseMs ?? 0;
      top = lines.length;
      scrolls.push({ t, top });
      continue;
    }
    if (step.comment !== undefined) {
      addLine([plain(step.comment, theme.comment, { italic: true })], t);
      t += step.pauseMs ?? 600;
      continue;
    }
    if (step.cmd === undefined) continue;

    const shown = step.display ?? step.cmd;
    const prompt = plain(promptText, theme.prompt, { bold: true });
    const promptCols = [...promptText].length;
    const cmdCols = Math.min([...shown].length, cols - promptCols);
    const typingDur = cmdCols * (step.typingMs ?? typingMs);
    addLine([prompt, plain([...shown].slice(0, cmdCols).join(''), theme.fg)], t, {
      start: t, dur: typingDur, col: promptCols, chars: cmdCols,
    });
    t += typingDur + 350;

    let output = step.output;
    if (output === undefined) {
      const dim = process.stderr.isTTY || process.env.FORCE_COLOR ? ['\x1b[2m', '\x1b[0m'] : ['', ''];
      process.stderr.write(`${dim[0]}recording: ${step.display ?? step.cmd}${dim[1]}\n`);
      output = runCommand(step.cmd, step, scenario, baseDir);
    }
    let outLines = output === '' ? [] : parseAnsi(output, theme, cols);
    const maxLines = step.maxLines ?? scenario.maxLines ?? rows - 2;
    if (outLines.length > maxLines) {
      const hidden = outLines.length - (maxLines - 1);
      outLines = outLines.slice(0, maxLines - 1);
      outLines.push([plain(`… ${hidden} more lines`, theme.comment, { italic: true })]);
    }
    for (const segs of outLines) {
      addLine(segs, t);
      t += step.lineMs ?? lineMs;
    }
    t += step.pauseMs ?? 1500;
  }

  // Final idle prompt with a cursor.
  addLine([plain(promptText, theme.prompt, { bold: true })], t, { start: t, dur: 0, col: [...promptText].length, chars: 0, idle: true });
  t += scenario.endPauseMs ?? 3000;

  return { lines, scrolls, total: t, cols, rows };
}

// ---------- SVG rendering ----------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render({ lines, scrolls, total, cols, rows }, theme, title) {
  const pct = (ms) => ((ms / total) * 100).toFixed(3) + '%';
  const dur = (total / 1000).toFixed(2) + 's';
  const W = Math.ceil(cols * CHAR_W + PAD * 2);
  const H = Math.ceil(BAR_H + rows * LINE_H + PAD * 1.5);
  const css = [];
  const body = [];

  css.push(`text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;font-size:${FONT_SIZE}px;white-space:pre}`);
  css.push(`.a{animation-duration:${dur};animation-iteration-count:infinite;animation-timing-function:step-end}`);

  lines.forEach((line, i) => {
    const y = i * LINE_H;
    const cls = [];
    if (line.t > 0) {
      css.push(`@keyframes l${i}{0%{opacity:0}${pct(line.t)}{opacity:1}100%{opacity:1}}#l${i}{animation-name:l${i}}`);
      cls.push('a');
    }
    const spans = [];
    let col = 0;
    for (const seg of line.segs) {
      const n = [...seg.text].length;
      if (seg.text.trim()) {
        const attrs = [`x="${(col * CHAR_W).toFixed(1)}"`, `textLength="${(n * CHAR_W).toFixed(1)}"`, 'lengthAdjust="spacing"'];
        attrs.push(`fill="${seg.fg ?? theme.fg}"`);
        if (seg.bold) attrs.push('font-weight="bold"');
        if (seg.dim) attrs.push('opacity="0.6"');
        if (seg.italic) attrs.push('font-style="italic"');
        if (seg.underline) attrs.push('text-decoration="underline"');
        spans.push(`<tspan ${attrs.join(' ')}>${esc(seg.text)}</tspan>`);
      }
      col += n;
    }
    let typing = '';
    if (line.typing) {
      const { start, dur: tdur, col: c0, chars, idle } = line.typing;
      const x0 = c0 * CHAR_W;
      const cover = idle ? '' : `<rect x="${(x0 + CHAR_W).toFixed(1)}" y="${-LINE_H + 1}" width="${((chars + 1) * CHAR_W).toFixed(1)}" height="${LINE_H}" fill="${theme.bg}"/>`;
      const cursor = `<rect x="${x0.toFixed(1)}" y="${-LINE_H + 3}" width="${CHAR_W.toFixed(1)}" height="${LINE_H - 4}" fill="${theme.cursor}" opacity="0.85"/>`;
      if (idle) {
        typing = cursor;
      } else {
        const end = start + tdur;
        const hideAt = end + 350;
        // Move right one character at a time while typing, then disappear on Enter.
        css.push(`@keyframes m${i}{0%{transform:translateX(0)}${pct(start)}{transform:translateX(0);animation-timing-function:steps(${Math.max(chars, 1)},end)}${pct(end)}{transform:translateX(${(chars * CHAR_W).toFixed(1)}px)}100%{transform:translateX(${(chars * CHAR_W).toFixed(1)}px)}}`);
        css.push(`@keyframes h${i}{0%{opacity:1}${pct(hideAt)}{opacity:0}100%{opacity:0}}`);
        css.push(`#m${i}{animation:m${i} ${dur} infinite linear}#h${i}{animation:h${i} ${dur} infinite step-end}`);
        typing = `<g id="h${i}"><g id="m${i}">${cursor}${cover}</g></g>`;
      }
    }
    body.push(`<g id="l${i}" class="${cls.join(' ')}" transform="translate(0 ${y + LINE_H})"><text y="-5">${spans.join('')}</text>${typing}</g>`);
  });

  const frames = scrolls
    .map((s) => `${pct(s.t)}{transform:translateY(${-s.top * LINE_H}px)}`)
    .join('');
  css.push(`@keyframes sc{${frames}100%{transform:translateY(${-scrolls[scrolls.length - 1].top * LINE_H}px)}}#sc{animation-name:sc}`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>${css.join('\n')}</style>
<defs><clipPath id="view"><rect x="0" y="0" width="${W - PAD * 2}" height="${rows * LINE_H}"/></clipPath></defs>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${theme.bg}" stroke="${theme.border}"/>
<path d="M0.5 ${BAR_H}V10.5a10 10 0 0 1 10-10h${W - 21}a10 10 0 0 1 10 10V${BAR_H}Z" fill="${theme.window}"/>
<line x1="0.5" y1="${BAR_H}" x2="${W - 0.5}" y2="${BAR_H}" stroke="${theme.border}"/>
<circle cx="20" cy="18" r="6" fill="#ff5f57"/><circle cx="40" cy="18" r="6" fill="#febc2e"/><circle cx="60" cy="18" r="6" fill="#28c840"/>
<text x="${W / 2}" y="23" text-anchor="middle" fill="${theme.title}" style="font-size:13px">${esc(title)}</text>
<g transform="translate(${PAD} ${BAR_H + PAD / 2})" clip-path="url(#view)"><g id="sc" class="a">
${body.join('\n')}
</g></g>
</svg>
`;
}

// ---------- CLI ----------

function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node term-svg.mjs <scenario.json> [--out demo.svg]');
    process.exit(args.length ? 0 : 1);
  }
  const scenarioPath = resolve(args[0]);
  const outIdx = args.indexOf('--out');
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8').replace(/^\uFEFF/, ''));
  const baseDir = dirname(scenarioPath);
  const out = resolve(baseDir, outIdx >= 0 ? args[outIdx + 1] : scenario.out ?? 'demo.svg');
  const theme = THEMES[scenario.theme ?? 'dark'] ?? THEMES.dark;

  const timeline = buildTimeline(scenario, theme, baseDir);
  const svg = render(timeline, theme, scenario.title ?? 'demo');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, svg);
  console.log(`wrote ${relative(process.cwd(), out)} (${(svg.length / 1024).toFixed(1)} KB, ${(timeline.total / 1000).toFixed(1)}s loop, ${timeline.lines.length} lines)`);
}

main();
