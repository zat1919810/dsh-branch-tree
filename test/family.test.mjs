/**
 * Pure-logic test for the branch-family projection inside the client bundle.
 *
 * The bundle is a `window.__ModuleLoader__.load({id, factory})` registration,
 * so the test installs a capturing window, stubs the two React entry points the
 * factory touches at definition time, materializes the factory, and exercises
 * the exported `familyOf` against synthetic list snapshots.
 *
 * Run: <node> test/family.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      captured = entry
    },
  },
}

const reactStub = {
  createElement: () => null,
  memo: component => component,
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useMemo: factory => factory(),
  useCallback: fn => fn,
}
const requireStub = specifier => {
  if (specifier === 'react') return reactStub
  throw new Error(`unexpected require: ${specifier}`)
}

// eslint-disable-next-line no-new-func -- the bundle is a classic script by design
new Function(source)()
assert.ok(captured !== null, 'bundle registered itself with the module loader')
assert.equal(captured.id, 'dsh-branch-tree')

const mod = captured.factory(requireStub)
assert.equal(typeof mod.apply, 'function', 'apply exported')
assert.deepEqual(mod.inject, ['sessions', 'slots', 'locale'], 'services declared')
assert.equal(typeof mod.familyOf, 'function', 'familyOf exported')
assert.equal(typeof mod.childTitleOf, 'function', 'childTitleOf exported')

const { familyOf, childTitleOf } = mod

/** Build the two list projections familyOf consumes. */
function snapshot(rows) {
  return {
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, {
      displayTitle: row.displayTitle ?? row.title,
      running: row.running ?? false,
      parentId: row.parentId,
    }])),
  }
}

// ── an unbranched root: itself only, and never "1/N" against unrelated roots
{
  const { ids, byId } = snapshot([
    { id: 'a', title: '马克思主义' },
    { id: 'b', title: '无关对话' },
  ])
  const family = familyOf(ids, byId, 'a')
  assert.deepEqual(family.rows.map(row => row.id), ['a'], 'unrelated roots stay out of the family')
  assert.equal(family.rootId, 'a')
  assert.equal(family.siblingTotal, 1, 'a lone root is not one of N siblings')
  assert.equal(family.siblingIndex, 1)
  assert.equal(family.hasFamily, false)
}

// ── two sibling branches: both visible, current addressed, root is the parent
{
  const { ids, byId } = snapshot([
    { id: 'root', title: '马克思主义' },
    { id: 'phil', title: '马克思主义 ⑂1', parentId: 'root' },
    { id: 'econ', title: '马克思主义 ⑂2', parentId: 'root' },
  ])
  const family = familyOf(ids, byId, 'phil')
  assert.deepEqual(family.rows.map(row => row.id), ['root', 'phil', 'econ'], 'host order preserved')
  assert.deepEqual(family.rows.map(row => row.depth), [0, 1, 1], 'siblings share depth 1')
  assert.equal(family.rootId, 'root')
  assert.equal(family.siblingTotal, 2, 'two sibling branches')
  assert.equal(family.siblingIndex, 1, 'phil is the first of the two')
  assert.equal(family.hasFamily, true)
  assert.equal(familyOf(ids, byId, 'econ').siblingIndex, 2, 'econ is the second')
  assert.equal(familyOf(ids, byId, 'root').siblingTotal, 1, 'the parent is not its own sibling')
}

// ── a branch of a branch: depth 2, family rooted at the original ancestor
{
  const { ids, byId } = snapshot([
    { id: 'root', title: 'root' },
    { id: 'b1', title: 'b1', parentId: 'root' },
    { id: 'b1a', title: 'b1a', parentId: 'b1' },
    { id: 'b1b', title: 'b1b', parentId: 'b1' },
    { id: 'other', title: 'other' },
  ])
  const family = familyOf(ids, byId, 'b1a')
  assert.deepEqual(family.rows.map(row => row.id), ['root', 'b1', 'b1a', 'b1b'], 'descendants nest under their parent')
  assert.deepEqual(family.rows.map(row => row.depth), [0, 1, 2, 2])
  assert.equal(family.rootId, 'root', 'root is the topmost ancestor, not the direct parent')
  assert.equal(family.siblingTotal, 2, 'b1a/b1b are siblings')
  assert.equal(family.siblingIndex, 1)
}

