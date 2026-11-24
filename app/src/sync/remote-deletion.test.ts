import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../database';
import { createProject, createSubprocess, exportProject, saveDiagram } from '../repository';
import { applyRemoteProjectTombstone, setRemoteApplyHooks } from './engine';
import type { Diagram, Project } from '../domain';

function hash(value: Project | Diagram): string {
  const clean = { ...value } as Record<string, unknown>;
  delete clean.updatedAt;
  const canonicalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]));
    }
    return item;
  };
  return JSON.stringify(canonicalize(clean));
}

describe('reconciliação de exclusão remota', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    setRemoteApplyHooks({});
  });

  afterEach(() => setRemoteApplyHooks({}));

  it('remove projeto e subprocessos limpos, grava tombstone e atualiza a interface', async () => {
    const project = await createProject('Projeto removido remotamente');
    const root: Diagram = {
      ...project.diagrams[0],
      nodes: [{ id: 'owner', kind: 'process', label: 'Etapa', position: { x: 20, y: 30 } }],
    };
    await saveDiagram(root);
    await createSubprocess(project.project.id, root.id, 'owner', 'Subprocesso');
    const envelope = await exportProject(project.project.id);
    const uid = 'user-1';
    await db.syncedEntities.bulkPut([
      { id: `${uid}:project:${project.project.id}`, uid, projectId: project.project.id, kind: 'project', entityId: project.project.id, revision: 4, contentHash: hash(envelope.project), deleted: false },
      ...envelope.diagrams.map((diagram) => ({ id: `${uid}:diagram:${diagram.id}`, uid, projectId: project.project.id, kind: 'diagram' as const, entityId: diagram.id, revision: 2, contentHash: hash(diagram), deleted: false })),
    ]);
    const beforeApply = vi.fn(async () => {});
    const afterApply = vi.fn(async () => {});
    setRemoteApplyHooks({ beforeApply, afterApply });

    await applyRemoteProjectTombstone(uid, project.project.id, 5);

    expect(beforeApply).toHaveBeenCalledWith(project.project.id);
    expect(afterApply).toHaveBeenCalledWith(project.project.id);
    expect(await db.projects.get(project.project.id)).toBeUndefined();
    expect(await db.diagrams.where('projectId').equals(project.project.id).count()).toBe(0);
    expect(await db.syncedEntities.get(`${uid}:project:${project.project.id}`)).toMatchObject({ revision: 5, deleted: true });
  });

  it('atualiza a biblioteca quando a cópia local já não existe', async () => {
    const afterApply = vi.fn(async () => {});
    setRemoteApplyHooks({ afterApply });

    await applyRemoteProjectTombstone('user-2', 'already-removed', 3);

    expect(afterApply).toHaveBeenCalledWith('already-removed');
    expect(await db.syncedEntities.get('user-2:project:already-removed')).toMatchObject({ revision: 3, deleted: true });
  });

});
