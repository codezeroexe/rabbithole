# Improvements: build specs

Ranked from quickest to longest. Each spec is written so one executor (Haiku or Sonnet) can build it
without asking questions. Every spec ends with a done check; run `npm run check`, `npm run lint` and
`npm run build` after each one as well.

Shared facts for every executor:

- All graph state changes go through `commit(fn)` in `src/App.tsx`. It clones the graph, applies `fn`,
  stamps `updated` and re-renders. Never mutate `ref.current` directly.
- Pure graph logic lives in `src/graph.ts` and is tested in `src/graph.check.ts` with `node:assert`.
  Logic added to `graph.ts` gets asserts there, in the same style.
- Every Wikipedia and Wikidata request goes through `wikimedia()` in `src/net.ts`.
- Web search and news run in the main process (`electron/main.cjs`, `webSearch`, `newsSearch`) and
  reach the renderer through `bridge` (`src/ai.ts`).
- Themes style through CSS custom properties in `src/index.css`. Reuse existing tokens and classes;
  do not add colours.
- API keys never reach the renderer. The private fonts in `public/fonts/` are never committed.

Size: S is under 1 hour, M is 1 to 3 hours, L is half a day or more.

Dropped from the list: "model setup screen". `src/Settings.tsx` already shows the model size, a
download progress bar and a Test connection button.

| Rank | Improvement | Size | Model |
|---|---|---|---|
| 1 | Merge near-duplicate branches | S | Haiku |
| 2 | Search across all dives | S | Haiku |
| 3 | Source badge on cards | S | Haiku |
| 4 | Undo and redo | S | Sonnet |
| 5 | Local cache for Wikipedia and web requests | S–M | Sonnet |
| 6 | Full keyboard driving | M | Sonnet |
| 7 | Zoom, fit-to-path and minimap | M | Sonnet |
| 8 | Prefetch the next level | M | Sonnet |
| 9 | Inline citations in notes | M | Sonnet |
| 10 | Fold old levels | L | Sonnet |
| 11 | Stream branches in | L | Sonnet |
| 12 | Signed builds and auto-update | L, plus paid accounts | Sonnet, plus the user |

---

## 1. Merge near-duplicate branches (S, Haiku)

**Goal.** The same thing never appears twice in a graph under slightly different names
("Ferrari" and "Ferrari (company)", "Car" and "Cars", "The Beatles" and "Beatles").

**Files.** `src/graph.ts`, `src/graph.check.ts`. Touch nothing else.

**Behaviour.**

1. Add to `graph.ts`, exported:
   ```ts
   // "The Beatles" = "Beatles", "Ferrari (company)" = "Ferrari", "Cars" = "Car".
   export const norm = (s: string) =>
     s.toLowerCase().replace(/\s+\([^)]*\)$/, '').replace(/^(the|a|an)\s+/, '')
       .replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean)
       .map((w) => (w.length > 3 ? w.replace(/(ies)$/, 'y').replace(/(?<!s)s$/, '') : w)).join(' ')
   ```
2. In `addGhosts`, replace `lc(...)` with `norm(...)` for both the `taken` and `siblings` sets, for the
   existing labels and for the incoming `s.label`.
3. Also skip an incoming suggestion whose `s.ref` equals the `ref` of any node already in the graph.
   Build `const refs = new Set(g.nodes.map((n) => n.ref).filter(Boolean))` next to `taken`, and add
   each accepted `s.ref` to it.
4. Do not change `steerNode` or `linkNode`; the user's own input is never merged away.

**Done check.** Add asserts to `graph.check.ts`:
- `norm('The Beatles') === norm('Beatles')`, `norm('Ferrari (company)') === norm('Ferrari')`,
  `norm('Cars') === norm('Car')`, `norm('Glass') !== norm('Glas')` (the `ss` ending stays).
- After `addGhosts(g, 'root', [{ label: 'Ferrari', ... }, { label: 'Ferrari (company)', ... }])`
  only one child is added.
- Two suggestions with different labels but the same `ref` add one child.
Existing asserts must still pass.

---

## 2. Search across all dives (S, Haiku)

**Goal.** From Home, find any topic you met in any earlier dive and jump straight to it.

