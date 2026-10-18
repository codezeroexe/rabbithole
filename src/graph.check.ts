// Run with `npm run check`. Fails loudly if the graph logic or reply parsing breaks.
import assert from 'node:assert/strict'
import { addGhosts, contextFor, dismissNode, exportVault, kidsOf, newGraph, relayout, steerNode } from './graph.ts'
import { extractJson, parseResearch, parseSuggestions } from './ai.ts'
import { mockSuggest } from './mock.ts'

const g = newGraph('Cars')
addGhosts(g, 'root', mockSuggest(contextFor(g, 'root')))
assert.deepEqual(kidsOf(g, 'root').map((n) => n.label), ['Types', 'Recent launches', 'News', 'Brands'])

// Duplicates and blanks are dropped.
addGhosts(g, 'root', [{ label: 'brands', teaser: '', tangent: false }, { label: ' ', teaser: '', tangent: false }])
assert.equal(kidsOf(g, 'root').length, 4)

// Steering and dismissing feed the next expansion's context.
const brands = kidsOf(g, 'root').find((n) => n.label === 'Brands')!
brands.status = 'solid'
addGhosts(g, brands.id, mockSuggest(contextFor(g, brands.id)))
const ford = kidsOf(g, brands.id).find((n) => n.label === 'Ford')!
dismissNode(g, ford.id)
const ferrari = steerNode(g, brands.id, 'Ferrari')
const ctx = contextFor(g, brands.id)
assert.deepEqual(ctx.steered, ['Ferrari'])
assert.deepEqual(ctx.dismissed, ['Ford'])
assert.ok(ctx.avoid.includes('Ford'))
assert.equal(mockSuggest(ctx)[0].label, 'Lamborghini')

// Dismissing removes the subtree and moves the active node up.
g.active = ferrari
addGhosts(g, ferrari, [{ label: 'F40', teaser: '', tangent: false }])
dismissNode(g, ferrari)
assert.equal(g.active, brands.id)
assert.equal(kidsOf(g, ferrari).length, 0)

// Columns: x is depth * 300, siblings never share a y.
const pos = relayout(g)
assert.equal(pos.root.x, 0)
assert.equal(pos[brands.id].x, 300)
const ys = kidsOf(g, 'root').map((n) => pos[n.id].y)
assert.equal(new Set(ys).size, ys.length)

// Vault: unique file names, wikilinks to the parent.
steerNode(g, 'root', 'Types')
const files = exportVault(g)
assert.equal(new Set(files.map((f) => f.name)).size, files.length)
assert.ok(files.find((f) => f.name === 'Brands.md')!.text.includes('Up: [[Cars]]'))

// Model replies with prose or fences around the JSON still parse.
assert.deepEqual(extractJson('Sure!\n```json\n{"children":[]}\n```'), { children: [] })
assert.throws(() => extractJson('no json here'))

// Suggestions: junk entries are dropped, tangent must be literally true.
assert.deepEqual(parseSuggestions('{"children":[{"label":"A","teaser":"t","tangent":"yes"},{"label":5}]}'), [
  { label: 'A', teaser: 't', tangent: false }, { label: '', teaser: '', tangent: false },
])
assert.throws(() => parseSuggestions('{"children":[]}'))

// Research with web search: sources can only be fetched results, picked by number.
const results = [{ title: 'One', url: 'https://one.example', snippet: '' }, { title: 'Two', url: 'https://two.example', snippet: '' }]
const r = parseResearch('{"summary":"S","facts":[{"k":"K","v":"V"},{"k":""}],"sources":[2,9,"1"]}', 'X', results)
assert.deepEqual(r.sources.map((s) => s.url), ['https://two.example', 'https://one.example'])
assert.equal(r.facts.length, 1)
assert.equal(r.verified, true)
// Without search, only http(s) URLs survive.
assert.deepEqual(parseResearch('{"summary":"S","sources":[{"title":"a","url":"javascript:alert(1)"}]}', 'X', []).sources, [])

console.log('graph checks passed')

// Wikipedia lead links: reading order, first sentence (the "is a kind of" part) skipped, namespaces dropped.
{
  const { linksInParagraphs } = await import('./wiki.ts')
  const html = '<p>A <a href="/wiki/Car">car</a> is a <a href="/wiki/Motor_vehicle">motor vehicle</a>. It was made by <a href="/wiki/Karl_Benz">Benz</a> and <a href="/wiki/File:X.jpg">x</a>.</p><p>See <a href="/wiki/Ford_Model_T#Hist">Model T</a>.</p>'
  assert.deepEqual(linksInParagraphs(html), ['Karl Benz', 'Ford Model T'])
}
