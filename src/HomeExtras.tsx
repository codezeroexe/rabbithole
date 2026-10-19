// Home extras: example seeds, today's rabbit hole, starred stops, threads and stats.
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pathOf } from './graph.ts'
import type { Graph } from './graph.ts'
import { interests } from './interests.ts'

export type HomeDive = { id: string; updated: number; graph: Graph }
type Props = { dives: HomeDive[]; onStart: (seed: string) => void; onOpen: (diveId: string, nodeId?: string) => void }
const at = (i: number) => ({ '--i': i }) as CSSProperties
const seedOf = (d: HomeDive) => d.graph.nodes[0].label
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
// Read the clock outside render (keeps components pure for the linter).
const now = () => new Date()
const dayKey = (t: number) => { const d = new Date(t); return d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate() }
// Days since the epoch by local date, so the pick changes at local midnight.
const dayNumber = (d = now()) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5)

const EXAMPLES = [
  'Why do cats purr?',
  'The Antikythera mechanism',
  'Tardigrades',
  'Bioluminescence',
  'The Voyager Golden Record',
  'Why is the sky blue?',
  'The Library of Alexandria',
  'Octopus intelligence',
  'How do vaccines work?',
  'The Rosetta Stone',
  'Why do we dream?',
  'Mycorrhizal networks',
  'Black holes',
  'How did the pyramids get built?',
  'Kintsugi',
  'Why is the ocean salty?',
  'The Dyatlov Pass incident',
  'Crows and tool use',
  'How do airplanes stay up?',
  'The Silk Road',
  'Sourdough',
  'The northern lights',
  'Why do we yawn?',
  'The Voynich manuscript',
]