**Files.** `src/App.tsx`, `src/index.css`.

**Behaviour.**

1. State: `const [query, setQuery] = useState('')`.
2. On Home, directly above the `.toc` list (around `src/App.tsx:502`), when `allDives.length >= 2`,
   render:
   ```tsx
   <input type="search" className="field toc-search" placeholder="Search your dives"
     aria-label="Search your dives" value={query} onChange={(e) => setQuery(e.target.value)} />
   ```
3. When `query.trim()` is not empty, the toc shows only dives with at least one match. A node matches
   when its `label`, its `research?.summary` or `graph.notes[node.id]` contains the query
   (case-insensitive). Under each matching dive's row, list up to 3 matching node labels as buttons
   with class `toc-hit`. Clicking a hit opens that dive with that node active.
4. Change `openDive(id)` to `openDive(id, nodeId?: string)`. When `nodeId` is given and exists in that
   dive, set `active` to it on the copy loaded into `ref.current` (`{ ...d.graph, active: nodeId }`).
5. No matches: show `<p className="label">Nothing in your dives matches "{query}".</p>` in place of
   the list.
6. Clear `query` in `goHome`.
7. CSS: `.toc-search` full width with the existing field styles and a bottom margin of 12px.
   `.toc-hit` reuses the `.link-btn` look, indented 16px.

**Done check.** With 3 dives, typing a label that exists only in dive 2 shows only dive 2 and the
matching node. Clicking the hit opens dive 2 with that node active and centred. Clearing the field
restores the full list. Typing nonsense shows the empty message.

---

## 3. Source badge on cards (S, Haiku)

**Goal.** When a branch was invented by an AI model rather than taken from Wikipedia, the card says so,
so people know which ones to double-check.

**Files.** `src/graph.ts`, `src/App.tsx`, `src/index.css`.

**Behaviour.**

1. `graph.ts`: add `origin?: 'wiki' | 'model' | 'web'` to both `Suggestion` and `GraphNode`. In
   `addGhosts`, copy `origin: s.origin` onto the new node.
2. `App.tsx`, in `expand`:
   - FREE engine: items from `wikiSuggest` get `origin: s.offWiki ? 'web' : 'wiki'`.
   - Model engine: an item matched to the Wikipedia pool (`p` found in `byLabel`) gets `'wiki'`; an
     unmatched item gets `'model'`.
   - The Wikipedia fallback after a model failure gets `'wiki'`. Offline mock items get no origin.
3. In `buildView`, add `badge: n.origin === 'model' ? 'AI' : n.origin === 'web' ? 'Web' : ''` to each
   card. Only these two are shown; Wikipedia is the normal case and gets no badge.
4. Render the badge inside the card next to the existing tag:
   `<span className="card-badge" title={c.badge === 'AI' ? 'Suggested by the AI model, not found on Wikipedia' : 'Found on the web, not on Wikipedia'}>{c.badge}</span>`.
5. CSS `.card-badge`: 10px uppercase, letter-spacing 0.06em, 1px solid `var(--ctrl-border)`, radius 4px,
   padding 0 4px, colour `var(--text2)`. Add `aria-hidden` to nothing; screen readers should hear it.

**Done check.** With a model backend set, cards the model invented show "AI"; cards from the Wikipedia
pool show nothing. With the free engine, no card shows "AI". An off-wiki node shows "Web". Old saved
dives (no `origin`) render with no badge and no errors.

---

## 4. Undo and redo (S, Sonnet)

**Goal.** Re-roll, dismiss, steer and breadth changes can be undone with Cmd+Z / Ctrl+Z and redone with
Shift+Cmd+Z / Ctrl+Y, so a good set of suggestions is never lost to a slip.

**Files.** `src/App.tsx`, `electron/main.cjs`.

**Behaviour.**

1. `App.tsx`: `const past = useRef<Graph[]>([])` and `const future = useRef<Graph[]>([])`.
2. `const snapshot = () => { if (!ref.current) return; past.current.push(clone(ref.current)); if (past.current.length > 30) past.current.shift(); future.current = [] }`.
3. Call `snapshot()` as the first line of `dismiss`, `reroll`, `narrow` and `setSpread`. Do not
   snapshot `select`, `expand`, `doResearch` or note typing.
