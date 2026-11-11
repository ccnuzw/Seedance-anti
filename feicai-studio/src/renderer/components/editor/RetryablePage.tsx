import { Component, Suspense, lazy, useMemo, useState } from 'react'
import type { ComponentType, ErrorInfo, ReactNode } from 'react'
import LoadingSpinner from '@renderer/components/layout/LoadingSpinner'
import './DocumentRecovery.css'

interface Props {
  children: ReactNode
  onRetry: () => void
}
class PageErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Keep raw failure details out of the UI. */
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section
        className="document-notice"
        role="alert"
        aria-label="页面加载失败"
      >
        <strong>页面无法加载</strong>
        <p>页面资源加载失败或发生错误。项目磁盘文件未被修改，可以重试。</p>
        <button className="btn btn-primary" onClick={this.props.onRetry}>
          重试加载页面
        </button>
      </section>
    )
  }
}

// A new lazy instance on retry is required: React.lazy caches rejected imports.
export function retryablePage(
  loader: () => Promise<{ default: ComponentType }>
) {
  return function RetryablePage() {
    const [attempt, setAttempt] = useState(0)
    const Page = useMemo(() => {
      void attempt
      return lazy(loader)
    }, [attempt])
    return (
      <PageErrorBoundary
        key={attempt}
        onRetry={() => setAttempt((value) => value + 1)}
      >
        <Suspense fallback={<LoadingSpinner size="lg" text="页面加载中..." />}>
          <Page />
        </Suspense>
      </PageErrorBoundary>
    )
  }
}
