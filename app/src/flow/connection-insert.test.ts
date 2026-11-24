import { describe, expect, it } from 'vitest';
import { getLooseConnectionInsertTarget } from './connection-insert';

describe('inserção a partir de uma conexão solta', () => {
  it('usa o estado final da API 13 quando a conexão termina no canvas vazio', () => {
    expect(getLooseConnectionInsertTarget({
      fromNode: { id: 'source' },
      to: { x: 140, y: 220 },
      toNode: null,
      isValid: false,
    })).toEqual({ sourceId: 'source', position: { x: 140, y: 220 } });
  });

  it('ignora conexões que terminam em um nó ou uma conexão inválida ausente', () => {
    expect(getLooseConnectionInsertTarget({
      fromNode: { id: 'source' },
      to: { x: 140, y: 220 },
      toNode: { id: 'target' },
      isValid: true,
    })).toBeNull();
    expect(getLooseConnectionInsertTarget({
      fromNode: null,
      to: null,
      toNode: null,
      isValid: null,
    })).toBeNull();
  });
});
