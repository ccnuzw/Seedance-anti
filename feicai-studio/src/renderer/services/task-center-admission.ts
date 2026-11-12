/* Start admission stays main-owned. This read prevents renderer starts when the
 * global lease cannot be verified, including standalone workflow and stopping. */
export async function assertExecutionAvailable(): Promise<void> {
  let execution
  try {
    execution = await window.feicaiAPI.getExecutionStatus()
  } catch {
    throw new Error('全局任务状态未知，请刷新状态后再启动')
  }
  if (execution.busy || execution.phase !== 'idle')
    throw new Error('后台任务正在运行、暂停或停止处理中，请先处理当前任务')
}
