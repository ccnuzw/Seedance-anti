export type SettingsSummaryRefresh<T> =
  { ok: true; summary: T } | { ok: false; error: unknown }

export async function refreshSettingsSummary<T>(
  refresh: () => Promise<T>
): Promise<SettingsSummaryRefresh<T>> {
  try {
    return { ok: true, summary: await refresh() }
  } catch (error) {
    return { ok: false, error }
  }
}
