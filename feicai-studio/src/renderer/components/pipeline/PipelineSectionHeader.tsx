import { memo } from 'react'

interface Props {
  title: string
  description: string
  buttonLabel?: string
  onToggle?: () => void
  expanded?: boolean
  controls?: string
}

function PipelineSectionHeader(props: Props) {
  const { title, description, buttonLabel, onToggle, expanded, controls } =
    props

  return (
    <div
      className={`pipeline-section-header ${buttonLabel ? 'pipeline-toggle-header' : ''}`}
    >
      <div>
        <h3>{title}</h3>
        <p className="text-secondary">{description}</p>
      </div>
      {buttonLabel && onToggle && (
        <button
          className="btn btn-sm"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={controls}
        >
          {buttonLabel}
        </button>
      )}
    </div>
  )
}

export default memo(PipelineSectionHeader)
