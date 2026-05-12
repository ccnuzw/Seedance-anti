import { memo } from 'react'

interface Props {
  title: string
  description: string
  buttonLabel?: string
  onToggle?: () => void
}

function PipelineSectionHeader(props: Props) {
  const { title, description, buttonLabel, onToggle } = props

  return (
    <div
      className={`pipeline-section-header ${buttonLabel ? 'pipeline-toggle-header' : ''}`}
    >
      <div>
        <h3>{title}</h3>
        <p className="text-secondary">{description}</p>
      </div>
      {buttonLabel && onToggle && (
        <button className="btn btn-sm" onClick={onToggle}>
          {buttonLabel}
        </button>
      )}
    </div>
  )
}

export default memo(PipelineSectionHeader)
