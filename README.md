# Rabbithole

A graph explorer for deep dives. Type a topic, and Rabbithole suggests where to go next as text cards laid out in columns, one column per depth level. Open a suggestion to go deeper, add your own node to steer, dismiss what you don't want, and the next suggestions follow your taste. Each opened node gets a short research note.

## Install

Download a build from the repo's **Actions** run (or **Releases**, for tagged versions):

| System | File | Notes |
|---|---|---|
| Windows | `Rabbithole-Setup-<version>-x64.exe` | Installer: pick a folder, adds Start menu and desktop shortcuts. x64 PCs only. |
| Windows | `Rabbithole-<version>-portable.exe` | No install: run it from anywhere, a USB stick included. |
| macOS | `Rabbithole-<version>-arm64.dmg` | Apple silicon only. Drag to Applications. |
| Linux | `Rabbithole-<version>-x86_64.AppImage` | `chmod +x` it, then run it. |

To pin it: on Windows, right-click the running app in the taskbar and choose **Pin to taskbar**. On macOS, right-click it in the Dock, then **Options › Keep in Dock**.

The builds are not code-signed yet. On first run, Windows SmartScreen shows "Windows protected your PC": choose **More info › Run anyway**. On macOS, right-click the app and choose **Open**.

## Backends

Open **Settings** in the header and pick one:

| Backend | Needs | Good for |
|---|---|---|
| Free: Wikipedia (default) | nothing | any topic, no key, no model: every card is a real Wikipedia article linked from its parent |
| Built-in tiny model | a one-time download (400 MB, or 1.1 GB for the better model) | a real model running inside the app: no LM Studio, Ollama or key |
| Offline demo | nothing | trying the app without internet (car topics only) |
| Ollama, LM Studio | the app running locally | free, private, offline |

Every backend is free: no API key and no account. Paid providers (Anthropic, OpenAI, Gemini, OpenRouter, OpenCode, custom servers) were removed; a saved choice of one falls back to Wikipedia, and any keys stored by older versions are deleted on first launch.

**Web search:** keyless by default: Bing and DuckDuckGo results with the top pages read, plus Google News headlines. "Wikipedia only" and "No web search" are the other choices. With search on, each research note is based on the results, and only those are listed as sources.

**Light local model:** Ollama with a small model (`ollama pull qwen2.5:0.5b` or `llama3.2:1b`) runs on most laptops. Model backends are grounded in the Wikipedia article for each node, so even small models stay on topic.

## Develop

Node 22 or later.

```bash
npm install
npm run app
```

`npm run app` builds the page and opens the desktop app. To get hot reload, run `npm run dev` in one terminal and `npm run app:dev` in another. Run `npm run dev` alone for the plain browser version: it has the Wikipedia engine and the offline demo; model backends need the desktop app.

Build installers locally:

```bash
npm run dist:mac
```

`dist:win` and `dist:linux` work the same way. Windows and Linux builds are most reliable on their own systems, which is what `.github/workflows/build.yml` does on every push to `main`. Push a tag such as `v0.2.0` to publish a release.

## Using it

- **Click a suggestion** (dashed card) to open it. Its own suggestions appear in the next column, and a research note fills the side panel.
- **Steer:** type a node name in the bottom bar. It is added under the active node, and the other suggestions are fetched again with it as a hint.
- **Dismiss** with the × on a card. A dismissed node stays visible and the model is told to avoid it.
- **Focus ↔ Spread** sets how many of the 4 suggestions are lateral tangents (0 to 3).
- **Space** opens the best non-tangent suggestion. Drag the empty canvas to pan.
- **Export:** a Markdown outline (download), or an Obsidian vault written straight into a folder you pick. Picking a folder needs Chrome or Edge; other browsers download one combined file.
- **Themes:** Obsidian dark, Claude Warm and Nothing OS 5, picked in the header.

The graph, theme and model are saved in this browser's local storage.

## Checks

```bash
npm run check
```

Runs `src/graph.check.ts`: graph logic, steering and dismissal context, column layout, vault export and model-reply parsing.

## Files

- `src/graph.ts`: graph state and pure helpers (layout, context for the model, exports).
- `src/ai.ts`: prompts and reply parsing; sends text through the desktop bridge.
- `src/Settings.tsx`: the backend, model and web search settings.
- `electron/main.cjs`: the window, settings, and every call to a backend or search API.
- `electron/preload.cjs`: the narrow bridge (`window.rh`) between the page and the main process.
- `src/mock.ts`: offline demo data.
- `src/App.tsx`, `src/index.css`: the UI and the three themes.

## Fonts

The Nothing OS 5 theme uses NType82 and NDot 55 from `public/fonts/`. They are Nothing's proprietary typefaces, for private use only. `.gitignore` keeps them out of git. Without them, the theme falls back to Geist, DM Mono and Doto from Google Fonts.

## Known limits

- Speed depends on the backend: the built-in Qwen3 0.6B took about 1.3 s per reply on an M4 in testing; Ollama and LM Studio depend on the model and the computer.
- Sources come from the model's memory, not a web search, and the app labels them as unchecked.
- Card heights in the layout are estimates. Long text is clamped, so cards should not overlap, but very long labels can.
- Builds are unsigned (see Install). Signing needs an Apple Developer ID and a Windows code-signing certificate.
- The Nothing OS 5 fonts are gitignored, so CI builds use the fallback fonts. Local builds include them: keep those builds private.
