import { describe, expect, it } from 'vitest'
import { buildProjectRoute, resolveLegacyProjectRedirect } from './project-routing'

describe('project-routing', () => {
  it('builds canonical project routes with and without query params', () => {
    expect(buildProjectRoute('project-1', 'workspace')).toBe('/project/project-1/workspace')
    expect(buildProjectRoute('project-1', 'settings')).toBe('/project/project-1/settings')
    expect(buildProjectRoute('project-1', 'production', new URLSearchParams({ tab: 'pipeline', ep: '12' })))
      .toBe('/project/project-1/production?tab=pipeline&ep=12')
  })

  it('maps legacy writing routes to new canonical sections', () => {
    expect(resolveLegacyProjectRedirect('project-1', 'source', '?tab=source&ep=8'))
      .toBe('/project/project-1/source?tab=source')
    expect(resolveLegacyProjectRedirect('project-1', 'script', '?ep=3'))
      .toBe('/project/project-1/script?ep=3')
    expect(resolveLegacyProjectRedirect('project-1', 'delivery', ''))
      .toBe('/project/project-1/delivery')
  })

  it('overrides tab when mapping legacy production utilities', () => {
    expect(resolveLegacyProjectRedirect('project-1', 'production', '?ep=4', { tab: 'assets' }))
      .toBe('/project/project-1/production?ep=4&tab=assets')
    expect(resolveLegacyProjectRedirect('project-1', 'production', '?tab=review&ep=2', { tab: 'batch' }))
      .toBe('/project/project-1/production?tab=batch&ep=2')
  })
})
