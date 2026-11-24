import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './database';
import * as repository from './repository';
import type { ExportEnvelope } from './domain';

const time = '2026-11-22T00:00:00.000Z';
const sample: ExportEnvelope = {
  format: 'fluxos-project', schemaVersion: 1, exportedAt: time,
  project: { id: 'import-me', name: 'Exemplo', rootDiagramId: 'root', createdAt: time, updatedAt: time },
  diagrams: [{
    id: 'root', projectId: 'import-me', name: 'Principal', parentDiagramId: null, ownerNodeId: null,
    nodes: [{ id: 'node', kind: 'process', label: 'Etapa', position: { x: 20, y: 30 }, linkedDiagramId: 'child' }],
    edges: [], createdAt: time, updatedAt: time,
  }, {
    id: 'child', projectId: 'import-me', name: 'Detalhe', parentDiagramId: 'root', ownerNodeId: 'node',
    nodes: [], edges: [], createdAt: time, updatedAt: time,
  }],
};

describe('repositório local', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('cria texto livre com estilo padrão persistível', () => {
    expect(repository.makeNode('text', 32, 48)).toMatchObject({
      kind: 'text', label: 'Texto', position: { x: 32, y: 48 },
      fontSize: 18, bold: false, textAlign: 'center', textColor: '#253a2d',
    });
  });

  it('rejeita um arquivo inválido sem gravar parte do projeto', async () => {
    const invalid = structuredClone(sample);
    invalid.diagrams[0].edges.push({ id: 'broken', source: 'node', target: 'missing' });
    await expect(repository.importProject(invalid)).rejects.toThrow();
    expect(await db.projects.count()).toBe(0);
    expect(await db.diagrams.count()).toBe(0);
  });

  it('importa novamente um projeto em conflito com IDs remapeados e hierarquia intacta', async () => {
    await repository.importProject(sample);
    const second = await repository.importProject(sample);
    const stored = await repository.exportProject(second.project.id);
    expect(await db.projects.count()).toBe(2);
    expect(second.project.id).not.toBe(sample.project.id);
    expect(stored.diagrams[0].nodes[0].linkedDiagramId).toBe(stored.diagrams[1].id);
    expect(stored.diagrams[1].ownerNodeId).toBe(stored.diagrams[0].nodes[0].id);
  });

  it('cria um subprocesso e atualiza o vínculo do bloco na mesma operação', async () => {
    const created = await repository.createProject('Novo fluxo');
    const root = created.diagrams[0];
    root.nodes = [{ id: 'owner', kind: 'process', label: 'Etapa', position: { x: 0, y: 0 } }];
    await repository.saveDiagram(root);
    const child = await repository.createSubprocess(created.project.id, root.id, 'owner', 'Detalhe');
    const saved = await repository.exportProject(created.project.id);
    expect(saved.diagrams.find((diagram) => diagram.id === root.id)?.nodes[0].linkedDiagramId).toBe(child.id);
    expect(child.ownerNodeId).toBe('owner');
  });
});