4. `restore(g)`: clear `loading` and `researching` on every node of `g` (in-flight requests then find
   their request id gone and drop their result, which `expand` and `doResearch` already handle), set
   `ref.current = g`, `setGraph(g)`, `setPan({ x: 0, y: 0 })`.
5. `undo()`: pop from `past`, push `clone(ref.current)` to `future`, `restore(popped)`.
   `redo()`: the mirror image.
6. Clear both stacks in `openDive`, `goHome` and `startTopic`.
7. Text fields must keep their own undo. Electron's `{ role: 'editMenu' }` owns Cmd+Z, so in
   `main.cjs` replace it with an explicit Edit menu: Undo (`CmdOrCtrl+Z`) and Redo
   (`Shift+CmdOrCtrl+Z`, plus `Ctrl+Y` on Windows) items with `click: () => send('undo')` /
   `send('redo')`, followed by the standard `cut`, `copy`, `paste`, `selectAll` roles.
8. In `menuRef.current`, handle `'undo'` / `'redo'`: if `document.activeElement` is an input, textarea or
   `[contenteditable]`, call `document.execCommand('undo')` (or `'redo'`); otherwise call the graph
   `undo()` / `redo()`.
9. Browser mode (no `bridge`): add the same Cmd/Ctrl+Z handling to the existing `keydown` listener, with
   the same text-field check.

**Done check.** Re-roll, then Cmd+Z: the earlier suggestions come back. Dismiss a node with children,
Cmd+Z: node and subtree return. Cmd+Z while typing in the steer field undoes the typing, not the graph.
Undo during a running re-roll: the old set returns and the late reply does not overwrite it.
Switching dives and pressing Cmd+Z does nothing.

---

## 5. Local cache for Wikipedia and web requests (S–M, Sonnet)

**Goal.** Re-opening a dive or re-visiting a topic is instant and works offline for anything seen before.

**Files.** `src/net.ts`, `electron/main.cjs`.

**Behaviour.**

1. `net.ts`: cache successful GET responses of `wikimedia()` as text in IndexedDB (database `rh-cache`,
   store `http`, key = URL, value `{ t: Date.now(), body: string, status: number }`). IndexedDB is used
   because the packaged app loads from `file://`, where the Cache API is not reliable. Keep a
   `Map<string, ...>` in memory in front of it; if IndexedDB throws, use the Map alone.
2. Flow inside `wikimedia(url, headers)`:
   - Fresh hit (younger than 7 days): return `new Response(body, { status })` without a network call
     and without taking a queue slot.
   - Otherwise fetch as now. On `r.ok`, store `await r.clone().text()`.
   - Network error or timeout with a stale hit of any age: return the stale hit.
   - Network error with no hit: throw as now.
3. Prune once at start-up: delete entries older than 30 days.
4. `main.cjs`: wrap `webSearch` and `newsSearch` in a memo `Map<query, { t, value }>`. TTL 1 hour for
   web, 15 minutes for news. Cap at 200 entries (delete the oldest key when over). In memory only.
5. Do not cache failures, and do not cache anything in `localComplete` or the cloud model calls.

**Done check.** Open a dive and note the time for suggestions to appear. Restart the app, open the same
node: suggestions appear with no Wikipedia requests in DevTools Network. Turn off Wi-Fi: a previously
seen node still expands and researches; an unseen one shows the existing error message.

---

## 6. Full keyboard driving (M, Sonnet)

**Goal.** A whole dive can be done without a mouse.

**Files.** `src/App.tsx`, `src/index.css`.

**Keys** (all ignored while focus is in an input, textarea, select or `[contenteditable]`):

| Key | Action |
|---|---|
| Arrow Down / Arrow Up | Move keyboard focus to the next / previous card among the active node's children (ghosts and solids, not dismissed). From the active card, Down goes to the first child. |
| Arrow Right | Same as Go deeper (`deeper()`) |
| Arrow Left | Select the parent of the active node |
| Enter / Space on a focused card | Opens it (the card is a `<button>`, so this is native; do not add a handler) |
| X or Delete on a focused card | Dismiss that card's node; move focus to the next sibling, or the previous one if it was last |
| R | Re-roll |
| S | Focus the steer input |
| F | Fit to path (only once improvement 7 exists; skip otherwise) |
| ? | Toggle a small shortcuts sheet |

