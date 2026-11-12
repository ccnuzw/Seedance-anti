import { describe, expect, it, vi } from 'vitest'
import { refreshSettingsSummary } from './refresh-settings-summary'

describe('refreshSettingsSummary', () => {
  it('returns a summary refresh error as a post-save failure, not a rejected save', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('summary unavailable'))

    await expect(refreshSettingsSummary(refresh)).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ message: 'summary unavailable' })
    })
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('returns a refreshed summary when available', async () => {
    const summary = { totalEntries: 3 }

    await expect(refreshSettingsSummary(async () => summary)).resolves.toEqual({
      ok: true,
      summary
    })
  })
})
