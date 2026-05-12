import type {
  ProjectIntegrityCheck,
  ProjectIntegrityGroup,
  ProjectIntegrityReport,
  ProjectIntegrityStatus,
  ProjectRepairActionId
} from '@shared/project-detection'
import { PROJECT_INTEGRITY_GROUP_LABELS } from '@shared/project-detection'

interface ProjectIntegrityCardProps {
  report: ProjectIntegrityReport
  onConfirm?: () => void
  onCancel?: () => void
  confirmLabel?: string
  title?: string
  actionLoadingIds?: ProjectRepairActionId[]
  onRepairAction?: (actionId: ProjectRepairActionId) => void
  onRepairAll?: () => void
}

function statusText(status: ProjectIntegrityStatus): string {
  if (status === 'pass') return '通过'
  if (status === 'warn') return '警告'
  return '失败'
}

function statusIcon(status: ProjectIntegrityStatus): string {
  if (status === 'pass') return '✅'
  if (status === 'warn') return '⚠️'
  return '⛔'
}

const GROUP_ORDER: ProjectIntegrityGroup[] = [
  'config',
  'directories',
  'content',
  'legacy'
]

function renderCheck(
  check: ProjectIntegrityCheck,
  actionLoadingIds: ProjectRepairActionId[],
  onRepairAction?: (actionId: ProjectRepairActionId) => void
) {
  return (
    <div
      key={check.id}
      style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}
    >
      <span>{statusIcon(check.status)}</span>
      <div>
        <strong>{check.label}</strong>
        <div className="text-secondary">{check.detail}</div>
        {check.path && (
          <div
            className="text-secondary"
            style={{ fontSize: 'var(--font-size-xs)', wordBreak: 'break-all' }}
          >
            {check.path}
          </div>
        )}
        {check.repairActions &&
          check.repairActions.length > 0 &&
          onRepairAction && (
            <div
              style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
                marginTop: '8px'
              }}
            >
              {check.repairActions.map((action) => (
                <button
                  key={`${check.id}-${action.id}`}
                  className="btn btn-sm"
                  onClick={() => onRepairAction(action.id)}
                  disabled={actionLoadingIds.includes(action.id)}
                >
                  {actionLoadingIds.includes(action.id)
                    ? '⏳ 处理中...'
                    : action.label}
                </button>
              ))}
            </div>
          )}
      </div>
    </div>
  )
}

export default function ProjectIntegrityCard(props: ProjectIntegrityCardProps) {
  const {
    report,
    onConfirm,
    onCancel,
    confirmLabel = '继续导入',
    title = '🧪 项目体检与修复',
    actionLoadingIds = [],
    onRepairAction,
    onRepairAll
  } = props
  const canConfirm = !!onConfirm
  const groupedChecks = GROUP_ORDER.map((group) => ({
    group,
    checks: report.checks.filter((check) => check.group === group)
  })).filter((section) => section.checks.length > 0)

  return (
    <div className="card" style={{ marginTop: 'var(--spacing-md)' }}>
      <div className="pipeline-settings-header">
        <h3>{title}</h3>
        <span
          className={`badge ${report.status === 'pass' ? 'badge-success' : report.status === 'warn' ? 'badge-warning' : 'badge-danger'}`}
        >
          {statusIcon(report.status)} {statusText(report.status)}
        </span>
      </div>
      <div
        className="text-secondary"
        style={{ lineHeight: 1.7, marginBottom: 'var(--spacing-sm)' }}
      >
        {report.summary}，已识别 {report.detectedEpisodes} 集
        {report.expectedEpisodes ? ` / 目标 ${report.expectedEpisodes} 集` : ''}
        。
      </div>
      <div style={{ display: 'grid', gap: '8px' }}>
        {groupedChecks.map((section) => (
          <div key={section.group} style={{ display: 'grid', gap: '8px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 'var(--spacing-sm)',
                borderTop: '1px solid var(--color-border-subtle)'
              }}
            >
              <strong>{PROJECT_INTEGRITY_GROUP_LABELS[section.group]}</strong>
              <span
                className="text-secondary"
                style={{ fontSize: 'var(--font-size-xs)' }}
              >
                {section.checks.length} 项
              </span>
            </div>
            {section.checks.map((check) =>
              renderCheck(check, actionLoadingIds, onRepairAction)
            )}
          </div>
        ))}
      </div>
      {report.recommendedActions &&
        report.recommendedActions.length > 0 &&
        onRepairAll && (
          <div
            className="pipeline-settings-actions"
            style={{ marginTop: 'var(--spacing-md)' }}
          >
            <button className="btn btn-sm btn-primary" onClick={onRepairAll}>
              一键修复建议项
            </button>
          </div>
        )}
      {(onConfirm || onCancel) && (
        <div
          className="pipeline-settings-actions"
          style={{ marginTop: 'var(--spacing-md)' }}
        >
          {onCancel && (
            <button className="btn btn-sm" onClick={onCancel}>
              取消
            </button>
          )}
          {onConfirm && (
            <button
              className="btn btn-sm btn-primary"
              onClick={onConfirm}
              disabled={!canConfirm}
            >
              {report.status === 'fail' ? '仍然导入' : confirmLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