const TODAY: { seed: string; hook: string }[] = [
  { seed: 'Tardigrades', hook: 'Microscopic animals that can survive being dried out for years.' },
  { seed: 'The Antikythera mechanism', hook: 'A Greek device from about two thousand years ago that tracked cycles of the sun and moon.' },
  { seed: 'Bioluminescence', hook: 'Living things from fireflies to deep-sea fish make their own light.' },
  { seed: 'The Voyager Golden Record', hook: 'Two gold-plated discs launched in 1977 carry sounds and images of Earth.' },
  { seed: 'The Library of Alexandria', hook: 'An ancient Egyptian center of learning whose end historians still debate.' },
  { seed: 'Octopus intelligence', hook: 'Octopuses can solve puzzles, and most of their neurons sit in their arms.' },
  { seed: 'The Rosetta Stone', hook: 'A stone found in 1799 whose three scripts helped scholars decipher Egyptian hieroglyphs.' },
  { seed: 'Mycorrhizal networks', hook: 'Fungi attach to plant roots and trade nutrients with them.' },
  { seed: 'The Great Emu War', hook: 'In 1932 Australian soldiers with machine guns were sent against emus, with little success.' },
  { seed: 'Plate tectonics', hook: 'Earth\'s outer shell is split into plates that move a few centimeters a year.' },
  { seed: 'The Dyatlov Pass incident', hook: 'Nine hikers died in the Ural Mountains in 1959, and the cause was debated for decades.' },
  { seed: 'Absolute zero', hook: 'The lowest possible temperature, -273.15 degrees Celsius, can be approached but not reached.' },
  { seed: 'The Voynich manuscript', hook: 'A medieval book in an unknown script that no one has deciphered.' },
  { seed: 'Sourdough', hook: 'Bread raised by a community of wild yeast and bacteria.' },
  { seed: 'Fibonacci numbers in nature', hook: 'Spirals in sunflowers and pinecones often count out Fibonacci numbers.' },
  { seed: 'The Hubble Space Telescope', hook: 'Launched in 1990, it has been observing from orbit for over three decades.' },
  { seed: 'Crows and tool use', hook: 'New Caledonian crows shape hooked tools from twigs and leaves.' },
  { seed: 'The Great Barrier Reef', hook: 'The world\'s largest coral reef system, off the coast of Queensland.' },
  { seed: 'Pompeii', hook: 'A Roman town buried by ash from Mount Vesuvius in 79 AD.' },
  { seed: 'Dark matter', hook: 'Most of the matter in the universe has never been seen directly.' },
  { seed: 'The printing press', hook: 'Gutenberg\'s movable type, around 1450, made books far cheaper to produce.' },
  { seed: 'Kintsugi', hook: 'A Japanese craft that repairs broken pottery with lacquer and gold.' },
  { seed: 'The Mariana Trench', hook: 'Its deepest point lies nearly 11 kilometers below the sea surface.' },
  { seed: 'Honey', hook: 'Bees make it from nectar, and sealed honey keeps for a very long time.' },
  { seed: 'The Enigma machine', hook: 'A cipher device used by Germany in World War II, broken by Polish and British codebreakers.' },
  { seed: 'The northern lights', hook: 'Charged particles from the sun striking the upper atmosphere make the sky glow.' },
  { seed: 'Quipu', hook: 'The Inca recorded information in knotted cords.' },
  { seed: 'The Fermi paradox', hook: 'If the universe is so large, why haven\'t we found other civilizations?' },
  { seed: 'Coral bleaching', hook: 'Warm water makes corals expel the algae that live in them.' },
  { seed: 'The Silk Road', hook: 'A web of trade routes that linked China with the Mediterranean for centuries.' },
  { seed: 'Lightning', hook: 'A single bolt can be hotter than the surface of the sun.' },
  { seed: 'The Great Stink', hook: 'In 1858 the smell of the Thames pushed London to build a modern sewer system.' },
  { seed: 'Axolotls', hook: 'Salamanders that can regrow limbs and parts of their organs.' },
  { seed: 'The Trans-Siberian Railway', hook: 'A line of about 9,300 kilometers linking Moscow and Vladivostok.' },
  { seed: 'Perpetual motion', hook: 'Why no machine can run forever without an energy source.' },
  { seed: 'The Pythagorean theorem', hook: 'Babylonian tablets show the relationship was known long before Pythagoras.' },
  { seed: 'Mount Everest', hook: 'A 2020 survey by China and Nepal set its height at 8,848.86 meters.' },
  { seed: 'Morse code', hook: 'A code of dots and dashes that carried messages over telegraph wires.' },
  { seed: 'The Dead Sea', hook: 'Its shore is the lowest dry land on Earth.' },
  { seed: 'Sleep', hook: 'Scientists still debate exactly why animals need it.' },
  { seed: 'Black holes', hook: 'Regions where gravity is so strong that not even light escapes.' },
  { seed: 'The Terracotta Army', hook: 'Thousands of clay soldiers were buried near the tomb of China\'s first emperor.' },
  { seed: 'Deep Blue', hook: 'In 1997 IBM\'s chess computer beat world champion Garry Kasparov in a match.' },
  { seed: 'Blue whales', hook: 'The largest animal known to have ever lived.' },
  { seed: 'The number zero', hook: 'Its use as a number developed over centuries in several cultures.' },
  { seed: 'The Krakatoa eruption', hook: 'The 1883 eruption was heard thousands of kilometers away.' },
  { seed: 'Origami mathematics', hook: 'Folding paper follows rules that mathematicians have written down as axioms.' },
  { seed: 'The Rubik\'s Cube', hook: 'Invented in 1974, it has more than 43 quintillion possible positions.' },
  { seed: 'Lake Baikal', hook: 'The deepest lake on Earth, holding about a fifth of its unfrozen fresh water.' },
  { seed: 'Sundials', hook: 'Shadows told the time long before mechanical clocks.' },
  { seed: 'The Great Fire of London', hook: 'In 1666 a fire destroyed much of the medieval city.' },
  { seed: 'Pulsars', hook: 'Spinning neutron stars that sweep beams of radio waves past Earth.' },
  { seed: 'Venus flytraps', hook: 'The plant snaps shut only after its trigger hairs are touched more than once.' },
  { seed: 'The Wow! signal', hook: 'A strong radio signal recorded in 1977 that was never heard again.' },
  { seed: 'Map projections', hook: 'A flat map always distorts something, which is why projections differ.' },
  { seed: 'Vikings in North America', hook: 'Norse settlers built a site at L\'Anse aux Meadows around the year 1000.' },
  { seed: 'Penicillin', hook: 'In 1928 Alexander Fleming noticed that a mold killed bacteria on a dish.' },
  { seed: 'The Panama Canal', hook: 'Opened in 1914, it spared ships the long trip around South America.' },
  { seed: 'Sign languages', hook: 'Deaf communities developed full languages with their own grammar.' },
  { seed: 'Tides', hook: 'The moon\'s gravity pulls on the oceans, and the sun plays a part too.' },
]

