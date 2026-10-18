---
name: trailer
description: Make a "trailer" for the current repository - run the project for real, record an animated demo (terminal session or web app) as an SVG that plays inside GitHub, and write or improve the README around it. Use when the user asks for a demo, a GIF, screenshots, a better README, or wants their repo to look good / get stars.
---

# repo-trailer

Your job: make someone who lands on this repository understand **what it does and why they want it in under 10 seconds**, by showing it working.

You produce two things:
1. An animated demo (`.svg`) recorded from the real project, that plays inline on GitHub.
2. A README that puts that demo at the top and tells a short, honest story.

The recording tools live in the `scripts/` folder next to this file (this skill's base directory). They need only Node.js 18+ and, for web demos, an installed Chrome, Edge, Chromium or Brave. No npm install.

- `scripts/term-svg.mjs <scenario.json>` — runs real shell commands and draws them as an animated terminal.
- `scripts/web-svg.mjs <scenario.json>` — drives a headless browser through clicks/typing and turns screenshots into an animated browser window.

## Step 1 — Understand the project

Read the README (if any), the manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, ...), the entry points and any examples. Then answer, for yourself, in one sentence each:

- **What is it?** (a CLI, a library, a web app, a desktop app, a game, ...)
- **Who is it for?**
- **What is the single "wow" moment?** The output, screen or result that makes someone say "oh nice". The demo exists to show this moment. Everything else is optional.

## Step 2 — Choose the demo

| Project | Demo |
|---|---|
| CLI tool | Terminal: install → one or two real commands with nice output |
| Library | Terminal: a tiny script using it, then running it (`cat example.js`, `node example.js`) |
| Web app / site / UI | Web: open the page → do the main action → show the result |
| Both | Web demo first in the README, terminal below for the API/CLI |

If the project cannot run here (needs paid API keys, hardware, a database you can't start), tell the user and either use a realistic example with `"output"` overrides (terminal) or ask how to run it. Never pretend: a faked output must match what the project really prints.

## Step 3 — Get it running

Install dependencies and build the way the project's docs say. For a web app, start its dev server in the background and confirm the URL answers before recording. Ask the user before anything slow or invasive (global installs, Docker images, sign-ups).

## Step 4 — Write the scenario

Create a `.trailer/` folder at the repo root and put scenarios there. Keep demos **short (10–25 seconds), focused on the wow moment, and real**.

### Terminal scenario (`.trailer/terminal.json`)

```json
{
  "title": "mytool — turn CSVs into charts",
  "cols": 80,
  "rows": 16,
  "theme": "dark",
  "out": "../docs/demo.svg",
  "cwd": "..",
  "steps": [
    { "comment": "# install" },
    { "cmd": "npm i -g mytool", "output": "added 1 package in 2s" },
    { "cmd": "mytool sales.csv --chart bar", "pauseMs": 2500 },
    { "cmd": "mytool --help", "maxLines": 8 }
  ]
}
```

Step fields:
- `cmd` — runs for real (colors kept, `FORCE_COLOR=1` is set). Paths resolve from `cwd`, which is relative to the scenario file.
- `display` — what to show being typed, if different from what runs (hide long paths or `node -e` tricks).
- `output` — use this text instead of running (for slow installs, network calls). ANSI colors allowed.
- `pauseMs` (after the output, default 1500), `maxLines` (cut long output), `typingMs`, `timeoutMs`, `allowFail`, `env`, `mergeStderr` (default `true`: stderr is shown in order with stdout).
- `{ "comment": "# text" }` — a dim comment line, great for narrating.
- `{ "clear": true }` — clear the screen.

Top level: `title`, `cols` (80), `rows` (18), `theme` (`dark`/`light`), `prompt` (`"$ "`), `out`, `cwd`, `env`, `typingMs` (45), `lineMs` (30), `endPauseMs` (3000).

### Web scenario (`.trailer/web.json`)

```json
{
  "title": "Tiny Todo",
  "url": "http://localhost:3000",
  "viewport": { "width": 1200, "height": 750 },
  "out": "../docs/demo-web.svg",
  "steps": [
    { "shot": "A todo app in 2 KB" },
    { "type": "Record a demo", "into": "#new-todo", "shot": "Type a task" },
    { "press": "Enter", "shot": "Enter adds it" },
    { "click": "li:first-child input[type=checkbox]", "shot": "Tick it off", "holdMs": 3000 }
  ]
}
```

Actions (one per step): `goto` (url), `click` (CSS selector, draws a pointer so viewers see the click), `type` + optional `into` (selector), `press` (`Enter`, `Tab`, `Escape`, `ArrowDown`, ...), `scroll` (pixels), `waitFor` (selector), `wait` (ms), `eval` (JS run in the page).
Any step can also have `shot` — `true`, or a short caption shown as a pill at the bottom — plus `holdMs` (how long that frame stays, default 2200) and `waitMs` (settle time after the action).

Top level: `title`, `url`, `viewport` (`width`, `height`, `scale`, `mobile`, `colorScheme`), `theme` (frame colors), `quality` (JPEG, default 80), `displayWidth` (960), `framesDir` (also save each screenshot as `.jpg`), `out`.

Tips: 3–6 shots is ideal. Captions are short verbs ("Drag to reorder"). Keep the file under ~3 MB: fewer shots, smaller viewport or lower `quality`.

## Step 5 — Record

```bash
node "<this skill's base directory>/scripts/term-svg.mjs" .trailer/terminal.json
node "<this skill's base directory>/scripts/web-svg.mjs" .trailer/web.json
```

## Step 6 — Watch it before showing anyone

Open the SVG and look at it (a browser tool, or an HTML page with `<img src="docs/demo.svg">`, which is how GitHub shows it). Check: text not cut off, no errors in the output, colors readable, timing not too fast, the wow moment is clearly visible. Fix the scenario and re-record until it looks good.

## Step 7 — The README

Edit the existing README; **never delete the author's content without asking**. Move things around, tighten the top, add what is missing. Structure that works:

1. **Name + one-line pitch** — what it does, for whom, in plain words. No buzzwords.
2. **The demo** — `<p align="center"><img src="docs/demo.svg" alt="..." width="800"></p>` right under the pitch.
3. **Quick start** — the shortest path from zero to the wow moment. Copy-pasteable, one command if possible.
4. **Why / features** — 3–6 bullets, each a concrete benefit. Only things that are true today.
5. **Usage** — a few real examples with their output.
6. **How it works** (optional, short), **Contributing**, **License**.

Writing rules: short sentences, real commands, real output, no claims you have not verified, no fake badges or star counts. Tell the user what you changed and show them the demo.

## Step 8 — Hand over

Tell the user where the files are, how to re-record (`node .../term-svg.mjs .trailer/terminal.json`), and remind them to commit `docs/demo*.svg` and `.trailer/`.
