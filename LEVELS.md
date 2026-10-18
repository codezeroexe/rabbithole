<!-- levels
idea: 4/4 gaps=2
-->

# Levels

## Shared

- Product: Rabbithole, a desktop graph explorer for deep dives. You start from a topic and branch into suggested related topics.
- Users: curious people exploring a subject; one user per machine.
- Runs on: Electron desktop app, macOS (Apple silicon) and Windows (x64).
- Purpose: a product for real users.
- Hard limits: must stay free and keyless by default; local-first, with no server and no account.
- Time per feature: open-ended. Ambition: mostly safe ideas, plus one bold one.

## Idea

Date: 2026-10-18. Level reached: 4 (Validated) for Read and branch; the other ideas are at 3. Target: 4.

### Scoring criteria

| Criterion | Weight |
|---|---|
| Pull: makes people dive longer and come back | 35% |
| Distinct: something Wikipedia, ChatGPT or Obsidian can't do | 25% |
| Feasible on the current stack | 20% |
| Spread: users show it to others without an account or server | 20% |

### Shortlist (scores out of 100)

| # | Idea | Pull | Distinct | Feasible | Spread | Score |
|---|---|---|---|---|---|---|
| 1 | Bridge mode: find a path between two topics | 4 | 5 | 3 | 4 | 81 |
| 2 | Read and branch: inline article reader where every link is a branch (validated, see below) | 5 | 3 | 4 | 2 | 74 |
| 3 | "You've been here before": links across dives | 4 | 5 | 4 | 1 | 73 |
| 4 | Single-file shareable dive (interactive HTML) | 2 | 4 | 4 | 5 | 70 |
| 5 | Images on cards (Wikimedia) | 4 | 2 | 5 | 3 | 70 |
| 6 | Drift: the app explores on its own while you watch (outlier) | 3 | 5 | 3 | 3 | 70 |
| 7 | Daily door: one featured topic a day | 4 | 2 | 5 | 2 | 66 |
| 8 | Map and timeline views | 3 | 4 | 3 | 3 | 65 |
| 9 | "Why connected?" note on each edge | 3 | 4 | 3 | 2 | 61 |

Cut: live collaboration and cloud sync (need a server or account); a focus timer (works against the product's pull); text-to-speech, source badges and curiosity stats (low pull); flashcards, a pin queue, search and a command palette (useful polish, not a reason to choose the product).

### Read and branch: validation (level 4)

What exists (web search, 2026-10-18; whether each is still maintained was not checked):
- Browser extensions that record your Wikipedia clicks as a tree: Rabbit Hole (Chrome, last updated 2020, notes on links), Rabbit Hole Tracker (Chrome, 2026, time per page), RabbitHole (Chrome, local only), Wiki-Trace (Firefox).
- Wiki Rabbit (iPhone): a swipeable feed of Good Articles, with a shareable trail.
- Wikiweb and WikiLinks (iOS, about 2012): link maps; current availability unknown.
- None found combines in-place reading with suggested next topics, research notes and export. Reading with a recorded trail does exist, so Distinct drops from 4 to 3 (score 79 to 74).

Technical checks (live requests, 2026-10-18):
- The Action API `parse` with `section=N` returns one section at a time: the Minecraft lead is 43 KB with 96 article links and loads in about 1.6 s; a later section is 36 KB. The section list is 7 KB and lists 35 sections. Load the lead first and each section when opened.
- The whole article is too big to load at once: 1.0 to 1.7 MB through `parse`, REST `page/html` or `mobile-html`, about 2 s each.
- All three endpoints send `access-control-allow-origin: *`. Links come as `/wiki/Title`, which the existing `linksInParagraphs` pattern already reads.
- Rate limits (secondary source, not confirmed on the official page): anonymous Action API requests one at a time, under 5 per second. One section per click fits.
- The license is CC BY-SA 4.0 (known, not re-checked): show attribution and a link to the article.
- Risk: article HTML is third-party content in the renderer, which has the `window.rh` bridge. Sanitize it to an allow-list (text, headings, lists, links, figure captions), and strip scripts, styles, event attributes, iframes and forms.

Smallest version worth building:
- A Read tab in the panel for nodes backed by Wikipedia. It loads the lead section, sanitized, with the other sections as collapsed headings that load when opened.
- Clicking an article link adds it as a child of the current node and moves there. Links that are already on the graph are marked.
- Each node records how it was reached: a suggestion, a reader link or a steer. This is stored only in the dive and never sent anywhere.
- Left out: infobox tables, galleries, references, pages from web search, offline cache, other languages, search within the article.

Built 2026-10-18 (Read tab, link branching, `via` on nodes). Continue or stop test: after two weeks of your own use, plus three to five testers sharing exported dives, count new nodes by how they were reached. Fewer than 20% from reader links means reading does not pull people further, so stop. More than 40% means it becomes the main way to move through a dive.

### Open gaps

1. Bridge mode: check what Wikipedia path-finding tools already exist and whether two-way link search stays under the API rate limits.
2. Cross-dive links: decide the matching key (Wikipedia page ID) and how this behaves with web-only nodes.
