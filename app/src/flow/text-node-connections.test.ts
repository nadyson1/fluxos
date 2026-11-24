import { describe, expect, it } from 'vitest';
import { canConvertNodeToText, canCreateConnectedEdge, getConnectedNodeKinds, isTextConnection, removeTextConnectedEdges, shouldRenderHandles } from '../text-connections';
import type { Diagram, FlowNode } from '../domain';

const node = (id: string, kind: FlowNode['kind']): FlowNode => ({
  id, kind, label: id, position: { x: 0, y: 0 },
});

describe('Texto livre não participa das conexões', () => {
  it('não oferece texto livre entre os blocos conectados', () => {
    expect(getConnectedNodeKinds()).not.toContain('text');
    expect(getConnectedNodeKinds()).toEqual(['process', 'decision', 'startEnd', 'inputOutput', 'note']);
  });

  it('não renderiza âncoras para Texto livre', () => {
    expect(shouldRenderHandles('text')).toBe(false);
    expect(shouldRenderHandles('process')).toBe(true);
  });

  it('rejeita conexões e reconexões quando qualquer extremo é Texto livre', () => {
    const nodes = [node('process', 'process'), node('text', 'text'), node('decision', 'decision')];
    expect(isTextConnection(nodes, 'process', 'decision')).toBe(false);
    expect(isTextConnection(nodes, 'process', 'text')).toBe(true);
    expect(isTextConnection(nodes, 'text', 'decision')).toBe(true);
  });

  it('não cria conexão quando o novo bloco ou a origem é Texto livre', () => {
    expect(canCreateConnectedEdge('decision', 'process')).toBe(true);
    expect(canCreateConnectedEdge('text', 'process')).toBe(false);
    expect(canCreateConnectedEdge('decision', 'text')).toBe(false);
  });

  it('só permite converter um bloco em Texto livre depois de remover suas conexões', () => {
    expect(canConvertNodeToText('process', [{ source: 'process', target: 'decision' }])).toBe(false);
    expect(canConvertNodeToText('process', [{ source: 'other', target: 'decision' }])).toBe(true);
  });

  it('recupera arestas salvas envolvendo texto sem alterar nós ou arestas válidas', () => {
    const diagram: Diagram = {
      id: 'd', projectId: 'p', name: 'Raiz', parentDiagramId: null, ownerNodeId: null,
      nodes: [node('a', 'process'), node('t', 'text'), node('b', 'decision')],
      edges: [
        { id: 'valid', source: 'a', target: 'b', sourceHandle: 'out-right', targetHandle: 'in-left', label: 'Sim' },
        { id: 'to-text', source: 'a', target: 't' },
        { id: 'from-text', source: 't', target: 'b' },
      ],
      createdAt: 'now', updatedAt: 'now',
    };

    expect(removeTextConnectedEdges(diagram)).toEqual({
      diagram: { ...diagram, edges: [diagram.edges[0]] },
      removedEdges: [diagram.edges[1], diagram.edges[2]],
    });
  });
});
