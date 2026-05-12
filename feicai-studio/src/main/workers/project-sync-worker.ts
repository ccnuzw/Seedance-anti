import { parentPort, workerData } from 'node:worker_threads'
import {
  hasProjectSourceNovel,
  scanEpisodeFilesystem,
  scanProjectFilesystem
} from '../project-sync/scan'
import type { Project } from '@shared/types'

interface ProjectSyncWorkerData {
  mode: 'project' | 'episode'
  projectPath: string
  config?: Project['config']
  totalEpisodes: number
  episodeNumber?: number
}

function run(): void {
  const data = workerData as ProjectSyncWorkerData
  if (!parentPort) {
    throw new Error('worker 缺少 parentPort')
  }

  if (data.mode === 'project') {
    parentPort.postMessage(
      scanProjectFilesystem(data.projectPath, data.config, data.totalEpisodes)
    )
    return
  }

  if (!data.episodeNumber || data.episodeNumber <= 0) {
    throw new Error('缺少合法的 episodeNumber')
  }

  const hasSourceNovel = hasProjectSourceNovel(data.projectPath, data.config)
  const episodeScan = scanEpisodeFilesystem(
    data.projectPath,
    data.config,
    data.episodeNumber,
    hasSourceNovel
  )

  parentPort.postMessage({
    hasSourceNovel,
    episode: episodeScan
  })
}

run()
