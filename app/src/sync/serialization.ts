function normalizeValue(value: unknown, inArray = false): unknown {
  if (value === undefined) return inArray ? null : undefined;
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, true));
  if (value === null || typeof value !== 'object') return value;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  const normalized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    normalized[key] = normalizeValue(item);
  }
  return normalized;
}

/** Clone Firestore payloads without undefined object fields or array entries. */
export function normalizeFirestorePayload<T>(value: T): T {
  return normalizeValue(value) as T;
}
