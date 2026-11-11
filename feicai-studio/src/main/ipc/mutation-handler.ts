import { registerSafeIpcHandler } from '../security/safe-ipc'
import { withExecutionLease } from '../services/batch-execution-lease'

/** Authenticate the sender first, then synchronously claim the shared execution
 * lease before validation, project lookup or asynchronous mutation can begin.
 * Internal workflow/service writes deliberately do not pass through this boundary.
 */
export function registerMutationHandler(
  channel: string,
  listener: Parameters<typeof registerSafeIpcHandler>[1]
): void {
  registerSafeIpcHandler(channel, (event, ...args) =>
    withExecutionLease(channel, () => listener(event, ...args))
  )
}
