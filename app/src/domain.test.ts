import { describe, expect, it } from 'vitest';
import * as domain from './domain';
import type { ExportEnvelope } from './domain';

const time = '2026-11-22T00:00:00.000Z';
const sample: ExportEnvelope = {
  format: 'fluxos-project',
  schemaVersion: 1,
  exportedAt: time,
  project: { id: 'p1', name: 'Fluxo', rootDiagramId: 'd1', createdAt: time, updatedAt: time },
  diagrams: [
    { id: 'd1', projectId: 'p1', name: 'Raiz', parentDiagramId: null, ownerNodeId: null, nodes: [{ id: 'n1', kind: 'process', label: 'Qualificação de leads', position: { x: 20, y: 30 }, linkedDiagramId: 'd2' }], edges: [], createdAt: time, updatedAt: time },
    { id: 'd2', projectId: 'p1', name: 'Negociação', parentDiagramId: 'd1', ownerNodeId: 'n1', nodes: [{ id: 'n2', kind: 'decision', label: 'Lead qualificado?', position: { x: 120, y: 30 } }], edges: [], createdAt: time, updatedAt: time },
  ],
};

describe('integridade do projeto', () => {
  it('aceita e devolve uma exportação válida com diagrama filho', () => {
    const result = domain.validateExportEnvelope(sample);
    expect(result.project.rootDiagramId).toBe('d1');
    expect(result.diagrams).toHaveLength(2);
  });

  it('preserva estilo serializável de texto livre sem alterar o formato antigo', () => {
    const withText = structuredClone(sample);
    withText.diagrams[0].nodes.push({
      id: 'free-text', kind: 'text', label: 'Título da operação', position: { x: 60, y: 100 },
      fontSize: 24, bold: true, textAlign: 'left', textColor: '#3f7656',
    });
    expect(domain.validateExportEnvelope(withText).diagrams[0].nodes.at(-1)).toMatchObject({
      kind: 'text', fontSize: 24, bold: true, textAlign: 'left', textColor: '#3f7656',
    });
    expect(domain.validateExportEnvelope(sample).diagrams[0].nodes[0].kind).toBe('process');
  });

  it('rejeita estilos de texto inválidos no JSON importado', () => {
    const invalid = structuredClone(sample);
    invalid.diagrams[0].nodes[0] = { ...invalid.diagrams[0].nodes[0], fontSize: 200 };
    expect(() => domain.validateExportEnvelope(invalid)).toThrow(/fonte/i);
  });

  it('rejeita referência de aresta a nó inexistente', () => {
    const invalid = structuredClone(sample);
    invalid.diagrams[0].edges.push({ id: 'e1', source: 'n1', target: 'missing' });
    expect(() => domain.validateExportEnvelope(invalid)).toThrow(/aresta.*n[oó]/i);
  });

  it('rejeita ciclos na hierarquia de subprocessos', () => {
    const invalid = structuredClone(sample);
    invalid.diagrams[0].parentDiagramId = 'd2';
    expect(() => domain.validateExportEnvelope(invalid)).toThrow(/ciclo/i);
  });

  it('localiza texto de bloco sem diferenciar maiúsculas ou acentos e mostra o caminho', () => {
    const results = domain.searchExport([sample], 'qualificacao');
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'node', title: 'Qualificação de leads', path: 'Fluxo > Raiz' }),
    ]));
  });

  it('duplica o projeto com novos IDs e remapeia o vínculo do subprocesso', () => {
    let next = 0;
    const copy = domain.duplicateExport(sample, () => `new-${++next}`);
    expect(copy.project.id).not.toBe(sample.project.id);
    expect(copy.diagrams[0].nodes[0].linkedDiagramId).toBe(copy.diagrams[1].id);
    expect(copy.diagrams[1].ownerNodeId).toBe(copy.diagrams[0].nodes[0].id);
    expect(new Set([copy.project.id, ...copy.diagrams.flatMap((diagram) => [diagram.id, ...diagram.nodes.map((node) => node.id)])]).size).toBe(5);
  });

  it('ao excluir o nó proprietário mantém o subprocesso na árvore e remove as arestas do nó', () => {
    const result = domain.removeNodePreservingSubprocess(sample.diagrams, 'd1', 'n1');
    expect(result[0].nodes).toHaveLength(0);
    expect(result[0].edges).toHaveLength(0);
    expect(result[1]).toMatchObject({ id: 'd2', parentDiagramId: 'd1', ownerNodeId: null });
  });
});
