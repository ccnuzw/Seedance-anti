// Shared acceptance cases for the selector and the independently owned draft helper.
// Optional argument: absolute path to novel-draft-state.ts from its checkout.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { getNovelProductionReadiness } from '../../src/renderer/utils/novel-production-readiness.ts'

const ep = { projectId: 'A', episodeNumber: 2, hasScript: false }
const cases = [
  { name: 'known unused target', episodes: [ep], used: [], allowed: true },
  { name: 'used missing script', episodes: [ep], used: [2], allowed: false },
  {
    name: 'existing script flag',
    episodes: [{ ...ep, hasScript: true }],
    used: [],
    allowed: false
  },
  {
    name: 'existing script path',
    episodes: [{ ...ep, scriptPath: '/synthetic/script.md' }],
    used: [],
    allowed: false
  },
  { name: 'unknown list', episodes: null, used: [], allowed: false },
  { name: 'empty list', episodes: [], used: [], allowed: false },
  {
    name: 'other project only',
    episodes: [{ ...ep, projectId: 'B' }],
    used: [],
    allowed: false
  },
  {
    name: 'missing target',
    episodes: [{ ...ep, episodeNumber: 1 }],
    used: [],
    allowed: false
  }
]
const draft = process.argv[2]
  ? await import(pathToFileURL(process.argv[2]).href)
  : null
for (const fixture of cases) {
  const summary = { readyEpisodeNumbers: [2], usedEpisodeNumbers: fixture.used }
  const episode = fixture.episodes?.find(
    (item) => item.projectId === 'A' && item.episodeNumber === 2
  )
  const result = getNovelProductionReadiness({
    projectId: 'A',
    hasSource: true,
    waterline: summary,
    episodeNumber: 2,
    episode
  })
  assert.equal(result.canStart, fixture.allowed, `selector: ${fixture.name}`)
  if (draft)
    assert.equal(
      draft.novelReadyEpisode(summary, fixture.episodes, 'A') === 2,
      fixture.allowed,
      `draft helper: ${fixture.name}`
    )
}
console.log(
  `Readiness fixtures passed: ${cases.length}; draft helper compared: ${!!draft}`
)
