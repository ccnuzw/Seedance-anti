import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ReviewResult } from '@shared/types'
import './ReviewNode.css'

export interface ReviewNodeData {
  label: string
  stage: string
  review: ReviewResult | null
  isActive: boolean
}

function ReviewNode({ data }: NodeProps & { data: ReviewNodeData }) {
  const { review, isActive } = data

  let statusCls = 'review-idle'
  let display = '❓'

  if (isActive) {
    statusCls = 'review-active'
    display = '⏳'
  } else if (review) {
    if (review.result === 'PASS') {
      statusCls = 'review-pass'
      display = `✅ ${review.score}`
    } else {
      statusCls = 'review-fail'
      display = `❌ ${review.score}`
    }
  }

  return (
    <div className={`review-node ${statusCls}`}>
      <Handle type="target" position={Position.Top} className="review-handle" />
      <div className="review-display">{display}</div>
      <div className="review-label">{data.label}</div>
      <Handle type="source" position={Position.Bottom} className="review-handle" />
    </div>
  )
}

export default memo(ReviewNode)