// ── an orphan whose parent is not in the list degrades to its own root
{
  const { ids, byId } = snapshot([
    { id: 'lost', title: 'lost', parentId: 'gone' },
    { id: 'peer', title: 'peer', parentId: 'gone' },
  ])
  const family = familyOf(ids, byId, 'lost')
  assert.equal(family.rootId, 'lost', 'an absent parent never resolves as the root')
  assert.deepEqual(family.rows.map(row => row.id), ['lost'], 'the sibling of an orphan is not pulled in')
  assert.equal(family.siblingTotal, 1)
}

// ── a cycle must not hang or duplicate rows
{
  const { ids, byId } = snapshot([
    { id: 'x', title: 'x', parentId: 'y' },
    { id: 'y', title: 'y', parentId: 'x' },
  ])
  const family = familyOf(ids, byId, 'x')
  assert.deepEqual([...family.rows.map(row => row.id)].sort(), ['x', 'y'], 'cycle breaks and each session appears once')
  assert.equal(new Set(family.rows.map(row => row.id)).size, 2, 'no duplicated rows')
}

console.log('familyOf: all assertions passed')

// ── child titles: numbered per source, one suffix only, never a load-bearing failure
{
  const rows = [
    { id: 'root', title: '马克思主义' },
    { id: 'b1', title: '马克思主义 ⑂1', parentId: 'root' },
    { id: 'b2', title: '马克思主义 ⑂2', parentId: 'root' },
  ]
  const { ids, byId } = snapshot(rows)
  assert.equal(childTitleOf(ids, byId, 'root'), '马克思主义 ⑂3', 'next child number follows existing children')
  assert.equal(childTitleOf(ids, byId, 'b1'), '马克思主义 ⑂1', 'branching a branch keeps one suffix')
  assert.equal(childTitleOf(ids, byId, 'ghost'), null, 'unknown source names nothing')
  assert.equal(childTitleOf(undefined, byId, 'root'), null, 'a broken snapshot degrades to no name')
  const untitled = snapshot([{ id: 'plain', displayTitle: 'E:\\dsh' }])
  assert.equal(childTitleOf(untitled.ids, untitled.byId, 'plain'), 'E:\\dsh ⑂1', 'displayTitle is the fallback base')
}

console.log('childTitleOf: all assertions passed')

// ── sidebar lineage lookups
{
  const { byId } = snapshot([
    { id: 'root', title: '马克思主义' },
    { id: 'b1', title: '马克思主义 ⑂1', parentId: 'root' },
    { id: 'b2', title: '马克思主义 ⑂2', parentId: 'root' },
  ])
  assert.equal(mod.lineageOf(byId, 'root'), null, 'a root row carries no lineage line')
  const lineage = mod.lineageOf(byId, 'b1')
  assert.equal(lineage.parentTitle, '马克思主义', 'the parent title is reported')
  assert.equal(lineage.siblings, 2, 'both siblings are counted')
  assert.equal(mod.lineageOf(undefined, 'b1'), null, 'a broken snapshot degrades to no line')
  assert.equal(mod.lineageOf(byId, 'ghost'), null, 'an unknown row carries no line')
}

console.log('lineageOf: all assertions passed')

