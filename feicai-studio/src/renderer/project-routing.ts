export type ProjectRouteTarget = 'workspace' | 'source' | 'script' | 'production' | 'delivery' | 'settings'

export function buildProjectRoute(
  projectId: string,
  target: ProjectRouteTarget,
  search?: URLSearchParams | string
): string {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const query = params?.toString() || ''
  return `/project/${projectId}/${target}${query ? `?${query}` : ''}`
}

export function resolveLegacyProjectRedirect(
  projectId: string,
  target: ProjectRouteTarget,
  currentSearch: string,
  extraParams?: Record<string, string>
): string {
  const search = new URLSearchParams(currentSearch)

  if (target === 'source') {
    search.delete('ep')
  }

  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      search.set(key, value)
    }
  }

  return buildProjectRoute(projectId, target, search)
}