**Behaviour.**

1. Add `data-id={c.n.id}` to each card `<button>`. Find cards with
   `document.querySelector(\`.card[data-id="${id}"]\`)`.
2. Extend the existing `keydown` listener (around `src/App.tsx:349`). Keep the Space-goes-deeper rule
   for when focus is not on a card.
3. After `select()` moves the active node, move focus to the new active card on the next frame
   (`requestAnimationFrame`) only if the previous focus was on a card, so mouse users are not affected.
4. Focused cards must show a visible ring: `.card:focus-visible { outline: 2px solid var(--active);
   outline-offset: 3px }` if no such rule exists yet.
5. Shortcuts sheet: a `<dialog>` with the table above as a `<dl>`, closed by Escape (native) or `?`.
   Add a "Keyboard shortcuts" item to the Help menu in `main.cjs` that sends `'shortcuts'`.

**Done check.** From a fresh dive, using only the keyboard: go deeper three times, go up once, move to
a sibling, dismiss it, re-roll, steer with S then typing and Enter. Focus ring is visible at each step.
Typing "r", "s" or "x" in the steer field types letters and triggers nothing.

---

## 7. Zoom, fit-to-path and minimap (M, Sonnet)

**Goal.** In a big dive you can see where you are and jump anywhere.

**Files.** `src/App.tsx`, `src/index.css`.

**Behaviour.**

1. State `const [zoom, setZoom] = useState(1)`, clamped to 0.3–1.5. The camera transform at
   `src/App.tsx:521` becomes `translate(...) scale(${zoom})` with `transform-origin: 0 0`; adjust the
   translate so the active node stays centred at any zoom (multiply its position by `zoom`).
2. Ctrl+wheel (and trackpad pinch, which arrives as Ctrl+wheel) on the stage zooms around the pointer.
   Plain wheel pans (`pan.y -= deltaY`, `pan.x -= deltaX`). Call `preventDefault` on Ctrl+wheel only.
3. Fit to path: a toolbar button "Fit" (and key F) computes the bounding box of every node on
   `pathOf(graph, active)` plus the active node's children from `view.pos` (card half-size about
   125×90), then sets zoom = min(1, stageWidth / (boxWidth + 120), stageHeight / (boxHeight + 120))
   and pans so the box is centred. Read the stage size from a ref on the `.stage` element.
4. Reset: double-clicking empty canvas sets zoom 1 and pan 0.
5. Minimap: a 160×110 `<svg>` fixed in the stage's bottom-right corner, shown only when the graph has
   more than 12 visible nodes. Scale all `view.pos` into it; draw each node as a 4×3 rect
   (`fill: var(--muted)`, active and path in `var(--path)`) and the current viewport as a rect outline
   in `var(--active)`. Clicking a point pans the camera there. `aria-hidden="true"`, since the toc
   and keyboard paths already cover it.
6. Respect `prefers-reduced-motion`: no transition on zoom.

**Done check.** In a dive with 30+ nodes, Fit shows the whole path on screen. Ctrl+wheel zooms toward
the pointer. Clicking a far corner of the minimap pans there. Selecting a card still centres it.
Below 12 nodes, no minimap.

---

## 8. Prefetch the next level (M, Sonnet)

**Goal.** Go deeper usually feels instant because the next level was fetched while you were reading.

**Files.** `src/App.tsx`.

**Behaviour.**

1. Move the suggestion-fetching body of `expand` (everything between `const ctx = ...` and the final
   `commit`) into a plain function `fetchSuggestions(ctx: ExpandContext, kind: string):
   Promise<{ items: Suggestion[]; ref?: string; error?: string }>`. `expand` calls it; behaviour must
   not change.
2. `const prefetched = useRef(new Map<string, Promise<...>>())`, key `` `${id}:${spread}:${rolls}` ``.
3. Prefetch only when the engine is FREE (Wikipedia). Cloud models cost money and the local model has
   only 2 inference slots, so prefetching there would slow the user's real requests.