// ── delegation sessions (subagents / workflow children) are NOT branches
{
  const { ids, byId } = snapshot([
    { id: 'session-root', title: '马克思主义' },
    { id: 'session-b1', title: '马克思主义 ⑂1', parentId: 'session-root' },
    { id: '2ff789fe-a706-42cd-b9e7-9c72778014d6', title: 'You are researching…', parentId: 'session-root' },
  ])
  assert.equal(mod.isDelegated('2ff789fe-a706-42cd-b9e7-9c72778014d6', byId['2ff789fe-a706-42cd-b9e7-9c72778014d6']), true, 'a bare-uuid child is delegation')
  assert.equal(mod.isDelegated('session-b1', byId['session-b1']), false, 'a session- child is a branch')
  assert.equal(mod.isDelegated('root', { parentId: 'x' }), false, 'an unusual id is NOT assumed to be delegation')
  assert.equal(mod.isDelegated('custom-1', { parentId: 'x' }), false, 'a non-uuid id stays a branch')
  assert.equal(mod.isDelegated('session-x', { origin: 'subagent' }), true, 'origin wins when the id looks ordinary')

  const family = familyOf(ids, byId, 'session-root', mod.isDelegated)
  assert.deepEqual(family.rows.map(row => row.id), ['session-root', 'session-b1'], 'subagents stay out of the branch tree')
  assert.equal(family.rows[0].childCount, 1, 'the subagent sibling is not counted as a branch')

  // Numbering must count branches only: one branch exists, so the next is ⑂2.
  assert.equal(childTitleOf(ids, byId, 'session-root', mod.isDelegated), '马克思主义 ⑂2', 'subagents do not inflate branch numbering')

  // A delegated session's own view stays quiet instead of showing its parent's tree.
  const delegated = familyOf(ids, byId, '2ff789fe-a706-42cd-b9e7-9c72778014d6', mod.isDelegated)
  assert.deepEqual(delegated.rows.map(row => row.id), ['2ff789fe-a706-42cd-b9e7-9c72778014d6'], 'a delegated session shows only itself')
  assert.equal(delegated.hasFamily, false)

  // …and it gets no sidebar lineage mark.
  assert.equal(mod.lineageOf(byId, '2ff789fe-a706-42cd-b9e7-9c72778014d6'), null, 'no lineage line on a subagent row')
  assert.equal(mod.lineageOf(byId, 'session-b1').siblings, 1, 'sibling count ignores delegation')
}

console.log('delegation filtering: all assertions passed')

// ── branch-title discriminator survives truncation as its own tag
{
  assert.deepEqual(mod.splitBranchTitle('马克思主义 ⑂3'), { base: '马克思主义', suffix: '⑂3' })
  assert.deepEqual(mod.splitBranchTitle('plain title'), { base: 'plain title', suffix: null })
  assert.deepEqual(mod.splitBranchTitle('a ⑂1 ⑂2'), { base: 'a ⑂1', suffix: '⑂2' }, 'only the trailing discriminator splits')
  assert.deepEqual(mod.splitBranchTitle(undefined), { base: '', suffix: null }, 'a missing title degrades to empty')
}

console.log('splitBranchTitle: all assertions passed')

// ── sidebar indent depth
{
  const { byId } = snapshot([
    { id: 'session-root', title: 'root' },
    { id: 'session-b1', title: 'b1', parentId: 'session-root' },
    { id: 'session-b1a', title: 'b1a', parentId: 'session-b1' },
    { id: '7f3a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8', title: 'research', parentId: 'session-b1a' },
    { id: 'session-orphan', title: 'orphan', parentId: 'gone' },
  ])
  assert.equal(mod.depthInList(byId, 'session-root'), 0, 'a root is not indented')
  assert.equal(mod.depthInList(byId, 'session-b1'), 1, 'a child indents one level')
  assert.equal(mod.depthInList(byId, 'session-b1a'), 2, 'a grandchild indents two')
  assert.equal(mod.depthInList(byId, '7f3a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8'), 0, 'a delegated session is never indented')
  assert.equal(mod.depthInList(byId, 'session-orphan'), 0, 'an orphan whose parent is absent stays at root level (it nests under nothing visible)')
  assert.equal(mod.depthInList(undefined, 'session-b1'), 0, 'a broken snapshot degrades to no indent')

  // A cycle must not loop forever.
  const cycle = snapshot([
    { id: 'session-x', title: 'x', parentId: 'session-y' },
    { id: 'session-y', title: 'y', parentId: 'session-x' },
  ])
  assert.ok(mod.depthInList(cycle.byId, 'session-x') <= 8, 'a cycle stops at the guard')
}

console.log('depthInList: all assertions passed')

