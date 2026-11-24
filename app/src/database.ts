import Dexie, { type EntityTable } from 'dexie';
import type { Diagram, Project } from './domain';

export type TextConnectionRecoveryBackup = {
  id: string;
  projectId: string;
  diagramId: string;
  recoveredAt: string;
  diagram: Diagram;
  removedEdges: Diagram['edges'];
};

export type SyncedEntity = {
  id: string;
  uid: string;
  projectId: string;
  kind: 'project' | 'diagram';
  entityId: string;
  revision: number;
  contentHash: string;
  deleted: boolean;
};

export type SyncConflict = {
  id: string;
  uid: string;
  projectId: string;
  projectName: string;
  detectedAt: string;
  reason: string;
  localVersion: { format: 'fluxos-project'; schemaVersion: 1; exportedAt: string; project: Project; diagrams: Diagram[] };
  cloudVersion: { format: 'fluxos-project'; schemaVersion: 1; exportedAt: string; project: Project; diagrams: Diagram[] } | null;
};

export class FluxosDatabase extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  diagrams!: EntityTable<Diagram, 'id'>;
  textConnectionRecoveryBackups!: EntityTable<TextConnectionRecoveryBackup, 'id'>;
  syncedEntities!: EntityTable<SyncedEntity, 'id'>;
  syncConflicts!: EntityTable<SyncConflict, 'id'>;

  constructor(name = 'fluxos-local') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt',
      diagrams: 'id, projectId, parentDiagramId, [projectId+parentDiagramId]',
    });
    this.version(2).stores({
      projects: 'id, updatedAt',
      diagrams: 'id, projectId, parentDiagramId, [projectId+parentDiagramId]',
      textConnectionRecoveryBackups: 'id, projectId, diagramId, recoveredAt',
    });
    this.version(3).stores({
      projects: 'id, updatedAt',
      diagrams: 'id, projectId, parentDiagramId, [projectId+parentDiagramId]',
      textConnectionRecoveryBackups: 'id, projectId, diagramId, recoveredAt',
      syncedEntities: 'id, uid, projectId, kind, entityId, [uid+projectId]',
      syncConflicts: 'id, uid, projectId, detectedAt',
    });
  }
}

export const db = new FluxosDatabase();
