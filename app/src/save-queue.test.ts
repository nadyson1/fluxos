import { describe, expect, it, vi } from 'vitest';
import { enqueueSave } from './save-queue';

describe('fila de salvamento', () => {
  it('continua aceitando salvamentos depois que uma gravação falha', async () => {
    const failure = new Error('Falha temporária');
    const first = enqueueSave(Promise.resolve(), () => Promise.reject(failure));
    await expect(first).rejects.toBe(failure);

    const nextSave = vi.fn(async () => {});
    await enqueueSave(first, nextSave);

    expect(nextSave).toHaveBeenCalledOnce();
  });
});
