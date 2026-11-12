import { useState } from 'react'
import {
  PRODUCTION_STAGES,
  type ProductionRow
} from '@renderer/utils/project-production-view'

export interface ProjectProductionMatrixProps {
  projectId: string
  projectName: string
  entryLabel: string
  rows: ProductionRow[]
  loading: boolean
  error: string | null
  warning: string | null
  onRefresh: () => void
  onNavigate: (path: string) => void
  runningUnknown?: boolean
  running: { projectId: string; episodeNum: number; stage: string } | null
}
const PAGE_SIZE = 20

export default function ProjectProductionMatrix(
  props: ProjectProductionMatrixProps
) {
  const {
    projectId,
    projectName,
    entryLabel,
    rows,
    loading,
    error,
    warning,
    onNavigate,
    running
  } = props
  const [page, setPage] = useState(0)
  const [pendingOnly, setPendingOnly] = useState(false)
  const filtered = pendingOnly ? rows.filter((row) => !row.complete) : rows
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages - 1)
  const visible = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE
  )
  const pending = rows.filter((row) => !row.complete)
  const next = pending[0]
  const completed = rows.filter((row) => row.complete).length

  return (
    <section
      className="card production-matrix"
      aria-labelledby="production-title"
      aria-busy={loading}
    >
      <div className="production-heading">
        <div>
          <h2 id="production-title">分集制作矩阵</h2>
          <p>
            当前浏览：{projectName} · {entryLabel}
          </p>
        </div>
        <button
          className="btn btn-sm"
          disabled={loading}
          onClick={props.onRefresh}
        >
          {loading ? '刷新中…' : '刷新制作状态'}
        </button>
      </div>
      <p className="production-explanation">
        产物存在与有效审核分别显示。只有当前门禁全部满足才计为完成；未知状态需刷新确认。剧情、剧本进入对应编辑页，导演、服化道、分镜进入提示词页的对应标签，不定位正文段落。
      </p>
      <div className="production-task" role="status">
        {running ? (
          <>
            <span>
              后台任务：项目{' '}
              {running.projectId === projectId
                ? projectName
                : running.projectId}{' '}
              · 第 {running.episodeNum} 集 ·{' '}
              {PRODUCTION_STAGES.find((stage) => stage.id === running.stage)
                ?.label || running.stage}{' '}
              执行中。
              {running.projectId !== projectId &&
                '运行项目与当前浏览项目不同。'}
              全局同时执行 1 个任务。
            </span>
            <button
              className="btn btn-sm"
              onClick={() =>
                onNavigate(
                  `/project/${encodeURIComponent(running.projectId)}/pipeline?ep=${running.episodeNum}`
                )
              }
            >
              查看运行任务
            </button>
          </>
        ) : props.runningUnknown ? (
          <span>
            后台流水线任务正在执行，运行项目身份尚未取得，请等待状态同步。
          </span>
        ) : (
          <span>
            后台暂无正在运行的流水线任务。其他工作流的执行状态以任务页为准。
          </span>
        )}
      </div>
      {loading && (
        <p role="status">
          正在读取制作状态
          {rows.length ? '，下方为刷新前快照，暂不提供下一步。' : '…'}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {warning && (
        <p role="status">
          {warning}。未知不代表审核失败；请刷新或进入现有页面检查。
        </p>
      )}
      {!loading && !error && (
        <div className="production-pending">
          <p>
            有效门禁全部满足：{completed} / {rows.length} 集；待处理：
            {pending.length} 集。
          </p>
          {next?.next ? (
            <>
              <p>
                下一步：第 {next.episodeNumber} 集 · {next.next.label} ·{' '}
                {next.next.status}
              </p>
              <button
                className="btn btn-primary"
                onClick={() =>
                  next.next!.refresh
                    ? props.onRefresh()
                    : onNavigate(next.next!.path)
                }
              >
                {next.next.actionLabel ||
                  `查看第 ${next.episodeNumber} 集${next.next.label}`}
              </button>
            </>
          ) : (
            <p>
              {rows.length
                ? '当前分集门禁均已满足，可打开产物检查。'
                : '暂无集数。请在项目设置规划集数，或进入流水线补齐本集输入。'}
            </p>
          )}
        </div>
      )}
      {!error && rows.length > 0 && (
        <>
          <div className="production-toolbar">
            <label>
              <input
                type="checkbox"
                checked={pendingOnly}
                onChange={(event) => {
                  setPendingOnly(event.target.checked)
                  setPage(0)
                }}
              />{' '}
              只看待处理
            </label>
            <span>
              每页 {PAGE_SIZE} 集；共 {rows.length} 集
            </span>
          </div>
          <div
            className="production-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="分集制作矩阵，可横向滚动"
          >
            <table className="production-table">
              <caption className="sr-only">
                分集产物及审核门禁，按集数升序
              </caption>
              <thead>
                <tr>
                  <th scope="col">集数</th>
                  {PRODUCTION_STAGES.map((stage) => (
                    <th scope="col" key={stage.id}>
                      {stage.label}
                    </th>
                  ))}
                  <th scope="col">待处理</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.episodeNumber}>
                    <th scope="row">
                      第 {row.episodeNumber} 集
                      <span className="production-title">{row.title}</span>
                    </th>
                    {row.cells.map((cell) => (
                      <td key={cell.stage}>
                        {cell.applicable ? (
                          <button
                            className={`production-cell ${cell.satisfied ? 'production-cell--passed' : ''}`}
                            disabled={loading}
                            title={cell.detail}
                            aria-label={`第${row.episodeNumber}集 ${cell.label}：${cell.status}。${cell.detail}`}
                            onClick={() =>
                              cell.refresh
                                ? props.onRefresh()
                                : onNavigate(cell.path)
                            }
                          >
                            <strong>{cell.status}</strong>
                            <span>{cell.detail}</span>
                          </button>
                        ) : (
                          <span>
                            {cell.status}
                            <small>从剧本开始</small>
                          </span>
                        )}
                      </td>
                    ))}
                    <td>
                      {row.next ? (
                        <button
                          className="btn btn-sm"
                          disabled={loading}
                          onClick={() =>
                            row.next!.refresh
                              ? props.onRefresh()
                              : onNavigate(row.next!.path)
                          }
                        >
                          {row.next.actionLabel || `查看${row.next.label}`}
                        </button>
                      ) : (
                        <span>
                          已完成
                          <br />
                          有效门禁均满足
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <p>当前没有待处理集数。</p>}
          <nav className="production-pagination" aria-label="分集矩阵分页">
            <button
              className="btn btn-sm"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              上一页
            </button>
            <span aria-live="polite">
              第 {currentPage + 1} / {pages} 页，共 {filtered.length} 集
            </span>
            <button
              className="btn btn-sm"
              disabled={currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              下一页
            </button>
          </nav>
        </>
      )}
    </section>
  )
}
