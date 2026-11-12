export interface ContractIssue {
  path: string // JSON-style location, e.g. $.bindings[0].assetRevisionId
  code:
    | 'schema'
    | 'unknown_schema'
    | 'duplicate'
    | 'reference'
    | 'project'
    | 'version'
    | 'purpose'
    | 'history'
    | 'path'
  message: string
}
export type DecodeResult<T> =
  { ok: true; value: T } | { ok: false; issues: ContractIssue[] }
export interface Schema<T> {
  read(value: unknown, path: string, issues: ContractIssue[]): T | undefined
}
export function problem(
  issues: ContractIssue[],
  path: string,
  code: ContractIssue['code'],
  message: string
): void {
  issues.push({ path, code, message })
}
export function scalar<T>(
  check: (value: unknown) => value is T,
  description: string
): Schema<T> {
  return {
    read(value, path, issues) {
      if (check(value)) return value
      problem(issues, path, 'schema', description)
      return undefined
    }
  }
}
export const text = scalar(
  (v): v is string => typeof v === 'string' && v.trim().length > 0,
  'Expected non-empty string'
)
export const body = scalar(
  (v): v is string => typeof v === 'string',
  'Expected string'
)
export const id = scalar(
  (v): v is string =>
    typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v),
  'Expected opaque identifier (1–200 ASCII characters)'
)
export const hash = scalar(
  (v): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v),
  'Expected lowercase SHA-256 hash'
)
export const positive = scalar(
  (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
  'Expected positive finite number'
)
export const nonnegative = scalar(
  (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0,
  'Expected nonnegative finite number'
)
export const integer = scalar(
  (v): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0,
  'Expected positive safe integer'
)
export const order = scalar(
  (v): v is number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0,
  'Expected nonnegative safe integer'
)
export const boolean = scalar(
  (v): v is boolean => typeof v === 'boolean',
  'Expected boolean'
)
export const timestamp = scalar(
  (v): v is string =>
    typeof v === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString() === v,
  'Expected canonical UTC ISO timestamp'
)
export function enumeration<const T extends readonly (string | number)[]>(
  ...values: T
): Schema<T[number]> {
  return scalar(
    (v): v is T[number] => values.some((item) => item === v),
    `Expected one of: ${values.join(', ')}`
  )
}
export function nullable<T>(schema: Schema<T>): Schema<T | null> {
  return {
    read: (value, path, issues) =>
      value === null ? null : schema.read(value, path, issues)
  }
}
export function array<T>(schema: Schema<T>): Schema<T[]> {
  return {
    read(value, path, issues) {
      if (!Array.isArray(value)) {
        problem(issues, path, 'schema', 'Expected array')
        return undefined
      }
      const result: T[] = []
      for (let i = 0; i < value.length; i++) {
        const decoded = schema.read(value[i], `${path}[${i}]`, issues)
        if (decoded !== undefined) result.push(decoded)
      }
      return result
    }
  }
}
export function object<T extends object>(shape: {
  [K in keyof T]-?: Schema<T[K]>
}): Schema<T> {
  return {
    read(value, path, issues) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        problem(issues, path, 'schema', 'Expected object')
        return undefined
      }
      const input = value as Record<string, unknown>
      const result: Record<string, unknown> = {}
      for (const key of Object.keys(input)) {
        if (!Object.prototype.hasOwnProperty.call(shape, key))
          problem(issues, `${path}.${key}`, 'schema', 'Unknown field')
      }
      for (const [key, schema] of Object.entries(shape) as [
        string,
        Schema<unknown>
      ][]) {
        result[key] = schema.read(
          Object.prototype.hasOwnProperty.call(input, key)
            ? input[key]
            : undefined,
          `${path}.${key}`,
          issues
        )
      }
      // Every property has been decoded using the corresponding typed schema. Failed results never escape decode().
      return result as T
    }
  }
}
export function tagged<T>(
  tag: string,
  choices: Record<string, Schema<T>>
): Schema<T> {
  return {
    read(value, path, issues) {
      const discriminator =
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[tag]
          : undefined
      if (
        typeof discriminator !== 'string' ||
        !Object.prototype.hasOwnProperty.call(choices, discriminator)
      ) {
        problem(issues, `${path}.${tag}`, 'schema', 'Unknown discriminator')
        return undefined
      }
      return choices[discriminator].read(value, path, issues)
    }
  }
}
export function decode<T>(schema: Schema<T>, input: unknown): DecodeResult<T> {
  const issues: ContractIssue[] = []
  const value = schema.read(input, '$', issues)
  return value !== undefined && issues.length === 0
    ? { ok: true, value }
    : { ok: false, issues }
}
