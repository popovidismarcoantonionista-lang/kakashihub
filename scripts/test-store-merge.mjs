import assert from 'node:assert/strict'
import { assignInPlace, mergeChanges } from '../server/store.mjs'

// Item criado por outro contexto (presente em `theirs`, ausente na base e em
// `ours`) precisa sobreviver à gravação de uma tarefa antiga.
const base = { clips: [{ id: 'a', stage: 'rascunho' }], settings: { niche: 'fuga' } }
const ours = { clips: [{ id: 'a', stage: 'rascunho' }], settings: { niche: 'fuga' } }
const theirs = {
  clips: [{ id: 'a', stage: 'rascunho' }, { id: 'b', stage: 'renderizado' }],
  settings: { niche: 'fuga', autoApprove: true },
}
const merged = mergeChanges(base, ours, theirs)
assert.deepEqual(merged.clips.map((c) => c.id), ['a', 'b'])
assert.equal(merged.settings.autoApprove, true)

// Reconciliar com o próprio objeto não pode esvaziar arrays nem apagar chaves.
const state = { clips: [{ id: 'a' }], sources: [{ id: 's' }], settings: { niche: 'gta', clipMin: 18 } }
assignInPlace(state, state)
assert.equal(state.clips.length, 1)
assert.equal(state.sources.length, 1)
assignInPlace(state, { clips: [{ id: 'a' }] })
assert.equal(state.settings.niche, 'gta')
assert.equal(state.settings.clipMin, 18)

// Arrays com ids preservam a identidade dos itens já existentes.
const item = state.clips[0]
assignInPlace(state, { clips: [{ id: 'a', stage: 'renderizado' }], sources: state.sources })
assert.equal(state.clips[0], item)
assert.equal(state.clips[0].stage, 'renderizado')

console.log('store merge OK')
