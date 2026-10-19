# Personalize Rabbithole: plan

Branch: `feature/personalize`. Six sub-plans run in parallel, each in its own git worktree, then merge here.

## Scope

| # | Feature | Sub-plan |
|---|---|---|
| 1 | Continue opens your last stop | Already works (`openDive` keeps `graph.active`); no change |
| 2 | Star a node, Starred list on Home | B (star), A (list) |
| 3 | Your own notes on a node | Already exists; B2 moves it up under the summary |
| 4 | Hover preview on suggestions | B |
| 6 | Trail replay | B |
| 9 | Daily rabbit hole | A |
| P1 | Interest profile: seeds on Home, mute in Settings | A, D |
| P2 | Reading level: Quick / Standard / Deep | B2, D |
| P3 | Preferred sources: web on/off, blocked domains | B2, D |
| P4 | Curiosity stats on Home | A |
| 5+7 | Make it yours: accent, font, density over any theme | D |
| 8 | Graph layout: tree, top-down, radial | C, D |
| 10 | Dive icon and color in the sidebar | E |
| 11 | Topic imagery (Wikipedia lead image) | B2 (fetch, inspector), B (card) |
| 12 | Minimap depth heat | C |
| 13 | Dock icon follows the theme (macOS, while running) | E, D |
| 14 | Sounds on Go deeper and open (haptics: Electron has no trackpad API) | E, D |
| 15 | Rotating example seeds on Home, every 5 s | A |

## Shared contract (already on the branch)

- `graph.ts`: `GraphNode.starred`, `Graph.visits: {id, t}[]`, `Research.image`.
- `App.tsx`: `Dive.icon`, `Dive.color`; `clone()` copies `visits`; `prefsTick` re-renders on pref changes; `applyCustom()` runs after every theme change.
- `prefs.ts`: `readingLevel, web, blocked, muted, accent, font, density, layout, sounds, dockIcon` with defaults.
- `interests.ts`: `interests(graphs)` ranked topics, muted ones left out.
- Stubs: `custom.ts` (`applyCustom`), `sound.ts` (`chime`).
- CSS: one file per sub-plan in `src/styles/` (`home`, `node`, `research`, `graph`, `custom`, `platform`), already imported.

## Sub-plans

| Sub-plan | Owns | Model |
|---|---|---|
| A Home | Home block in `App.tsx`, `startTopic`, new `HomeExtras.tsx`, `styles/home.css` | Sonnet |
| B Node | `select()`, card JSX in `App.tsx`, inspector header and quiet actions, new `NodeExtras.tsx`, `styles/node.css` | Sonnet |
| B2 Research | `doResearch()`, inspector content sections (Summary through Sources, Your notes), `wiki.ts` image, `styles/research.css` | Sonnet |
| C Graph | `buildView()`, `view` memo, minimap block, `graph.ts` layout helper, `styles/graph.css` | Sonnet |
| D Settings | `Settings.tsx`, `custom.ts`, `styles/custom.css` | Sonnet |
| E Platform | sidebar list in `App.tsx`, `deeper()`, `allDives` memo, `sound.ts`, new `dockIcon.ts`, `electron/main.cjs`, `electron/preload.cjs`, `ai.ts` bridge type, `styles/platform.css` | Sonnet |

Rules for every sub-plan: touch only the regions above, write code that reads like the code around it, keep every new label in title case for buttons and sentence case for help text, respect `prefers-reduced-motion`, and run `npx tsc --noEmit -p .`, `npm run lint` and `npm run check` before committing.

## Merge and check

1. Merge each branch into `feature/personalize`, resolving overlaps by hand.
2. `npm run build`, `npm run lint`, `npm run check`.
3. Walk every feature in the running app, in light and dark, Liquid Glass and one other theme.
