import Dexie, { type EntityTable } from 'dexie';
import type { Diagram, Project } from './domain';

export class FluxosDatabase extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  diagrams!: EntityTable<Diagram, 'id'>;

  constructor(name = 'fluxos-local') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt',
      diagrams: 'id, projectId, parentDiagramId, [projectId+parentDiagramId]',
    });
  }
}

export const db = new FluxosDatabase();
