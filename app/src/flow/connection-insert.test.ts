import { describe, expect, it } from 'vitest';
import { getConnectionHandlesForNewNode, getLooseConnectionInsertTarget } from './connection-insert';

describe('inserção a partir de uma conexão solta', () => {
  it('usa o estado final da API 13 quando a conexão termina no canvas vazio', () => {
    expect(getLooseConnectionInsertTarget({
      fromNode: { id: 'source' },
      fromHandle: { id: 'out-right' },
      to: { x: 140, y: 220 },
      toNode: null,
      isValid: false,
    })).toEqual({ sourceId: 'source', sourceHandle: 'out-right', position: { x: 140, y: 220 } });
  });

  it('ignora conexões que terminam em um nó ou uma conexão inválida ausente', () => {
    expect(getLooseConnectionInsertTarget({
      fromNode: { id: 'source' },
      fromHandle: { id: 'out-right' },
      to: { x: 140, y: 220 },
      toNode: { id: 'target' },
      isValid: true,
    })).toBeNull();
    expect(getLooseConnectionInsertTarget({
      fromNode: null,
      fromHandle: null,
      to: null,
      toNode: null,
      isValid: null,
    })).toBeNull();
  });
});

describe('âncora de destino de um bloco inserido', () => {
  it.each([
    ['esquerda', 'in-left', { x: 0, y: 0 }, { x: 300, y: 0 }, 'in-left'],
    ['direita', 'out-right', { x: 300, y: 0 }, { x: 0, y: 0 }, 'out-right'],
    ['superior', 'out-top', { x: 0, y: 0 }, { x: 0, y: 300 }, 'out-top'],
    ['inferior', 'in-bottom', { x: 0, y: 300 }, { x: 0, y: 0 }, 'in-bottom'],
  ] as const)('conserva a saída pela âncora %s e conecta no lado voltado à origem', (_side, sourceHandle, source, target, expectedTargetHandle) => {
    expect(getConnectionHandlesForNewNode(sourceHandle, source, target)).toEqual({
      sourceHandle, targetHandle: expectedTargetHandle,
    });
  });
});
