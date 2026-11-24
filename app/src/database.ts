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

export class FluxosDatabase extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  diagrams!: EntityTable<Diagram, 'id'>;
  textConnectionRecoveryBackups!: EntityTable<TextConnectionRecoveryBackup, 'id'>;

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
  }
}

export const db = new FluxosDatabase();