// "Try Tardigrades": one example at a time, paused while pointed at, focused, or while typing.
export function Examples({ i, onStart, typing }: { i: number; onStart: (seed: string) => void; typing: boolean }) {
  const [n, setN] = useState(() => Math.floor(Math.random() * EXAMPLES.length))
  const [held, setHeld] = useState(false)
  const paused = held || typing
  useEffect(() => {
    if (paused) return
    const t = window.setInterval(() => setN((x) => (x + 1) % EXAMPLES.length), 5000)
    return () => window.clearInterval(t)
  }, [paused])
  const seed = EXAMPLES[n]
  return (
    <p className="muted try m-in" style={at(i)} onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)} onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
      Try <button key={seed} type="button" className="link-btn try-seed" aria-label={`Start a dive on ${seed}`} onClick={() => onStart(seed)}>{seed}</button>
    </p>
  )
}

export function Today({ i, dives, onStart, onOpen }: Props & { i: number }) {
  const pick = TODAY[dayNumber() % TODAY.length]
  const today = dayKey(now().getTime())
  const live = dives.find((d) => seedOf(d).toLowerCase() === pick.seed.toLowerCase() && dayKey(d.updated) === today)
  return (
    <button type="button" className="resume today m-in" style={at(i)} onClick={() => (live ? onOpen(live.id) : onStart(pick.seed))}>
      <span className="resume-text">
        <span className="label">Today's rabbit hole</span>
        <b>{pick.seed}</b>
        <span className="today-hook">{pick.hook}</span>
        <span className="today-go">{live ? 'Continue this dive' : 'Start this dive'}</span>
      </span>
    </button>
  )
}

export function Starred({ i, dives, onOpen }: Omit<Props, 'onStart'> & { i: number }) {
  const rows = [...dives].sort((a, b) => b.updated - a.updated)
    .flatMap((d) => d.graph.nodes.filter((n) => n.starred === true).map((n) => ({ d, n }))).slice(0, 8)
  if (!rows.length) return null
  return (
    <section className="starred m-in" style={at(i)} aria-labelledby="starred-title">
      <h2 id="starred-title" className="label">Starred</h2>
      <ul>
        {rows.map(({ d, n }) => {
          const ls = pathOf(d.graph, n.id).map((x) => x.label)
          const trail = ls.length > 2 ? [ls[0], '…', ls[ls.length - 1]] : ls
          return (
            <li key={`${d.id}-${n.id}`}>
              <button type="button" className="starred-row" onClick={() => onOpen(d.id, n.id)}>
                <span className="starred-label">{n.label}</span>
                <span className="starred-trail">{trail.join(' › ')}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function Threads({ i, dives, onStart }: Omit<Props, 'onOpen'> & { i: number }) {
  if (dives.length < 3) return null
  const today = dayKey(now().getTime())
  const skip = new Set(dives.filter((d) => dayKey(d.updated) === today).map((d) => seedOf(d).toLowerCase()))
  const chips = interests(dives.map((d) => d.graph)).filter((t) => !skip.has(t.label.toLowerCase())).slice(0, 6)
  if (!chips.length) return null
  return (
    <section className="threads m-in" style={at(i)} aria-labelledby="threads-title">
      <h2 id="threads-title" className="label">Your threads</h2>
      <div className="chips">
        {chips.map((t) => <button key={t.label} type="button" className="btn chip" onClick={() => onStart(t.label)}>{t.label}</button>)}
      </div>
    </section>
  )
}

export function Stats({ i, dives }: { i: number; dives: HomeDive[] }) {
  if (!dives.length) return null
  const n0 = now()
  const month = dives.filter((d) => { const u = new Date(d.updated); return u.getFullYear() === n0.getFullYear() && u.getMonth() === n0.getMonth() })
  const stops = month.reduce((s, d) => s + d.graph.nodes.filter((n) => n.status === 'solid').length, 0)
  const deepest = Math.max(0, ...dives.flatMap((d) => d.graph.nodes.filter((n) => n.status === 'solid').map((n) => pathOf(d.graph, n.id).length - 1)))
  return <p className="muted stats m-in" style={at(i)}>This month: {plural(month.length, 'dive')} · {plural(stops, 'stop')} · deepest {plural(deepest, 'level')}</p>
}
