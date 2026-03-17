import './LoadingSpinner.css'

interface Props {
  size?: 'sm' | 'md' | 'lg'
  text?: string
}

export default function LoadingSpinner({ size = 'md', text }: Props) {
  return (
    <div className={`loading-spinner spinner-${size}`}>
      <div className="spinner-ring">
        <div className="spinner-arc" />
      </div>
      {text && <span className="spinner-text text-secondary">{text}</span>}
    </div>
  )
}