// ── collapse cascades: no descendant may survive a collapsed ancestor
{
  const { ids, byId } = snapshot([
    { id: 'session-r', title: 'root' },
    { id: 'session-a', title: 'a', parentId: 'session-r' },
    { id: 'session-a1', title: 'a1', parentId: 'session-a' },
    { id: 'session-a1x', title: 'a1x', parentId: 'session-a1' },
    { id: 'session-b', title: 'b', parentId: 'session-r' },
  ])

  const open = familyOf(ids, byId, 'session-a1x')
  assert.deepEqual(open.rows.map(row => row.id), ['session-r', 'session-a', 'session-a1', 'session-a1x', 'session-b'], 'expanded shows every level')
  assert.equal(open.rows.find(row => row.id === 'session-a').descendantCount, 2, 'a subtree reports its full depth below')
  assert.equal(open.rows.find(row => row.id === 'session-r').descendantCount, 4, 'the root counts every branch')
  assert.equal(open.rows.find(row => row.id === 'session-r').containsCurrent, true, 'an ancestor knows the current branch is inside it')
  assert.equal(open.rows.find(row => row.id === 'session-b').containsCurrent, false, 'an unrelated sibling does not')
  assert.equal(open.rows.find(row => row.id === 'session-a1x').containsCurrent, true, 'the current row contains itself')

  // Collapsing an inner level hides exactly its own subtree.
  const inner = familyOf(ids, byId, 'session-a1x', undefined, new Set(['session-a1']))
  assert.deepEqual(inner.rows.map(row => row.id), ['session-r', 'session-a', 'session-a1', 'session-b'], 'L2 collapse hides L3')
  const collapsedA1 = inner.rows.find(row => row.id === 'session-a1')
  assert.equal(collapsedA1.collapsed, true, 'the row reports itself collapsed')
  assert.equal(collapsedA1.descendantCount, 1, 'and how much it hides')
  assert.equal(collapsedA1.containsCurrent, true, 'and that the current branch is inside')

  // THE BUG THIS PREVENTS: collapse a top level whose deeper rows carry no flag
  // of their own — nothing below it may still be emitted.
  const top = familyOf(ids, byId, 'session-a1x', undefined, new Set(['session-a']))
  assert.deepEqual(top.rows.map(row => row.id), ['session-r', 'session-a', 'session-b'], 'an ancestor collapse removes the whole subtree')
  // …and collapsing both levels at once must not resurrect the grandchild.
  const both = familyOf(ids, byId, 'session-a1x', undefined, new Set(['session-a', 'session-a1']))
  assert.deepEqual(both.rows.map(row => row.id), ['session-r', 'session-a', 'session-b'], 'two collapsed levels still emit nothing below the higher one')

  // Collapsing the root leaves the root row alone.
  const rootCollapsed = familyOf(ids, byId, 'session-a1x', undefined, new Set(['session-r']))
  assert.deepEqual(rootCollapsed.rows.map(row => row.id), ['session-r'], 'the root collapse hides the entire tree')
  assert.equal(rootCollapsed.rows[0].containsCurrent, true, 'and says the current branch is inside it')
  assert.equal(rootCollapsed.rows[0].collapsed, true)

  // A leaf cannot be collapsed: there is nothing below it to hide.
  const leafFlag = familyOf(ids, byId, 'session-a1x', undefined, new Set(['session-b']))
  assert.equal(leafFlag.rows.find(row => row.id === 'session-b').collapsed, false, 'a leaf never claims to be collapsed')

  // An array is accepted as well as a Set (slot props may serialize one).
  assert.deepEqual(familyOf(ids, byId, 'session-a1x', undefined, ['session-a']).rows.map(row => row.id), ['session-r', 'session-a', 'session-b'], 'an array of collapsed ids works too')
}

console.log('collapse cascade: all assertions passed')

// ── rootOf agrees with the family projection (the collapse memory keys on it)
{
  const { ids, byId } = snapshot([
    { id: 'session-r', title: 'root' },
    { id: 'session-a', title: 'a', parentId: 'session-r' },
    { id: 'session-a1', title: 'a1', parentId: 'session-a' },
    { id: '7f3a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8', title: 'research', parentId: 'session-a1' },
  ])
  assert.equal(mod.rootOf(byId, 'session-a1', mod.isDelegated), 'session-r', 'the root resolves from any descendant')
  assert.equal(mod.rootOf(byId, 'session-r', mod.isDelegated), 'session-r', 'a root resolves to itself')
  assert.equal(mod.rootOf(byId, '7f3a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8', mod.isDelegated), '7f3a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8', 'a delegated session roots itself')
  assert.equal(mod.rootOf(undefined, 'session-a1', mod.isDelegated), 'session-a1', 'a broken snapshot degrades to itself')
  // The rootOf used for the store key must equal the rootId the rows report.
  assert.equal(mod.rootOf(byId, 'session-a1', mod.isDelegated), familyOf(ids, byId, 'session-a1', mod.isDelegated).rootId, 'store key and row projection agree')
}

console.log('rootOf: all assertions passed')

