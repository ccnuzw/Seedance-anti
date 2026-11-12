/** Small strict decoders shared by the observation and controlled-evaluation contracts. */
export type Check = (value: unknown) => void
export function invalid(): never {
  // Never echo payloads, arbitrary keys, supplier messages or credentials.
  throw new Error('Invalid observation/evaluation contract')
}
export function object(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    invalid()
  return value as Record<string, unknown>
}
export const shape =
  (fields: Record<string, Check>): Check =>
  (value) => {
    const obj = object(value)
    if (Object.keys(obj).some((key) => !Object.hasOwn(fields, key))) invalid()
    for (const [key, check] of Object.entries(fields)) check(obj[key])
  }
export const oneOf =
  (values: readonly unknown[]): Check =>
  (value) => {
    if (!values.includes(value)) invalid()
  }
export const nullable =
  (check: Check): Check =>
  (value) => {
    if (value !== null) check(value)
  }
export const array =
  (check: Check): Check =>
  (value) => {
    if (!Array.isArray(value)) invalid()
    ;(value as unknown[]).forEach(check)
  }
/** Application-owned opaque references only; no URLs, prose or free-form errors. */
export const id: Check = (value) => {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$/.test(value) ||
    value.includes('://')
  )
    invalid()
}
export const instant: Check = (value) => {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    invalid()
}
export const reference = shape({ objectId: id, version: id })
export function decode<T>(value: unknown, check: Check): T {
  check(value)
  return structuredClone(value) as T
}
