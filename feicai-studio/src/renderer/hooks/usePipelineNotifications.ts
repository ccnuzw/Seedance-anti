import { useEffect } from 'react'
import { useToastStore } from '@renderer/stores/toastStore'
import type { PipelineState } from '@shared/types'

interface Params {
  state: PipelineState
  episodeNum: number
  isEngineMatch: boolean
}

export function usePipelineNotifications(params: Params) {
  const { state, episodeNum, isEngineMatch } = params
  const { addToast } = useToastStore()

  useEffect(() => {
    if (!isEngineMatch) return
    if (state === 'episode_complete' && episodeNum) {
      addToast(
        'success',
        `EP${String(episodeNum).padStart(2, '0')} 全流程完成！`,
        { title: '🎉 流水线完成' }
      )
      try {
        new Notification('FEICAI Studio', {
          body: `EP${String(episodeNum).padStart(2, '0')} 全流程完成 ✅`,
          silent: false
        })
      } catch {
        // ignore notification failures
      }
    }
    if (state === 'error') {
      addToast('error', '流水线执行遇到错误，请查看日志', { title: '执行出错' })
    }
  }, [state, episodeNum, isEngineMatch, addToast])
}