// ── a branch made while viewing a SUBAGENT belongs to the conversation
// (this is the real shape found on disk: fork from a subagent, whose own row the
//  sidebar never shows — it must not become an orphan or vanish from the tree)
{
  const SUB = '2ff789fe-a706-42cd-b9e7-9c72778014d6'
  const { ids, byId } = snapshot([
    { id: 'session-root', title: '马克思主义' },
    { id: SUB, title: 'You are researching…', parentId: 'session-root' },
    { id: 'session-child', title: 'You are researching… ⑂1', parentId: SUB },
    { id: 'session-b1', title: '马克思主义 ⑂1', parentId: 'session-root' },
  ])

  assert.equal(mod.visibleParentOf(byId, 'session-child'), 'session-root', 'the delegation session is walked past')
  assert.equal(mod.depthInList(byId, 'session-child'), 1, 'it indents under the conversation, not at root level')
  assert.equal(mod.rootOf(byId, 'session-child', mod.isDelegated), 'session-root', 'root resolves past the subagent')

  const family = familyOf(ids, byId, 'session-root', mod.isDelegated)
  assert.deepEqual(family.rows.map(row => row.id), ['session-root', 'session-child', 'session-b1'], 'the branch appears in the tree instead of vanishing')
  assert.equal(family.rows.find(row => row.id === 'session-root').childCount, 2, 'and is counted in the subtree')
  assert.equal(family.rows.find(row => row.id === 'session-child').depth, 1, 'shown one level under the conversation')

  const lineage = mod.lineageOf(byId, 'session-child')
  assert.equal(lineage.parentTitle, '马克思主义', 'its lineage names the conversation, not the invisible subagent')
  assert.equal(lineage.siblings, 2, 'and it counts as a sibling branch of the conversation')

  // Naming: a conversation's branches share one counter…
  assert.equal(childTitleOf(ids, byId, 'session-root', mod.isDelegated), '马克思主义 ⑂3', 'the conversation counter includes it')
  // …while a subagent's own branches share the subagent's counter and base.
  assert.equal(childTitleOf(ids, byId, SUB, mod.isDelegated), 'You are researching… ⑂2', 'a subagent numbers its own branches')
}

console.log('branch-of-subagent: all assertions passed')

// ── sidebar fold follows the same cascade, but never hides where you are
{
  const { byId } = snapshot([
    { id: 'session-r', title: 'root' },
    { id: 'session-a', title: 'a', parentId: 'session-r' },
    { id: 'session-a1', title: 'a1', parentId: 'session-a' },
    { id: 'session-a1x', title: 'a1x', parentId: 'session-a1' },
    { id: 'session-b', title: 'b', parentId: 'session-r' },
  ])
  assert.equal(mod.visibleChildCount(byId, 'session-r'), 2, 'the root owns two branches')
  assert.equal(mod.visibleChildCount(byId, 'session-a'), 1, 'a branch owns one')
  assert.equal(mod.visibleChildCount(byId, 'session-b'), 0, 'a leaf owns none')

  const collapsed = new Set(['session-a'])
  assert.equal(mod.hiddenInList(byId, 'session-a', collapsed, 'session-b'), false, 'the folded row itself stays visible (it is the way back)')
  assert.equal(mod.hiddenInList(byId, 'session-a1', collapsed, 'session-b'), true, 'its child hides')
  assert.equal(mod.hiddenInList(byId, 'session-a1x', collapsed, 'session-b'), true, 'its grandchild hides too — same cascade')
  assert.equal(mod.hiddenInList(byId, 'session-b', collapsed, 'session-b'), false, 'an unrelated sibling stays')
  assert.equal(mod.hiddenInList(byId, 'session-a1x', collapsed, 'session-a1x'), false, 'the current row is never hidden')
  assert.equal(mod.hiddenInList(byId, 'session-a1x', collapsed, 'session-a1'), false, 'nor is the subtree of the current row')
  assert.equal(mod.hiddenInList(byId, 'session-a1x', new Set(['session-a', 'session-a1']), 'session-b'), true, 'two folded levels hide it once, not twice')
  assert.equal(mod.hiddenInList(byId, 'session-b', new Set(), 'session-b'), false, 'no fold hides nothing')
}

console.log('sidebar fold: all assertions passed')

