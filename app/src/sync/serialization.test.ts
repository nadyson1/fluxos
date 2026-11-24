import { describe, expect, it } from 'vitest';
import { normalizeFirestorePayload } from './serialization';

describe('normalização de payloads Firestore', () => {
  it('remove undefined de objetos, preserva valores e mantém posições de arrays', () => {
    const input = {
      id: 'diagram-1',
      omitted: undefined,
      values: { optional: undefined, nil: null, disabled: false, zero: 0, blank: '' },
      list: [1, undefined, { omitted: undefined, retained: null }, false],
    };

    const normalized = normalizeFirestorePayload(input);

    expect(normalized).toEqual({
      id: 'diagram-1',
      values: { nil: null, disabled: false, zero: 0, blank: '' },
      list: [1, null, { retained: null }, false],
    });
    expect(input.omitted).toBeUndefined();
    expect(input.values.optional).toBeUndefined();
    expect(input.list[2]).toEqual({ omitted: undefined, retained: null });
  });
});