4. Triggers:
   - When `expand(id)` finishes with ghosts, prefetch the Go-deeper target (the first non-tangent ghost,
     same rule as `deeper()`).
   - `pointerenter` on a ghost card, after resting 400 ms (clear the timer on `pointerleave`).
   - At most 2 prefetches in flight; drop extra ones rather than queueing.
5. In `expand(id)`, if `prefetched` has the key, await that promise instead of fetching, then delete
   the key. Re-roll bumps `rolls`, so it never reuses a prefetch.
6. Clear the map in `openDive`, `goHome` and when `spread` changes.
7. A prefetch never calls `commit` and never sets an error; errors are kept in the result and only
   shown if `expand` later uses it.

**Done check.** Free engine: open a node, wait 3 seconds, press Space: children appear without
skeletons. DevTools shows no duplicate Wikipedia requests for that node. With a cloud backend, no
prefetch requests are made. Re-roll still gives a fresh set.

---

## 9. Inline citations in notes (M, Sonnet)

**Goal.** Each sentence of an AI-written note links to the source it came from, so a small model's
claims can be checked in one click.

**Files.** `src/ai.ts`, `src/App.tsx`, `src/index.css`, `src/graph.check.ts`.

**Scope.** Only the model path with search results (`research()` in `ai.ts`). Free-engine notes are
Wikipedia's own text and already list Wikipedia as their source.

**Behaviour.**

1. `researchPrompt`, with results: change the summary line to
   `summary: 2 or 3 plain sentences. End each sentence with the number of the result it comes from in square brackets, like [2].`
2. `parseResearch`, with results: read the cited numbers from the summary with `/\[(\d+)\]/g`. Build
   the final `sources` list as the union of cited numbers and `d.sources`, in first-cited order, each
   mapped through `results[n - 1]`. Rewrite each marker `[n]` in the summary to `[k]`, where k is the
   1-based position of that result in the final list. Remove markers whose number is out of range.
3. Render: where the panel shows `research.summary`, split it on `/(\[\d+\])/`. Each marker becomes
   `<sup><a href={sources[k-1].url} target="_blank" rel="noreferrer" title={sources[k-1].title}>{k}</a></sup>`.
   Plain text stays text. Cards keep showing the summary with the markers stripped
   (`summary.replace(/\s*\[\d+\]/g, '')`), in both `buildView` and `exportMarkdown`. The Obsidian vault
   export keeps the markers and numbers its Sources list to match.
4. CSS: `sup a { color: var(--link); text-decoration: none; font-size: 0.75em; padding: 0 1px }`.

**Done check.** Add asserts: a reply with summary `"A. [3] B. [1]"`, sources `[1]` and 3 results gives
sources `[results[2], results[0]]` and summary `"A. [1] B. [2]"`. A marker `[9]` with 3 results is
removed. In the app with a model backend and web search, the note shows clickable superscripts that
open the right pages; cards show no brackets.

---

## 10. Fold old levels (L, Sonnet)

**Goal.** Deep dives stay readable: levels far above you shrink to a single pill instead of filling
the screen.

**Files.** `src/graph.ts`, `src/App.tsx`, `src/index.css`, `src/graph.check.ts`.

**Behaviour.**

1. Rule: let `d` be the active node's depth. For each node on the active path at depth `<= d - 3`,
   hide all of its children except the one on the path. Nodes not on the path and deeper are
   unaffected (they are under hidden nodes anyway).
2. `graph.ts`: `relayout(g, unfolded: Set<string> = new Set())` takes the ids the user unfolded.
   When placing a folded path node, place only its path child, and return the count of hidden
   children in a new `folds: Record<string, number>` (change the return type to
   `{ pos, folds }`, and update all callers and the check file).
3. `buildView` drops cards and edges for nodes with no position. For each entry in `folds`, render a
   pill under its node: `<button className="fold-pill">+{count} more</button>`, positioned at the node's
   x and its y plus 70.
4. Clicking a pill adds that node id to a `unfolded` state set in `App.tsx`; the hidden siblings
   return. Selecting a node clears `unfolded`.
5. The depth rail counts only placed nodes.
6. CSS `.fold-pill`: reuse the `.chip` or crumb pill style of the current theme
   (`var(--crumb-plain)` background, `var(--text2)` text), 12px.

