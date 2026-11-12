import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  controlledDatasetFingerprint,
  compareControlledVariants,
  parseControlledDataset,
  parseControlledVariant,
  runControlledEvaluation
} from './controlled-evaluation'

function fixture() {
  const load = (name: string): unknown =>
    JSON.parse(
      readFileSync(
        new URL(`../../../resources/evaluation/${name}.json`, import.meta.url),
        'utf8'
      )
    )
  return {
    dataset: parseControlledDataset(load('lantern-river.dataset')),
    before: parseControlledVariant(load('candidate-v1')),
    after: parseControlledVariant(load('candidate-v2'))
  }
}
describe('repeatable original controlled quality baseline', () => {
  it('compares two synthetic versions on fixed sources and keeps engineering separate from content quality', () => {
    const { dataset, before, after } = fixture()
    const comparison = compareControlledVariants(dataset, before, after)
    expect(comparison.before.engineering).toEqual({
      passed: 3,
      failed: 0,
      total: 3
    })
    expect(comparison.after.engineering).toEqual({
      passed: 3,
      failed: 0,
      total: 3
    })
    expect(comparison.failedCheckDelta).toEqual({
      key_event: -2,
      character_continuity: -1,
      prop_continuity: -3,
      relationship: 0,
      scene: 0,
      review_detection: -1,
      style: 0
    })
    expect(comparison.before.content.severeReview).toEqual({
      missed: 2,
      detected: 0,
      unknown: 0,
      missRate: 1
    })
    expect(comparison.after.content.severeReview).toEqual({
      missed: 1,
      detected: 1,
      unknown: 0,
      missRate: 0.5
    })
    expect(comparison.severeMissDelta).toBe(-1)
    expect(comparison.after.content.byCategory.style).toEqual({
      passed: 0,
      failed: 0,
      unknown: 2
    })
    expect(comparison.after.measurements).toEqual({
      humanReworkMinutes: null,
      adoptionRate: null,
      realCost: null
    })
    expect(comparison.after.observations.costs).toEqual({
      groups: [],
      unknownBilled: 3,
      unknownEstimated: 3
    })
    expect(comparison.realQualityValidated).toBe(false)
    expect(comparison.after.evidence).toBe('synthetic_controlled_only')
    expect(comparison.before.inputSha256).toBe(comparison.after.inputSha256)
    expect(compareControlledVariants(dataset, before, after)).toEqual(
      comparison
    )
    expect(JSON.stringify(comparison)).not.toContain('修灯人')
  })
  it('keeps authored expectations awaiting human review and unlabelled data unknown', () => {
    const { dataset, after } = fixture(),
      report = runControlledEvaluation(dataset, after)
    expect(
      report.content.checks.find((c) => c.labelId === 'prose')
    ).toMatchObject({ outcome: 'unknown', reason: 'pending_human' })
    expect(
      report.content.checks.find((c) => c.labelId === 'subtext-unlabelled')
    ).toMatchObject({ outcome: 'unknown', reason: 'unlabelled' })
    expect(report.observations.adoption).toMatchObject({
      adopted: 0,
      unknown: 3,
      rate: null
    })
  })
  it.each(['truncated', 'unknown', 'incomplete'] as const)(
    'marks checks unknown for %s candidates rather than judging a partial response',
    (completion) => {
      const { dataset, after } = fixture()
      after.records[1].completion = completion
      after.records[1].status = completion === 'unknown' ? 'unknown' : 'failed'
      after.records[1].outputs = []
      const report = runControlledEvaluation(dataset, after)
      expect(report.engineering).toEqual({ passed: 2, failed: 1, total: 3 })
      expect(
        report.content.checks
          .filter((c) => c.sampleId === 'episode-1')
          .every((c) => c.outcome === 'unknown')
      ).toBe(true)
      expect(report.content.severeReview).toEqual({
        missed: 1,
        detected: 0,
        unknown: 1,
        missRate: null
      })
    }
  )
  it('keeps blank synthetic candidates from passing a completed-response engineering check', () => {
    const { dataset, after } = fixture()
    after.candidates[0].text = '   '
    const report = runControlledEvaluation(dataset, after)
    expect(report.engineering).toEqual({ passed: 2, failed: 1, total: 3 })
    expect(
      report.content.checks
        .filter((c) => c.sampleId === 'short-story')
        .every((c) => c.outcome === 'unknown')
    ).toBe(true)
  })
  it('keeps missing severe review annotations unknown and refuses records for another input version', () => {
    const { dataset, after } = fixture()
    const label = dataset.samples[2].labels.find(
      (item) => item.category === 'review_detection'
    )!
    label.annotation = 'unlabelled'
    label.matcher = 'human_only'
    label.value = null
    after.inputSha256 = controlledDatasetFingerprint(dataset)
    expect(
      runControlledEvaluation(dataset, after).content.severeReview
    ).toEqual({ missed: 0, detected: 1, unknown: 1, missRate: null })
    after.records[0].identity.target.version = 'another-source'
    expect(() => runControlledEvaluation(dataset, after)).toThrow()
  })
  it('makes the literal matcher limitation observable: negated prose can match the required phrase', () => {
    const { dataset, after } = fixture()
    after.candidates[0].text = '没有三次灯闪。妹妹林汀没有前往旧渡口。'
    const report = runControlledEvaluation(dataset, after)
    expect(
      report.content.checks.find((c) => c.labelId === 'signal')
    ).toMatchObject({ outcome: 'passed', reason: 'literal_fixture_check' })
    expect(report.realQualityValidated).toBe(false)
    expect(report.content.byCategory.style.unknown).toBe(2)
  })
  it('fingerprints input content and rejects unrelated versions, ambiguous sample sets and output identity mismatches', () => {
    const { dataset, before, after } = fixture()
    after.datasetVersion = 'wrong'
    expect(() => compareControlledVariants(dataset, before, after)).toThrow()
    after.datasetVersion = '1'
    const hash = runControlledEvaluation(dataset, after).inputSha256
    const reordered = Object.fromEntries(Object.entries(dataset).reverse())
    expect(controlledDatasetFingerprint(reordered)).toBe(hash)
    const originalSource = dataset.samples[0].source
    dataset.samples[0].source += '补充背景。'
    expect(() => runControlledEvaluation(dataset, after)).toThrow()
    dataset.samples[0].source = originalSource
    after.candidates[0].output.version = 'wrong-output'
    expect(() => runControlledEvaluation(dataset, after)).toThrow()
    after.candidates[0].output.version = 'v2'
    after.candidates[0].observation.runId = 'other-run'
    expect(() => runControlledEvaluation(dataset, after)).toThrow()
    after.candidates[0].observation.runId = 'v2'
    after.candidates.push(structuredClone(after.candidates[0]))
    expect(() => runControlledEvaluation(dataset, after)).toThrow()
  })
  it('rejects permissive schema downgrades, fabricated measurements and unsupported label modes', () => {
    const { dataset, before, after } = fixture()
    expect(() =>
      parseControlledDataset({ ...dataset, schemaVersion: 2 })
    ).toThrow()
    expect(() =>
      parseControlledVariant({ ...after, humanReworkMinutes: 5 })
    ).toThrow()
    expect(() =>
      parseControlledVariant({ ...after, provenance: 'real_model' })
    ).toThrow()
    expect(() => compareControlledVariants(dataset, before, before)).toThrow()
    dataset.samples[0].labels[0].value = ''
    expect(() => parseControlledDataset(dataset)).toThrow()
    const other = fixture().dataset
    other.samples[0].labels.push(structuredClone(other.samples[0].labels[0]))
    expect(() => parseControlledDataset(other)).toThrow()
  })
})
