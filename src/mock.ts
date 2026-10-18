// Offline demo engine: canned car data only. Topics it does not know get no suggestions,
// rather than generic filler like "X history".
import type { ExpandContext, Research, Suggestion } from './graph.ts'

type Entry = { summary?: string; facts?: [string, string][]; focus: string[]; spread: string[]; steer?: Record<string, string[]> }

const LIB: Record<string, Entry> = {
  cars: { summary: 'Road vehicles built to carry people. This seed fans out into how cars are grouped, who makes them and what is happening now.',
    focus: ['Types', 'Recent launches', 'News', 'Brands', 'Engines', 'Racing'], spread: ['Car culture', 'Road trip history', 'Urban design'] },
  brands: { summary: 'The companies that design and sell cars, from mass-market makers to small exotic builders.',
    focus: ['Ford', 'BMW', 'Mercedes-Benz', 'Toyota', 'Honda', 'Volkswagen'],
    steer: { ferrari: ['Lamborghini', 'McLaren', 'Pagani', 'Bugatti', 'Koenigsegg'], porsche: ['Lotus', 'Aston Martin', 'McLaren', 'Audi Sport'], toyota: ['Honda', 'Nissan', 'Mazda', 'Subaru'] },
    spread: ['Badge engineering', 'Car logos', 'Brand loyalty'] },
  types: { focus: ['Sedans', 'SUVs', 'Hatchbacks', 'Sports cars', 'Pickups', 'Electric cars'], spread: ['Kei cars', 'Microcars'] },
  'recent launches': { focus: ['New EVs', 'New hybrids', 'Concept cars', 'Facelifts'], spread: ['Launch events', 'Car reveal marketing'] },
  news: { focus: ['Industry news', 'EV policy', 'Recalls', 'Motorsport news'], spread: ['Autonomous driving', 'Battery supply chains'] },
  ferrari: { summary: 'Italian maker of sports and racing cars, based in Maranello. Known for V12 road cars, the Prancing Horse badge and its Formula 1 team.',
    facts: [['Founded', '1939 (first car 1947)'], ['Base', 'Maranello, Italy'], ['Founder', 'Enzo Ferrari']],
    focus: ['F40', 'Enzo', 'Maranello', 'Scuderia Ferrari', 'LaFerrari', '250 GTO'], spread: ['Pininfarina', 'Prancing horse badge', 'Enzo Ferrari biography'] },
  f40: { summary: "Built for Ferrari's 40th anniversary and the last car Enzo Ferrari approved himself. A stripped-back, twin-turbo road racer that set the supercar benchmark of the late 1980s.",
    facts: [['Produced', '1987–1992'], ['Engine', '2.9 L twin-turbo V8'], ['Output', '478 PS'], ['Top speed', '324 km/h']],
    focus: ['Twin-turbo V8', 'F40 LM', 'Production run', 'Body design'], spread: ['1980s supercar war', 'Porsche 959'] },
  lamborghini: { summary: 'Italian supercar maker founded by Ferruccio Lamborghini, who built tractors first.',
    facts: [['Founded', '1963'], ['Base', "Sant'Agata Bolognese, Italy"], ['Founder', 'Ferruccio Lamborghini']],
    focus: ['Miura', 'Countach', 'Aventador', 'Huracán'], spread: ['Tractor origins', 'Bull naming tradition'] },
  maranello: { summary: 'Town in Emilia-Romagna, northern Italy. Home of the Ferrari factory and headquarters.',
    focus: ['Ferrari factory', 'Fiorano test track', 'Ferrari museum'], spread: ['Motor Valley'] },
  pininfarina: { summary: 'Italian design house founded in Turin in 1930. It styled many classic Ferraris.',
    facts: [['Founded', '1930'], ['Base', 'Turin, Italy'], ['Founder', 'Battista "Pinin" Farina']],
    focus: ['Ferrari designs', 'Design studio', 'Famous designers'], spread: ['Italian coachbuilding'] },
}

const TEASE: Record<string, string> = {
  types: 'How cars are grouped.', 'recent launches': 'New models this season.', news: 'What is happening now.', brands: 'Who makes cars.',
  ferrari: 'Prancing Horse from Maranello.', lamborghini: "Ferrari's rival from Sant'Agata.", f40: 'The last Ferrari Enzo approved.',
  enzo: '2002 hypercar named after the founder.', maranello: "Ferrari's hometown and factory.", pininfarina: 'Design house behind many classic Ferraris.',
}

const lc = (s: string) => s.toLowerCase()
const entry = (label: string): Entry => LIB[lc(label)] ?? { focus: [], spread: [] }
const tease = (label: string) => TEASE[lc(label)] ?? `Dive into ${label}.`

export function mockSuggest(c: ExpandContext): Suggestion[] {
  const e = entry(c.label)
  const excl = new Set(c.avoid.map(lc))
  let focus: string[] = []
  for (const s of c.steered) focus.push(...(e.steer?.[lc(s)] ?? []))
  focus = focus.concat(e.focus)
  const out: Suggestion[] = []
  const take = (list: string[], count: number, tangent: boolean) => {
    const start = list.length ? (c.rolls * count) % list.length : 0
    for (let i = 0, got = 0; i < list.length && got < count; i++) {
      const label = list[(start + i) % list.length]
      if (excl.has(lc(label))) continue
      excl.add(lc(label))
      out.push({ label, teaser: tease(label), tangent })
      got++
    }
  }
  take(focus, c.focusCount, false)
  take(e.spread, c.tangentCount, true)
  return out
}

export function mockResearch(path: string[]): Research {
  const label = path[path.length - 1]
  const e = LIB[lc(label)]
  return {
    summary: e?.summary ?? `Offline demo: no research for ${label}. Pick another backend in Settings to research it for real.`,
    facts: (e?.facts ?? []).map(([k, v]) => ({ k, v })),
    sources: [],
  }
}
