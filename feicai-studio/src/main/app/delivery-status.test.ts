import { mkdtempSync, readFileSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({
  userDataPath: '',
  windowCount: 1,
  version: '0.1.0-test',
  packaged: false
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') {
        throw new Error(`unsupported path: ${name}`)
      }
      return electronState.userDataPath
    },
    getVersion: () => electronState.version,
    isPackaged: electronState.packaged
  },
  BrowserWindow: {
    getAllWindows: () => new Array(electronState.windowCount).fill({})
  }
}))

const llmConfigsMock = vi.hoisted(() => vi.fn())
const projectsMock = vi.hoisted(() => vi.fn())
const diagnosticsMock = vi.hoisted(() => vi.fn())

vi.mock('../db/queries', () => ({
  listLLMConfigs: llmConfigsMock,
  listProjects: projectsMock
}))

vi.mock('../ipc/pipeline-handlers', () => ({
  getPipelineManager: () => ({
    getDiagnostics: diagnosticsMock
  })
}))

vi.mock('../db/database', () => ({
  getDatabaseFilePath: () => join(electronState.userDataPath, 'data', 'feicai.db')
}))

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  llmConfigsMock.mockReset()
  projectsMock.mockReset()
  diagnosticsMock.mockReset()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('delivery-status', () => {
  it('builds a blocked delivery status when llm config is missing', async () => {
    electronState.userDataPath = makeTempDir('feicai-delivery-')
    llmConfigsMock.mockReturnValue([])
    projectsMock.mockReturnValue([])
    diagnosticsMock.mockReturnValue({
      activeRun: null,
      queueSummary: { total: 0, waitingForSchedule: 0, waitingForDependency: 0, deadLetter: 0 },
      automation: { enabledScheduleCount: 0 },
      telemetry: { callCount: 0 }
    })

    const { getAppDeliveryStatus } = await import('./delivery-status')
    const status = getAppDeliveryStatus()

    expect(status.readiness.readyForDelivery).toBe(false)
    expect(status.readiness.issueCount).toBe(1)
    expect(status.paths.runtimeLog).toContain('app-runtime.log')
    expect(status.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'llm.missing', severity: 'error' })
    ]))
  })

  it('exports a delivery report json file', async () => {
    electronState.userDataPath = makeTempDir('feicai-delivery-')
    llmConfigsMock.mockReturnValue([
      { id: 'llm-1', category: 'llm', isDefault: true }
    ])
    projectsMock.mockReturnValue([
      { id: 'project-1' }
    ])
    diagnosticsMock.mockReturnValue({
      activeRun: { runId: 'run-1' },
      queueSummary: { total: 2, waitingForSchedule: 0, waitingForDependency: 0, deadLetter: 1 },
      automation: { enabledScheduleCount: 3 },
      telemetry: { callCount: 42 }
    })

    const { exportAppDeliveryReport } = await import('./delivery-status')
    const result = exportAppDeliveryReport()
    const source = readFileSync(result.filePath, 'utf-8')
    const parsed = JSON.parse(source) as { readiness: { llmConfigCount: number }; runtime: { telemetryCallCount: number } }

    expect(parsed.readiness.llmConfigCount).toBe(1)
    expect(parsed.runtime.telemetryCallCount).toBe(42)
    expect(result.filePath).toContain('delivery-status-')
  })
})
