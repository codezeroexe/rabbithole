# Rabbithole

A graph explorer for deep dives. Type a topic, and Rabbithole suggests where to go next as text cards laid out in columns, one column per depth level. Open a suggestion to go deeper, add your own node to steer, dismiss what you don't want, and the next suggestions follow your taste. Each opened node gets a short research note.

## Install

Download a build from the repo's **Actions** run (or **Releases**, for tagged versions):

| System | File | Notes |
|---|---|---|
| Windows | `Rabbithole-Setup-<version>-x64.exe` | Installer: pick a folder, adds Start menu and desktop shortcuts. ARM PCs: the `-arm64` file. |
| Windows | `Rabbithole-<version>-portable.exe` | No install: run it from anywhere, a USB stick included. |
| macOS | `Rabbithole-<version>-arm64.dmg` / `-x64.dmg` | Apple silicon / Intel. Drag to Applications. |
| Linux | `Rabbithole-<version>-x86_64.AppImage` | `chmod +x` it, then run it. |

To pin it: on Windows, right-click the running app in the taskbar and choose **Pin to taskbar**. On macOS, right-click it in the Dock, then **Options › Keep in Dock**.

The builds are not code-signed yet. On first run, Windows SmartScreen shows "Windows protected your PC": choose **More info › Run anyway**. On macOS, right-click the app and choose **Open**.

## Backends

Open **Settings** in the header and pick one:

| Backend | Needs | Good for |
|---|---|---|
| Offline demo | nothing | trying the app (car topics only) |
| Anthropic, OpenAI, Google Gemini | an API key | fast, high-quality suggestions |
| OpenRouter | one API key | hundreds of models, some free |
| Ollama, LM Studio | the app running locally | free, private, offline |
| Custom OpenAI-compatible | a server URL (and a key if it needs one) | self-hosted or other providers |
| OpenCode | OpenCode installed | reusing the providers set up in OpenCode; the app starts and stops OpenCode itself |

OpenCode's own free models only work inside the OpenCode app, so pick a model from another provider there.

**Web search (optional):** add a Tavily or Brave Search key, and each research note is based on 5 fetched results. Only those pages are listed as sources.

API keys are encrypted with the system keychain (Electron `safeStorage`) and stored in the app's settings file. They never reach the page, and each is sent only to its own provider.

## Develop

Node 22 or later.

```bash
npm install
npm run app
```

`npm run app` builds the page and opens the desktop app. To get hot reload, run `npm run dev` in one terminal and `npm run app:dev` in another. Run `npm run dev` alone for the plain browser version: it reaches OpenCode through the Vite proxy (`npm run opencode` starts that server).

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
- `src/Settings.tsx`: the backend, model, key and web search settings.
- `electron/main.cjs`: the window, encrypted settings, and every call to a backend or search API.
- `electron/preload.cjs`: the narrow bridge (`window.rh`) between the page and the main process.
- `src/mock.ts`: offline demo data.
- `src/App.tsx`, `src/index.css`: the UI and the three themes.

## Fonts

The Nothing OS 5 theme uses NType82 and NDot 55 from `public/fonts/`. They are Nothing's proprietary typefaces, for private use only. `.gitignore` keeps them out of git. Without them, the theme falls back to Geist, DM Mono and Doto from Google Fonts.

## Known limits

- Speed depends on the backend: GLM 5.3 Flash on NVIDIA through OpenCode took 80–100 s per call in testing. Hosted APIs answer in seconds.
- Sources come from the model's memory, not a web search, and the app labels them as unchecked.
- Card heights in the layout are estimates. Long text is clamped, so cards should not overlap, but very long labels can.
- Builds are unsigned (see Install). Signing needs an Apple Developer ID and a Windows code-signing certificate.
- The Nothing OS 5 fonts are gitignored, so CI builds use the fallback fonts. Local builds include them: keep those builds private.