**Done check.** Asserts: a 5-deep path with 3 siblings at each level, active at depth 5, places only
path nodes at depths 0 to 2, and `folds` reports 2 hidden at each of them. With `unfolded` containing
the depth-1 node, its siblings are placed again. In the app, going 6 levels deep shows pills above;
clicking one shows the siblings; going up a level unfolds the right ones automatically.

---

## 11. Stream branches in (L, Sonnet)

**Goal.** Cards appear as soon as part of the answer is ready, instead of after the slowest request.

**Step 0: measure first.** Before building, add temporary `console.time` around `aspectsOf`,
`leadLinks`, `fitTo` and the whole `articleSuggest` in `src/wiki.ts`, run 10 expansions on varied
topics, and record the numbers. Continue only if aspects arrive at least 1 second before the full set
on average. Remove the timers afterwards. Report the numbers either way.

**Files.** `src/wiki.ts`, `src/graph.ts`, `src/App.tsx`, `src/graph.check.ts`.

**Behaviour (free engine only).**

1. `articleSuggest(c, title, onPartial?: (items: Suggestion[]) => void)`: as soon as `aspectsOf`
   resolves, call `onPartial` with the aspect items that would be shown (same `used` and `cross`
   filtering as now). Then continue as now and return the final list. Thread the callback through
   `wikiSuggest`.
2. `graph.ts`: `mergeGhosts(g, pid, items)`: keep existing ghosts of `pid` whose label is in `items`,
   remove the other ghosts of `pid`, then `addGhosts` the rest. Card ids of kept ghosts stay the same,
   so they do not jump or re-animate.
3. `App.tsx` `expand`: pass `onPartial` that commits `mergeGhosts` while leaving `n.loading` set
   (check `n.loading === req` first, as the final commit does). The final commit uses `mergeGhosts`
   instead of `addGhosts`.
4. `relayout`: while `n.loading` is set and the node already has some ghost children, reserve skeleton
   slots for `SKELETONS - kids.length` (minimum 0) after the real children, instead of only when there
   are no children.
5. Model engines are out of scope for this spec. Token streaming from `localComplete` (node-llama-cpp
   `onTextChunk`) over IPC is a separate follow-up.

**Done check.** Asserts for `mergeGhosts`: kept ghosts keep their ids, dropped ones go, new ones are
added. In the app, aspects appear first with skeletons below them, then related articles fill in.
Re-roll during a partial does not mix two sets.

---

## 12. Signed builds and auto-update (L, plus paid accounts)

**Goal.** No Gatekeeper or SmartScreen warnings on install, and the app updates itself.

**Needs the user first** (an executor cannot do these):
- Apple Developer Program membership (99 USD a year): a Developer ID Application certificate exported
  as `.p12`, an app-specific password and the team ID.
- Windows signing: Azure Trusted Signing (a monthly fee) or an OV code-signing certificate.
- GitHub repository secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, plus the Windows signing values.

**Files.** `package.json`, `electron/main.cjs`, `.github/workflows/build.yml`.

**Behaviour.**

1. Add `electron-updater` as a dependency. This is the one new dependency in this list; differential
   updates, signature checks and Squirrel.Mac are not worth hand-writing.
2. `package.json` build config: `"publish": [{ "provider": "github" }]`; `mac.target` adds `zip` next to
   `dmg` (mac auto-update needs the zip); `mac.notarize: true`; `mac.hardenedRuntime: true`.
   The Windows `portable` target cannot self-update; only `nsis` does. Say so in the README.
3. `main.cjs`, after `createWindow()` in `app.whenReady`:
   `if (app.isPackaged) require('electron-updater').autoUpdater.checkForUpdatesAndNotify().catch(() => {})`.
4. CI: remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`, pass the secrets as env, and on tags run
   electron-builder with `--publish always`.
5. node-llama-cpp's native files are already in `asarUnpack`; check they are signed by the mac build
   (`codesign -dv` on one `.node` file inside the app).

**Done check.** A tagged CI build produces a notarised dmg that opens without a warning on a second Mac
(`spctl -a -vv Rabbithole.app` says "accepted"). Install version N, publish N+1, relaunch: the app
offers the update and restarts into N+1. The Windows installer shows the publisher name in the UAC prompt.
