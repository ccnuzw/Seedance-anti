import { createHash } from 'node:crypto'
import {
  array,
  decode,
  id,
  invalid,
  nullable,
  oneOf,
  reference,
  shape,
  type Check
} from '@shared/generation-observation/schema'
import type {
  GenerationObservation,
  ObjectVersionReference
} from '@shared/generation-observation'
import { parseGenerationObservation } from '@shared/generation-observation'
import { validateObservationSet } from './observations'
import { summarizeObservations, type ObservationSummary } from './summary'

export type QualityCategory =
  | 'key_event'
  | 'character_continuity'
  | 'prop_continuity'
  | 'relationship'
  | 'scene'
  | 'review_detection'
  | 'style'
interface ExpectedLabel {
  labelId: string
  category: QualityCategory
  severity: 'critical' | 'major' | 'minor'
  annotation: 'authored_expectation' | 'unlabelled'
  matcher:
    'required_literal' | 'forbidden_literal' | 'review_detection' | 'human_only'
  value: string | null
}
export interface ControlledDataset {
  schemaVersion: 1
  datasetId: string
  version: string
  provenance: 'original_for_repository'
  license: 'CC0-1.0'
  samples: Array<{
    sampleId: string
    kind: 'short_story' | 'episode'
    target: ObjectVersionReference
    source: string
    labels: ExpectedLabel[]
  }>
}
export interface ControlledVariant {
  schemaVersion: 1
  datasetId: string
  datasetVersion: string
  inputSha256: string
  variantId: string
  provenance: 'synthetic_fixture'
  candidates: Array<{
    sampleId: string
    output: ObjectVersionReference
    /** Text is confined to controlled fixtures, never included in observation/report logs. */
    text: string
    detectedIssueIds: string[]
    observation: {
      projectId: string
      taskId: string
      runId: string
      operationId: string
      attemptId: string
    }
  }>
  records: GenerationObservation[]
}
const text: Check = (value) => {
  if (typeof value !== 'string' || value.length > 100_000) invalid()
}
const categories = [
  'key_event',
  'character_continuity',
  'prop_continuity',
  'relationship',
  'scene',
  'review_detection',
  'style'
] as const
function unique(values: string[]): void {
  if (new Set(values).size !== values.length) invalid()
}
export function parseControlledDataset(value: unknown): ControlledDataset {
  const dataset = decode<ControlledDataset>(
    value,
    shape({
      schemaVersion: oneOf([1]),
      datasetId: id,
      version: id,
      provenance: oneOf(['original_for_repository']),
      license: oneOf(['CC0-1.0']),
      samples: array(
        shape({
          sampleId: id,
          kind: oneOf(['short_story', 'episode']),
          target: reference,
          source: text,
          labels: array(
            shape({
              labelId: id,
              category: oneOf(categories),
              severity: oneOf(['critical', 'major', 'minor']),
              annotation: oneOf(['authored_expectation', 'unlabelled']),
              matcher: oneOf([
                'required_literal',
                'forbidden_literal',
                'review_detection',
                'human_only'
              ]),
              value: nullable(text)
            })
          )
        })
      )
    })
  )
  if (!dataset.samples.length) invalid()
  unique(dataset.samples.map((s) => s.sampleId))
  for (const sample of dataset.samples) {
    if (!sample.source.trim() || !sample.labels.length) invalid()
    unique(sample.labels.map((label) => label.labelId))
    for (const label of sample.labels) {
      if (label.matcher === 'human_only' || label.annotation === 'unlabelled') {
        if (label.value !== null || label.matcher !== 'human_only') invalid()
      } else if (!label.value?.trim()) invalid()
      if (
        label.matcher === 'review_detection' &&
        label.category !== 'review_detection'
      )
        invalid()
      if (
        label.category === 'review_detection' &&
        !['review_detection', 'human_only'].includes(label.matcher)
      )
        invalid()
    }
  }
  return dataset
}
export function parseControlledVariant(value: unknown): ControlledVariant {
  const variant = decode<ControlledVariant>(
    value,
    shape({
      schemaVersion: oneOf([1]),
      datasetId: id,
      datasetVersion: id,
      inputSha256: (value) => {
        if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
          invalid()
      },
      variantId: id,
      provenance: oneOf(['synthetic_fixture']),
      candidates: array(
        shape({
          sampleId: id,
          output: reference,
          text,
          detectedIssueIds: array(id),
          observation: shape({
            projectId: id,
            taskId: id,
            runId: id,
            operationId: id,
            attemptId: id
          })
        })
      ),
      records: array((record) => {
        parseGenerationObservation(record)
      })
    })
  )
  unique(variant.candidates.map((c) => c.sampleId))
  for (const candidate of variant.candidates) unique(candidate.detectedIssueIds)
  variant.records = validateObservationSet(variant.records)
  return variant
}
export interface QualityCounts {
  passed: number
  failed: number
  unknown: number
}
export interface ControlledEvaluationReport {
  schemaVersion: 1
  datasetId: string
  datasetVersion: string
  inputSha256: string
  variantId: string
  evidence: 'synthetic_controlled_only'
  realQualityValidated: false
  engineering: { passed: number; failed: number; total: number }
  content: {
    byCategory: Record<QualityCategory, QualityCounts>
    checks: Array<{
      sampleId: string
      labelId: string
      outcome: 'passed' | 'failed' | 'unknown'
      reason:
        | 'literal_fixture_check'
        | 'synthetic_review_check'
        | 'pending_human'
        | 'unlabelled'
        | 'incomplete_candidate'
    }>
    severeReview: {
      missed: number
      detected: number
      unknown: number
      missRate: number | null
    }
  }
  observations: ObservationSummary
  measurements: { humanReworkMinutes: null; adoptionRate: null; realCost: null }
}
function candidateRecord(
  candidate: ControlledVariant['candidates'][number],
  records: GenerationObservation[]
): GenerationObservation {
  const ref = candidate.observation
  const record = records.find(
    (r) =>
      r.attemptId === ref.attemptId &&
      r.identity.projectId === ref.projectId &&
      r.identity.taskId === ref.taskId &&
      r.identity.runId === ref.runId &&
      r.identity.operationId === ref.operationId
  )
  if (!record || record.kind !== 'generation') invalid()
  if (
    record.status === 'succeeded' &&
    !record.outputs.some(
      (o) =>
        o.objectId === candidate.output.objectId &&
        o.version === candidate.output.version
    )
  )
    invalid()
  return record
}
/** Literal fixtures exercise accounting and known defects, not open-ended semantic judging. */
export function runControlledEvaluation(
  datasetValue: unknown,
  variantValue: unknown
): ControlledEvaluationReport {
  const dataset = parseControlledDataset(datasetValue),
    variant = parseControlledVariant(variantValue)
  const inputSha256 = controlledDatasetFingerprint(dataset)
  if (
    variant.inputSha256 !== inputSha256 ||
    variant.datasetId !== dataset.datasetId ||
    variant.datasetVersion !== dataset.version ||
    variant.candidates.length !== dataset.samples.length
  )
    invalid()
  const targetKey = (ref: ObjectVersionReference) =>
    JSON.stringify([ref.objectId, ref.version])
  const inputTargets = new Set(
    dataset.samples.map((sample) => targetKey(sample.target))
  )
  for (const record of variant.records) {
    if (!inputTargets.has(targetKey(record.identity.target))) invalid()
  }
  const byCategory = Object.fromEntries(
    categories.map((category) => [
      category,
      { passed: 0, failed: 0, unknown: 0 }
    ])
  ) as ControlledEvaluationReport['content']['byCategory']
  const report: ControlledEvaluationReport = {
    schemaVersion: 1,
    datasetId: dataset.datasetId,
    datasetVersion: dataset.version,
    inputSha256,
    variantId: variant.variantId,
    evidence: 'synthetic_controlled_only',
    realQualityValidated: false,
    engineering: { passed: 0, failed: 0, total: variant.candidates.length },
    content: {
      byCategory,
      checks: [],
      severeReview: { missed: 0, detected: 0, unknown: 0, missRate: null }
    },
    observations: summarizeObservations(variant.records),
    measurements: {
      humanReworkMinutes: null,
      adoptionRate: null,
      realCost: null
    }
  }
  for (const sample of dataset.samples) {
    const candidate = variant.candidates.find(
      (c) => c.sampleId === sample.sampleId
    )
    if (!candidate) invalid()
    const record = candidateRecord(candidate, variant.records)
    if (targetKey(record.identity.target) !== targetKey(sample.target))
      invalid()
    const complete =
      record.status === 'succeeded' &&
      record.completion === 'complete' &&
      candidate.text.trim().length > 0
    report.engineering[complete ? 'passed' : 'failed']++
    for (const label of sample.labels) {
      let outcome: 'passed' | 'failed' | 'unknown' = 'unknown'
      let reason: ControlledEvaluationReport['content']['checks'][number]['reason']
      if (label.annotation === 'unlabelled') reason = 'unlabelled'
      else if (label.matcher === 'human_only') reason = 'pending_human'
      else if (!complete) reason = 'incomplete_candidate'
      else if (label.matcher === 'review_detection') {
        outcome = candidate.detectedIssueIds.includes(label.value!)
          ? 'passed'
          : 'failed'
        reason = 'synthetic_review_check'
      } else {
        const contains = candidate.text.includes(label.value!)
        outcome = (label.matcher === 'required_literal' ? contains : !contains)
          ? 'passed'
          : 'failed'
        reason = 'literal_fixture_check'
      }
      report.content.byCategory[label.category][outcome]++
      report.content.checks.push({
        sampleId: sample.sampleId,
        labelId: label.labelId,
        outcome,
        reason
      })
      if (
        label.category === 'review_detection' &&
        label.severity === 'critical'
      ) {
        const severe = report.content.severeReview
        severe[
          outcome === 'passed'
            ? 'detected'
            : outcome === 'failed'
              ? 'missed'
              : 'unknown'
        ]++
      }
    }
  }
  const severe = report.content.severeReview,
    judged = severe.missed + severe.detected
  if (judged && !severe.unknown) severe.missRate = severe.missed / judged
  return report
}
export function controlledDatasetFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(canonical(parseControlledDataset(value)))
    .digest('hex')
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
/** Re-run both versions against the exact same parsed inputs; never compare unrelated reports. */
export function compareControlledVariants(
  dataset: unknown,
  before: unknown,
  after: unknown
) {
  const a = runControlledEvaluation(dataset, before),
    b = runControlledEvaluation(dataset, after)
  if (a.variantId === b.variantId) invalid()
  return {
    schemaVersion: 1 as const,
    evidence: 'synthetic_controlled_only' as const,
    inputSha256: a.inputSha256,
    before: a,
    after: b,
    failedCheckDelta: Object.fromEntries(
      categories.map((c) => [
        c,
        b.content.byCategory[c].failed - a.content.byCategory[c].failed
      ])
    ) as Record<QualityCategory, number>,
    severeMissDelta:
      b.content.severeReview.missed - a.content.severeReview.missed,
    /** A negative fixture delta is not a claim of model/Skill quality improvement. */
    realQualityValidated: false as const
  }
}
