import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
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
    vi.restoreAllMocks();
    await db.delete();
    await db.open();
  });

  it('cria texto livre com estilo padrão persistível', () => {
    expect(repository.makeNode('text', 32, 48)).toMatchObject({
      kind: 'text', label: 'Texto', position: { x: 32, y: 48 },
      fontSize: 18, bold: false, textAlign: 'center', textColor: '#253a2d',
    });
  });

  it('registra tablet como último dispositivo editor e atualiza a marca após uma edição', async () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    const created = await repository.createProject('Edição no tablet');
    expect(created.project.lastEditedOn).toBe('tablet');
    const root = { ...created.diagrams[0], name: 'Atualizado no tablet' };
    await repository.saveDiagram(root);
    expect((await db.projects.get(created.project.id))?.lastEditedOn).toBe('tablet');
    vi.restoreAllMocks();
  });

  it('marca projetos criados e importados na web como editados no computador', async () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
    const created = await repository.createProject('Edição na web');
    expect(created.project.lastEditedOn).toBe('desktop');
    const imported = await repository.importProject({
      format: 'fluxos-project', schemaVersion: 1, exportedAt: time,
      project: { id: 'another-id', name: 'Importado', rootDiagramId: 'another-root', createdAt: time, updatedAt: time },
      diagrams: [{ id: 'another-root', projectId: 'another-id', name: 'Raiz', parentDiagramId: null, ownerNodeId: null, nodes: [], edges: [], createdAt: time, updatedAt: time }],
    });
    expect(imported.project.lastEditedOn).toBe('desktop');
    vi.restoreAllMocks();
  });

  it('faz backup antes de recuperar conexões inválidas envolvendo Texto livre', async () => {
    const created = await repository.createProject('Afetado');
    const diagram = created.diagrams[0];
    diagram.nodes = [
      { id: 'process', kind: 'process', label: 'Etapa', position: { x: 0, y: 0 } },
      { id: 'text', kind: 'text', label: 'Título', position: { x: 50, y: 50 } },
      { id: 'decision', kind: 'decision', label: 'Decisão', position: { x: 100, y: 0 } },
    ];
    diagram.edges = [
      { id: 'valid', source: 'process', target: 'decision', sourceHandle: 'out-right', targetHandle: 'in-left', label: 'Sim' },
      { id: 'invalid', source: 'process', target: 'text', sourceHandle: 'out-right', targetHandle: 'in-left', label: 'residual' },
    ];
    await db.diagrams.put(diagram);

    const loaded = await repository.exportProject(created.project.id);
    expect(loaded.diagrams[0].nodes.map((item) => item.id)).toEqual(['process', 'text', 'decision']);
    expect(loaded.diagrams[0].edges).toEqual([diagram.edges[0]]);
    const backups = await db.textConnectionRecoveryBackups.toArray();
    expect(backups).toHaveLength(1);
    expect(backups[0].diagram).toEqual(diagram);
    expect(backups[0].removedEdges).toEqual([diagram.edges[1]]);
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

  it('preserva Texto livre e conexões normais no ciclo de importação e exportação', async () => {
    const withText = structuredClone(sample);
    withText.diagrams[0].nodes.push({ id: 'title', kind: 'text', label: 'Título', position: { x: 80, y: 120 }, bold: true });
    withText.diagrams[0].edges.push({ id: 'flow-edge', source: 'node', target: 'node', sourceHandle: 'out-right', targetHandle: 'in-left', label: 'Sim' });
    const imported = await repository.importProject(withText);
    const exported = await repository.exportProject(imported.project.id);
    expect(exported.diagrams[0].nodes.find((item) => item.id === 'title')).toMatchObject({ kind: 'text', label: 'Título', bold: true });
    expect(exported.diagrams[0].edges).toContainEqual({ id: 'flow-edge', source: 'node', target: 'node', sourceHandle: 'out-right', targetHandle: 'in-left', label: 'Sim' });
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