// ── turn outline: normalization and the exact cut seq per turn
{
  assert.deepEqual(mod.normalizeOutline(undefined), [], 'a missing projection is an empty outline')
  assert.deepEqual(mod.normalizeOutline({ getSnapshot: () => [{ turn: 1, seq: 4, prompt: 'hi' }] }).map(e => e.turn), [1], 'an observable wrapper unwraps')
  assert.deepEqual(mod.normalizeOutline({ value: [{ turn: 2, seq: 9, prompt: '', response: 'r' }] }).map(e => e.seq), [9], 'a value wrapper unwraps')
  const junk = mod.normalizeOutline([null, { seq: 3 }, { turn: 5 }, { turn: 4, prompt: 7 }])
  assert.deepEqual(junk.map(e => e.turn), [4, 5], 'entries without a numeric turn are dropped, the rest are sorted')
  assert.equal(junk[0].prompt, '', 'a non-string prompt normalizes to empty')
  assert.equal(junk[0].seq, undefined, 'a missing seq stays undefined')

  const outline = [
    { turn: 1, seq: 10, prompt: 'first' },
    { turn: 2, seq: 40, prompt: 'second' },
    { turn: 3, seq: 90, prompt: 'third' },
  ]
  assert.equal(mod.turnCutSeq(outline, 0), 39, 'turn 1 ends one event before turn 2 starts')
  assert.equal(mod.turnCutSeq(outline, 1), 89, 'turn 2 ends one event before turn 3 starts')
  assert.equal(mod.turnCutSeq(outline, 2), undefined, 'the last turn lets the host pick its latest completed prefix')
  assert.equal(mod.turnCutSeq([{ turn: 1, seq: 0 }, { turn: 2, seq: 0 }], 0), undefined, 'a degenerate seq never yields a negative cut')
  assert.equal(mod.turnCutSeq(outline, 9), undefined, 'an out-of-range index cuts nothing')
  assert.equal(mod.turnCutSeq(undefined, 0), undefined, 'a missing outline cuts nothing')
}

console.log('turn outline: all assertions passed')

// ── sidebar row order: parent above children, roots keep their relative order
{
  const { byId } = snapshot([
    { id: 'session-r1', title: 'root one' },
    { id: 'session-a', title: 'a', parentId: 'session-r1' },
    { id: 'session-a1', title: 'a1', parentId: 'session-a' },
    { id: 'session-b', title: 'b', parentId: 'session-r1' },
    { id: 'session-r2', title: 'root two' },
  ])
  // The shipped order is recency (newest first) with each fork spliced ABOVE its
  // source, recursively — i.e. the parent sinks below its children.
  const shipped = ['session-a1', 'session-a', 'session-b', 'session-r1', 'session-r2']
  assert.deepEqual(mod.treeOrder(shipped, byId), ['session-r1', 'session-a', 'session-a1', 'session-b', 'session-r2'], 'each root is followed by its subtree, depth-first')
  assert.deepEqual(mod.treeOrder(mod.treeOrder(shipped, byId), byId), mod.treeOrder(shipped, byId), 'the order is idempotent (no churn when re-applied)')
  assert.deepEqual(mod.treeOrder([], byId), [], 'an empty list stays empty')
  assert.deepEqual(mod.treeOrder(['session-r2', 'session-r1'], byId), ['session-r2', 'session-r1'], 'root order is preserved, never re-sorted')
  // A fork whose parent is only reachable THROUGH a delegated session still nests.
  const withSub = snapshot([
    { id: 'session-r', title: 'root' },
    { id: '5f0c1a2b-3d4e-4f50-8192-a3b4c5d6e7f8', title: 'sub', parentId: 'session-r' },
    { id: 'session-kid', title: 'kid', parentId: '5f0c1a2b-3d4e-4f50-8192-a3b4c5d6e7f8' },
  ])
  assert.deepEqual(mod.treeOrder(['session-kid', 'session-r'], withSub.byId), ['session-r', 'session-kid'], 'a branch of a subagent nests under the conversation')
  // A cycle must not drop rows.
  const cycle = snapshot([
    { id: 'session-x', title: 'x', parentId: 'session-y' },
    { id: 'session-y', title: 'y', parentId: 'session-x' },
  ])
  assert.deepEqual([...mod.treeOrder(['session-x', 'session-y'], cycle.byId)].sort(), ['session-x', 'session-y'], 'cycle members still appear exactly once')
}

console.log('treeOrder: all assertions passed')
