import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { PipelineState } from '@shared/types'
import './StageNode.css'

export interface StageNodeData {
  label: string
  emoji: string
  stage: string
  state: PipelineState
  isActive: boolean
  isDone: boolean
  timeLabel?: string
}

const STATE_CLASSES: Record<string, string> = {
  idle: 'stage-idle',
  active: 'stage-active',
  reviewing: 'stage-reviewing',
  done: 'stage-done',
  error: 'stage-error'
}

function getNodeStatus(data: StageNodeData): string {
  if (data.isDone) return 'done'
  if (data.isActive) {
    if (data.state.endsWith('_reviewing')) return 'reviewing'
    return 'active'
  }
  if (data.state === 'error') return 'error'
  return 'idle'
}

function StageNode({ data }: NodeProps & { data: StageNodeData }) {
  const status = getNodeStatus(data)
  const cls = STATE_CLASSES[status] || 'stage-idle'

  return (
    <div className={`stage-node ${cls}`}>
      <Handle type="target" position={Position.Left} className="stage-handle" />
      <div className="stage-emoji">{data.emoji}</div>
      <div className="stage-label">{data.label}</div>
      {data.timeLabel && <div className="stage-time">{data.timeLabel}</div>}
      {status === 'active' && <div className="stage-pulse" />}
      {status === 'done' && <div className="stage-check">✓</div>}
      {status === 'reviewing' && <div className="stage-reviewing-badge">审核中</div>}
      <Handle type="source" position={Position.Right} className="stage-handle" />
    </div>
  )
}

export default memo(StageNode)
