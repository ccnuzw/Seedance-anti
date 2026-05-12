import type {
  ServiceBasicSuccessResult,
  ServiceFileDialogFilter
} from './service-contracts'

export async function readTextFile(filePath: string): Promise<string | null> {
  return await window.feicaiAPI.readTextFile(filePath)
}

export async function writeTextFile(
  filePath: string,
  content: string
): Promise<ServiceBasicSuccessResult> {
  return await window.feicaiAPI.writeTextFile(filePath, content)
}

export async function selectFile(
  filters?: ServiceFileDialogFilter[]
): Promise<string | null> {
  return await window.feicaiAPI.selectFile(filters)
}

export async function selectDirectory(): Promise<string | null> {
  return await window.feicaiAPI.selectDirectory()
}
