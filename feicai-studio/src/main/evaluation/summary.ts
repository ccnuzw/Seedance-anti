import {
  parseAdoptionMeasurement,
  type GenerationObservation,
  type ObjectVersionReference
} from '@shared/generation-observation'
import type { ProviderUsage } from '@shared/provider-capabilities'
import { invalid } from '@shared/generation-observation/schema'
import { validateObservationSet } from './observations'

export interface KnownSubtotal {
  /** Null when none were reported. A partial subtotal is never a total bill. */
  knownSubtotal: number | null
  reported: number
  unknown: number
}
export interface CostGroup {
  kind: 'billed' | 'estimated'
  currency: string
  source: 'provider_reported'
  provider: GenerationObservation['identity']['provider']
  priceVersion: string | null
  knownSubtotal: number
  reported: number
}
export interface ObservationSummary {
  schemaVersion: 1
  generationAttempts: number
  transportAttempts: number
  statuses: Record<GenerationObservation['status'], number>
  completions: Record<NonNullable<GenerationObservation['completion']>, number>
  errors: Partial<
    Record<NonNullable<GenerationObservation['error']>['category'], number>
  >
  usage: Record<'inputTokens' | 'outputTokens' | 'totalTokens', KnownSubtotal>
  costs: {
    groups: CostGroup[]
    unknownBilled: number
    unknownEstimated: number
  }
  adoption: {
    candidates: number
    adopted: number
    rejected: number
    unknown: number
    rate: number | null
  }
  /** No manual-time or real-cost measurements are collected by this module. */
  humanReworkMinutes: null
}
const outputKey = (projectId: string, output: ObjectVersionReference) =>
  JSON.stringify([projectId, output.objectId, output.version])
function sum(values: Array<number | undefined>): KnownSubtotal {
  const reported = values.filter((n): n is number => n !== undefined)
  const subtotal = reported.reduce((a, b) => a + b, 0)
  if (!Number.isSafeInteger(subtotal)) invalid()
  return {
    knownSubtotal: reported.length ? subtotal : null,
    reported: reported.length,
    unknown: values.length - reported.length
  }
}
export function summarizeObservations(
  values: readonly unknown[],
  adoptionValues: readonly unknown[] = []
): ObservationSummary {
  const records = validateObservationSet(values)
  const generations = records.filter((r) => r.kind === 'generation')
  const summary: ObservationSummary = {
    schemaVersion: 1,
    generationAttempts: generations.length,
    transportAttempts: records.length - generations.length,
    statuses: {
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      unknown: 0,
      submitted: 0
    },
    completions: {
      complete: 0,
      truncated: 0,
      refused: 0,
      incomplete: 0,
      unknown: 0
    },
    errors: {},
    usage: {
      inputTokens: sum(generations.map((r) => r.usage.inputTokens)),
      outputTokens: sum(generations.map((r) => r.usage.outputTokens)),
      totalTokens: sum(generations.map((r) => r.usage.totalTokens))
    },
    costs: { groups: [], unknownBilled: 0, unknownEstimated: 0 },
    adoption: {
      candidates: 0,
      adopted: 0,
      rejected: 0,
      unknown: 0,
      rate: null
    },
    humanReworkMinutes: null
  }
  for (const record of records) {
    summary.statuses[record.status]++
    if (record.completion) summary.completions[record.completion]++
    if (record.error)
      summary.errors[record.error.category] =
        (summary.errors[record.error.category] ?? 0) + 1
  }
  const groups = new Map<string, CostGroup>()
  for (const record of generations) {
    for (const [field, kind] of [
      ['billedCost', 'billed'],
      ['estimatedCost', 'estimated']
    ] as const) {
      const cost = record.usage[field]
      if (!cost) {
        if (kind === 'billed') summary.costs.unknownBilled++
        else summary.costs.unknownEstimated++
        continue
      }
      const priceVersion =
        field === 'estimatedCost'
          ? (cost as NonNullable<ProviderUsage['estimatedCost']>).priceVersion
          : null
      const p = record.identity.provider
      const key = JSON.stringify([
        kind,
        cost.currency,
        priceVersion,
        p.name,
        p.connectionId,
        p.endpointRevision,
        p.descriptorId,
        p.descriptorRevision,
        p.modelId
      ])
      const group = groups.get(key) ?? {
        kind,
        currency: cost.currency,
        source: 'provider_reported',
        provider: structuredClone(p),
        priceVersion,
        knownSubtotal: 0,
        reported: 0
      }
      group.knownSubtotal += cost.amount
      if (!Number.isFinite(group.knownSubtotal)) invalid()
      group.reported++
      groups.set(key, group)
    }
  }
  summary.costs.groups = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => group)
  const candidates = new Set(
    generations.flatMap((record) =>
      record.outputs.map((output) =>
        outputKey(record.identity.projectId, output)
      )
    )
  )
  const decisions = new Map<string, 'adopted' | 'rejected' | 'unknown'>()
  for (const value of adoptionValues) {
    const measurement = parseAdoptionMeasurement(value)
    const key = outputKey(measurement.projectId, measurement.output)
    if (!candidates.has(key) || decisions.has(key)) invalid()
    decisions.set(key, measurement.decision)
  }
  summary.adoption.candidates = candidates.size
  for (const key of candidates)
    summary.adoption[decisions.get(key) ?? 'unknown']++
  if (candidates.size && !summary.adoption.unknown)
    summary.adoption.rate = summary.adoption.adopted / candidates.size
  return summary
}
