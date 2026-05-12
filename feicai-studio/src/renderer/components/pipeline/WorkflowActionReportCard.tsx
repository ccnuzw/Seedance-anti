import type { WorkflowActionResult } from '@renderer/utils/pipeline-view'
import {
  getWorkflowReportStatus,
  getWorkflowReportTitle
} from './workflow-action-panel-config'

interface Props {
  report: WorkflowActionResult
}

export default function WorkflowActionReportCard({ report }: Props) {
  return (
    <div
      className={`card workflow-report-card ${report.success ? 'is-success' : 'is-fail'}`}
    >
      <div className="workflow-report-header">
        <strong>{getWorkflowReportTitle(report.stage)}</strong>
        <span className="workflow-report-result">
          {getWorkflowReportStatus(report)}
        </span>
      </div>
      {report.outputPath && (
        <p className="text-secondary">产物已写入：{report.outputPath}</p>
      )}
      {report.error && <p className="text-secondary">{report.error}</p>}
      {report.review && (
        <details className="workflow-report-details">
          <summary>查看审核反馈</summary>
          <pre>{report.review.feedback}</pre>
        </details>
      )}
    </div>
  )
}
