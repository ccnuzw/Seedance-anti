import { parentPort } from 'node:worker_threads'
import {
  hasProjectSourceNovel,
  invalidateProjectScanCache,
  scanEpisodeFilesystem,
  scanProjectFilesystem
} from '../project-sync/scan'
import type { Project } from '@shared/types'

interface ProjectSyncWorkerData {
  mode: 'project' | 'episodes' | 'invalidate'
  projectPath: string
  config?: Project['config']
  totalEpisodes: number
  episodeNumbers?: number[]
}

if (!parentPort) throw new Error('worker 缺少 parentPort')
const port = parentPort
port.on(
  'message',
  ({ id, data }: { id: number; data: ProjectSyncWorkerData }) => {
    try {
      if (data.mode === 'invalidate') {
        invalidateProjectScanCache(data.projectPath)
        port.postMessage({
          id,
          result: { hasSourceNovel: false, episodeNumbers: [], episodes: [] }
        })
        return
      }
      if (data.mode === 'project') {
        port.postMessage({
          id,
          result: scanProjectFilesystem(
            data.projectPath,
            data.config,
            data.totalEpisodes
          )
        })
        return
      }
      if (!data.episodeNumbers?.length)
        throw new Error('缺少合法的 episodeNumbers')
      const hasSourceNovel = hasProjectSourceNovel(
        data.projectPath,
        data.config
      )
      port.postMessage({
        id,
        result: {
          hasSourceNovel,
          episodeNumbers: data.episodeNumbers,
          episodes: data.episodeNumbers.map((number) =>
            scanEpisodeFilesystem(
              data.projectPath,
              data.config,
              number,
              hasSourceNovel
            )
          )
        }
      })
    } catch (error) {
      port.postMessage({
        id,
        error: error instanceof Error ? error.message : '扫描失败'
      })
    }
  }
)
