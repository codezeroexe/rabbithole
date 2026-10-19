// Run with `npm run check`. Fails loudly if the graph logic or reply parsing breaks.
import assert from 'node:assert/strict'
import { addGhosts, contextFor, dismissNode, exportVault, kidsOf, newGraph, norm, relayout, steerNode } from './graph.ts'
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
  { label: 'A', teaser: 't', tangent: false },
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

// Near-duplicate labels merge: plurals, "The", and parenthesised qualifiers; "ss" endings stay.
assert.equal(norm('The Beatles'), norm('Beatles'))
assert.equal(norm('Ferrari (company)'), norm('Ferrari'))
assert.equal(norm('Cars'), norm('Car'))
assert.notEqual(norm('Glass'), norm('Glas'))
{
  const d = newGraph('Cars')
  addGhosts(d, 'root', [{ label: 'Ferrari', teaser: '', tangent: false }, { label: 'Ferrari (company)', teaser: '', tangent: false }])
  assert.equal(kidsOf(d, 'root').length, 1)
  // Same article under two labels: one child.
  const e = newGraph('Cars')
  addGhosts(e, 'root', [{ label: 'Ford', teaser: '', tangent: false, ref: 'Ford Motor Company' }, { label: 'Ford Motor', teaser: '', tangent: false, ref: 'Ford Motor Company' }])
  assert.equal(kidsOf(e, 'root').length, 1)
}

console.log('graph checks passed')

// Wikipedia lead links: reading order, first sentence (the "is a kind of" part) skipped, namespaces dropped.
{
  const { linksInParagraphs } = await import('./wiki.ts')
  const html = '<p>A <a href="/wiki/Car">car</a> is a <a href="/wiki/Motor_vehicle">motor vehicle</a>. It was made by <a href="/wiki/Karl_Benz">Benz</a> and <a href="/wiki/File:X.jpg">x</a>.</p><p>See <a href="/wiki/Ford_Model_T#Hist">Model T</a>.</p>'
  assert.deepEqual(linksInParagraphs(html), ['Karl Benz', 'Ford Model T'])
}

// Repeated picks from small models collapse to distinct labels, capped at the number asked for.
{
  const r0 = parseSuggestions
  const r = r0('{"children":[{"label":"Wine","teaser":"t"},{"label":"wine","teaser":"t"},{"label":"Beer","teaser":"t"},{"label":"Yogurt","teaser":"t"}]}', 2)
  assert.deepEqual(r.map((x) => x.label), ['Wine', 'Beer'])
}

// Reader links: article links become titles, other namespaces do not; a clicked link opens a child once.
{
  const { wikiLinkTitle } = await import('./wiki.ts')
  const { linkNode } = await import('./graph.ts')
  assert.equal(wikiLinkTitle('/wiki/Ada_Lovelace#Life'), 'Ada Lovelace')
  assert.equal(wikiLinkTitle('//en.wikipedia.org/wiki/C%2B%2B'), 'C++')
  assert.equal(wikiLinkTitle('/wiki/File:Cat.jpg'), null)
  assert.equal(wikiLinkTitle('https://example.com/wiki/X'), null)
  const r = newGraph('Minecraft')
  const a = linkNode(r, 'root', 'Mojang Studios')
  assert.equal(linkNode(r, 'root', 'Mojang Studios'), a)
  assert.equal(kidsOf(r, 'root').length, 1)
  assert.equal(kidsOf(r, 'root')[0].via, 'link')
}

// Narrowing: the whole path is the scope, steers pass down, and steering adds no node.
{
  const { steerOn, contextFor: ctxOf, addGhosts: add, find: get } = await import('./graph.ts')
  const { mergeAlike, aspectName } = await import('./wikidata.ts')
  const { mentions } = await import('./wiki.ts')
  const d = newGraph('nothing')
  d.nodes[0].ref = 'Nothing'
  const before = d.nodes.length
  steerOn(d, 'root', 'tech brand')
  assert.equal(d.nodes.length, before)
  assert.equal(get(d, 'root')!.steer, 'tech brand')
  assert.equal(get(d, 'root')!.ref, undefined) // looked up again with the steer
  add(d, 'root', [{ label: 'Products', teaser: '', tangent: false, kind: 'aspect', facet: { src: 'wd', key: 'P176<', of: 'Nothing (company)' } }])
  const products = kidsOf(d, 'root')[0]
  products.status = 'solid'
  add(d, products.id, [{ label: 'Phone (2)', teaser: '', tangent: false, kind: 'thing', ref: 'Nothing Phone 2' }])
  const phone = kidsOf(d, products.id)[0]
  phone.status = 'solid'
  // Another node may have its own "Products" aspect; an article appears only once in the graph.
  add(d, phone.id, [{ label: 'Products', teaser: '', tangent: false, kind: 'aspect', facet: { src: 'wd', key: 'P176<', of: 'Nothing Phone 2' } }, { label: 'Phone (2)', teaser: '', tangent: false }])
  assert.deepEqual(kidsOf(d, phone.id).map((n) => n.label), ['Products'])
  const c = ctxOf(d, phone.id)
  assert.equal(c.kind, 'thing')
  assert.deepEqual(c.anchors.map((a) => a.label), ['nothing']) // aspects are not anchors, articles are
  assert.deepEqual(c.qualifiers, ['tech brand']) // the seed's steer still narrows depth 2
  assert.equal(ctxOf(d, products.id).kind, 'aspect')
  // Older dives: anything below the seed reads as a cross, which must fit what is above it.
  const old = newGraph('Minecraft')
  add(old, 'root', [{ label: 'YouTube', teaser: '', tangent: false }])
  assert.equal(ctxOf(old, kidsOf(old, 'root')[0].id).kind, 'cross')

  assert.ok(mentions('a mid-engine sports car built by Ferrari', 'Car'))
  assert.ok(mentions('popular Minecraft YouTubers', 'Minecraft'))
  assert.ok(!mentions('a carpet maker', 'Car'))
  assert.ok(mentions('He founded Nothing in 2020', 'Nothing (company)'))
  const merged = mergeAlike([
    { label: 'Products', facet: { src: 'wd', key: 'P176<', of: 'X' }, members: ['A', 'B', 'C'] },
    { label: 'Makes', facet: { src: 'wd', key: 'P1056>', of: 'X' }, members: ['A', 'B', 'D'] },
    { label: 'Founder', facet: { src: 'wd', key: 'P112>', of: 'X' }, members: ['P'] },
    { label: 'Owners', facet: { src: 'wd', key: 'P1830<', of: 'X' }, members: ['P'] },
  ])
  assert.deepEqual(merged.map((a) => a.label), ['Products', 'Founder'])
  assert.deepEqual(merged[0].members, ['A', 'B', 'C', 'D'])
  assert.equal(aspectName('product or material produced', ['products', 'produces']), 'Products')
  assert.equal(aspectName('founded by', ['founder']), 'Founded by')
}
