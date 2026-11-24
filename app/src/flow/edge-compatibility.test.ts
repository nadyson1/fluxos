import { describe, expect, it } from 'vitest';
import type { FlowEdge } from '../domain';
import { normalizeLegacyTargetToTargetEdge } from './edge-compatibility';

describe('compatibilidade de conexões salvas', () => {
  it('não inverte uma conexão moderna válida iniciada em âncoras antes de entrada', () => {
    const edge: FlowEdge = {
      id: 'legacy', source: 'processo', target: 'inicio',
      sourceHandle: 'in-left', targetHandle: 'in-bottom', label: 'Retorno', style: 'smoothstep',
    };

    expect(normalizeLegacyTargetToTargetEdge(edge)).toBe(edge);
  });

  it('preserva arestas previamente válidas e seus metadados', () => {
    const edge: FlowEdge = {
      id: 'valid', source: 'inicio', target: 'processo',
      sourceHandle: 'out-right', targetHandle: 'in-left', label: 'Sim', style: 'bezier',
    };
    expect(normalizeLegacyTargetToTargetEdge(edge)).toBe(edge);
  });
});
