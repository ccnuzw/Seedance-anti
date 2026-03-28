export function formatTelemetryUsd(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '$0.000000'
  }
  return `$${value.toFixed(6)}`
}

export function formatTelemetryTokens(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '0'
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`
  }
  return String(Math.round(value))
}

export function formatTelemetryDurationMs(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '--'
  }
  const totalSeconds = Math.max(1, Math.round(value / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) {
    return `${seconds}s`
  }
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}
