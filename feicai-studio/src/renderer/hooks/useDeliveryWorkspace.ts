import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IPC } from '@shared/ipc-channels'
import type { AppDeliveryStatus } from '@shared/types'
import { BUILTIN_EXPORT_PROFILES } from '@shared/template-catalog'
import { platformAPI } from '@renderer/platform/api'
import { buildProjectRoute } from '@renderer/project-routing'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'

const EXPORT_PROFILE_USAGE_KEY = 'feicai.delivery.exportProfileUsage'

function readExportProfileUsage(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(EXPORT_PROFILE_USAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeExportProfileUsage(usage: Record<string, string>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(EXPORT_PROFILE_USAGE_KEY, JSON.stringify(usage))
  } catch {
    // Ignore persistence failures in renderer-only decoration state.
  }
}

export function useDeliveryWorkspace() {
  useProjectSync()

  const navigate = useNavigate()
  const { currentProject, episodes, syncEpisodeStatus } = useProjectStore()
  const { waterLevel, adaptPlan, reviewFailedData, isRunning, fetchStatus, loadPlan } = useAdaptStore()
  const addToast = useToastStore((state) => state.addToast)

  const [showExport, setShowExport] = useState(false)
  const [initialProfileId, setInitialProfileId] = useState<string | undefined>(undefined)
  const [deliveryStatus, setDeliveryStatus] = useState<AppDeliveryStatus | null>(null)
  const [deliveryLoading, setDeliveryLoading] = useState(false)
  const [exportingDeliveryReport, setExportingDeliveryReport] = useState(false)
  const [recentProfileUsage, setRecentProfileUsage] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!currentProject) return
    void syncEpisodeStatus()
    if (currentProject.sourceType === 'novel') {
      void fetchStatus(currentProject.projectPath)
      void loadPlan(currentProject.projectPath)
    }
  }, [
    currentProject?.id,
    currentProject?.projectPath,
    currentProject?.sourceType,
    fetchStatus,
    loadPlan,
    syncEpisodeStatus
  ])

  useEffect(() => {
    setRecentProfileUsage(readExportProfileUsage())
  }, [])

  useEffect(() => {
    let active = true
    setDeliveryLoading(true)
    platformAPI.invoke(IPC.APP_GET_DELIVERY_STATUS)
      .then((status) => {
        if (active) {
          setDeliveryStatus(status as AppDeliveryStatus)
        }
      })
      .catch(() => {
        if (active) {
          setDeliveryStatus(null)
        }
      })
      .finally(() => {
        if (active) {
          setDeliveryLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const scriptsCount = episodes.filter((episode) => episode.hasScript).length
  const promptReadyCount = episodes.filter((episode) => episode.hasSeedancePrompts).length
  const completedCount = episodes.filter((episode) => episode.status === 'complete').length
  const totalEpisodes = currentProject?.totalEpisodes || episodes.length || 0
  const totalChapters = waterLevel?.totalChapters || 0
  const processedChapters = waterLevel?.processedChapters || 0
  const fullCoverageReady = totalEpisodes > 0 && scriptsCount >= totalEpisodes
  const canShiftPhase = scriptsCount > 0 && !reviewFailedData && !isRunning
  const readyScore = Math.round((
    [
      scriptsCount > 0,
      !reviewFailedData,
      !isRunning,
      currentProject?.sourceType !== 'novel' || totalChapters > 0,
      currentProject?.sourceType !== 'novel' || processedChapters > 0 || !!adaptPlan
    ].filter(Boolean).length / 5
  ) * 100)

  const recommendedProfiles = useMemo(() => {
    if (completedCount > 0) {
      return BUILTIN_EXPORT_PROFILES
    }
    if (promptReadyCount > 0) {
      return BUILTIN_EXPORT_PROFILES.filter((profile) => profile.id !== 'export:delivery-bundle')
    }
    return BUILTIN_EXPORT_PROFILES.filter((profile) => profile.id === 'export:scripts-manuscript' || profile.id === 'export:review-pack')
  }, [completedCount, promptReadyCount])

  const exportProfileReasonMap = useMemo(() => ({
    'export:delivery-bundle': completedCount > 0
      ? '已有完成制作集数，适合直接归档最终交付产物。'
      : '完整交付包通常留到制作完成后再导出。'
    ,
    'export:scripts-manuscript': scriptsCount > 0
      ? '当前已形成剧本基础，适合做编剧交接和总稿审阅。'
      : '先补齐剧本，再导出总稿更合理。'
    ,
    'export:review-pack': promptReadyCount === 0
      ? '当前更适合先做审阅流转，快速对齐内容质量。'
      : '适合作为人工审阅和群内流转的轻量包。'
    ,
    'export:prompt-dataset': promptReadyCount > 0
      ? '已有提示词产物，适合程序对接、统计或二次处理。'
      : '等提示词形成后再导出数据包价值更高。'
  }), [completedCount, promptReadyCount, scriptsCount])

  const recommendedProfilesWithMeta = useMemo(() => (
    recommendedProfiles.map((profile) => ({
      ...profile,
      reason: exportProfileReasonMap[profile.id as keyof typeof exportProfileReasonMap] || '适合当前交付阶段。',
      lastUsedAt: recentProfileUsage[profile.id]
    }))
  ), [exportProfileReasonMap, recentProfileUsage, recommendedProfiles])

  const handleOpenExport = useCallback((profileId?: string) => {
    const resolvedProfileId = profileId || currentProject?.config.exportProfileId || recommendedProfiles[0]?.id
    setInitialProfileId(resolvedProfileId)
    setShowExport(true)
    if (resolvedProfileId) {
      const nextUsage = {
        ...readExportProfileUsage(),
        [resolvedProfileId]: new Date().toISOString()
      }
      writeExportProfileUsage(nextUsage)
      setRecentProfileUsage(nextUsage)
    }
  }, [currentProject?.config.exportProfileId, recommendedProfiles])

  const handleCloseExport = useCallback(() => {
    setShowExport(false)
    setInitialProfileId(undefined)
  }, [])

  const handleExportDeliveryReport = useCallback(async () => {
    setExportingDeliveryReport(true)
    try {
      const result = await platformAPI.invoke(IPC.APP_EXPORT_DELIVERY_REPORT) as {
        filePath: string
        status: AppDeliveryStatus
      }
      setDeliveryStatus(result.status)
      addToast('success', `交付诊断已导出：${result.filePath}`)
    } catch (error) {
      addToast('error', `交付诊断导出失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setExportingDeliveryReport(false)
    }
  }, [addToast])

  return {
    currentProject,
    scriptsCount,
    promptReadyCount,
    completedCount,
    totalEpisodes,
    readyScore,
    fullCoverageReady,
    canShiftPhase,
    reviewFailedData,
    isRunning,
    deliveryStatus,
    deliveryLoading,
    exportingDeliveryReport,
    showExport,
    initialProfileId,
    recommendedProfiles: recommendedProfilesWithMeta,
    handleOpenExport,
    handleCloseExport,
    handleExportDeliveryReport,
    handleOpenSettings: () => currentProject && navigate(buildProjectRoute(currentProject.id, 'settings'))
  }
}
