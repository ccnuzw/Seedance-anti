import { memo } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeTypes
} from '@xyflow/react'
import { DevProfiler } from '@renderer/dev/render-profiler'

interface PipelineCanvasProps {
  nodes: Node[]
  edges: Edge[]
  nodeTypes: NodeTypes
}

function PipelineCanvas({ nodes, edges, nodeTypes }: PipelineCanvasProps) {
  return (
    <DevProfiler id="PipelineCanvas">
      <div className="pipeline-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ maxZoom: 1.2, padding: 0.05 }}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            type: 'smoothstep',
            style: { strokeWidth: 2 }
          }}
        >
          <Background color="var(--color-border-subtle)" gap={20} size={1} />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
      </div>
    </DevProfiler>
  )
}

export default memo(PipelineCanvas)
