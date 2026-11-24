import { db, type TextConnectionRecoveryBackup } from './database';
import { Capacitor } from '@capacitor/core';
import {
  duplicateExport,
  removeNodePreservingSubprocess,
  searchExport,
  validateExportEnvelope,
  type Diagram,
  type ExportEnvelope,
  type FlowNode,
  type Project,
  type SearchResult,
} from './domain';
import { removeTextConnectedEdges } from './text-connections';

const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function editedProject(project: Project, timestamp = now()): Project {
  const platform = Capacitor.getPlatform();
  const device = platform === 'android' ? 'tablet' : platform === 'web' ? 'desktop' : undefined;
  return { ...project, updatedAt: timestamp, ...(device ? { lastEditedOn: device } : {}) };
}

function orderedDiagrams(diagrams: Diagram[], rootId: string): Diagram[] {
  const children = new Map<string, Diagram[]>();
  for (const diagram of diagrams) {
    if (!diagram.parentDiagramId) continue;
    const siblings = children.get(diagram.parentDiagramId) ?? [];
    siblings.push(diagram);
    children.set(diagram.parentDiagramId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const ordered: Diagram[] = [];
  const visit = (id: string) => {
    const current = diagrams.find((diagram) => diagram.id === id);
    if (!current) return;
    ordered.push(current);
    for (const child of children.get(id) ?? []) visit(child.id);
  };
  visit(rootId);
  return ordered;
}

export async function listProjects(): Promise<Project[]> {
  await recoverTextConnections();
  return (await db.projects.toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function recoverTextConnections(projectId?: string): Promise<void> {
  const diagrams = projectId
    ? await db.diagrams.where('projectId').equals(projectId).toArray()
    : await db.diagrams.toArray();
  const affected = diagrams.map((originalDiagram) => ({ originalDiagram, ...removeTextConnectedEdges(originalDiagram) }))
    .filter(({ removedEdges }) => removedEdges.length > 0);
  if (!affected.length) return;

  await db.transaction('rw', db.diagrams, db.textConnectionRecoveryBackups, async () => {
    for (const item of affected) {
      const current = await db.diagrams.get(item.originalDiagram.id);
      if (!current) continue;
      const recovery = removeTextConnectedEdges(current);
      if (!recovery.removedEdges.length) continue;
      const backup: TextConnectionRecoveryBackup = {
        id: newId(), projectId: current.projectId, diagramId: current.id,
        recoveredAt: now(), diagram: structuredClone(current), removedEdges: structuredClone(recovery.removedEdges),
      };
      await db.textConnectionRecoveryBackups.add(backup);
      await db.diagrams.put({ ...recovery.diagram, updatedAt: now() });
    }
  });
}

export async function exportProject(projectId: string): Promise<ExportEnvelope> {
  await recoverTextConnections(projectId);
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('Projeto não encontrado.');
  const diagrams = orderedDiagrams(await db.diagrams.where('projectId').equals(projectId).toArray(), project.rootDiagramId);
  return validateExportEnvelope({ format: 'fluxos-project', schemaVersion: 1, exportedAt: now(), project, diagrams });
}

export async function createProject(name: string): Promise<ExportEnvelope> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('Digite um nome para o projeto.');
  const timestamp = now();
  const project: Project = editedProject({ id: newId(), name: cleanName, rootDiagramId: newId(), createdAt: timestamp, updatedAt: timestamp }, timestamp);
  const root: Diagram = {
    id: project.rootDiagramId,
    projectId: project.id,
    name: cleanName,
    parentDiagramId: null,
    ownerNodeId: null,
    nodes: [],
    edges: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.transaction('rw', db.projects, db.diagrams, async () => {
    await db.projects.add(project);
    await db.diagrams.add(root);
  });
  return { format: 'fluxos-project', schemaVersion: 1, exportedAt: timestamp, project, diagrams: [root] };
}

export async function saveDiagram(changes: Diagram): Promise<void> {
  const current = await exportProject(changes.projectId);
  const candidate = validateExportEnvelope({
    ...current,
    project: editedProject(current.project),
    diagrams: current.diagrams.map((diagram) => diagram.id === changes.id ? { ...changes, updatedAt: now() } : diagram),
  });
  if (!current.diagrams.some((diagram) => diagram.id === changes.id)) throw new Error('Fluxograma não encontrado.');
  await db.transaction('rw', db.projects, db.diagrams, async () => {
    const timestamp = now();
    await db.diagrams.put({ ...candidate.diagrams.find((diagram) => diagram.id === changes.id)!, updatedAt: timestamp });
    await db.projects.put({ ...candidate.project, updatedAt: timestamp });
  });
}

export async function createSubprocess(projectId: string, parentDiagramId: string, ownerNodeId: string | null, name: string): Promise<Diagram> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('Digite um nome para o subprocesso.');
  const timestamp = now();
  const child: Diagram = {
    id: newId(), projectId, name: cleanName, parentDiagramId, ownerNodeId,
    nodes: [], edges: [], createdAt: timestamp, updatedAt: timestamp,
  };
  await db.transaction('rw', db.projects, db.diagrams, async () => {
    const envelope = await exportProject(projectId);
    const parent = envelope.diagrams.find((diagram) => diagram.id === parentDiagramId);
    if (!parent) throw new Error('Fluxograma pai não encontrado.');
    if (ownerNodeId) {
      const owner = parent.nodes.find((node) => node.id === ownerNodeId);
      if (!owner) throw new Error('Bloco proprietário não encontrado.');
      if (owner.linkedDiagramId) throw new Error('Este bloco já tem um subprocesso.');
      parent.nodes = parent.nodes.map((node) => node.id === ownerNodeId ? { ...node, linkedDiagramId: child.id } : node);
    }
    const candidate = validateExportEnvelope({
      ...envelope,
      project: editedProject(envelope.project, timestamp),
      diagrams: [...envelope.diagrams.map((diagram) => diagram.id === parent.id ? { ...parent, updatedAt: timestamp } : diagram), child],
    });
    await db.diagrams.put(candidate.diagrams.find((diagram) => diagram.id === parent.id)!);
    await db.diagrams.add(child);
    await db.projects.put(candidate.project);
  });
  return child;
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('O nome do projeto não pode ficar vazio.');
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('Projeto não encontrado.');
  Object.assign(project, editedProject({ ...project, name: cleanName }));
  await db.projects.put(project);
}

export async function renameDiagram(projectId: string, diagramId: string, name: string): Promise<void> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('O nome do fluxograma não pode ficar vazio.');
  const diagram = await db.diagrams.get(diagramId);
  if (!diagram || diagram.projectId !== projectId) throw new Error('Fluxograma não encontrado.');
  const timestamp = now();
  diagram.name = cleanName;
  diagram.updatedAt = timestamp;
  await db.transaction('rw', db.projects, db.diagrams, async () => {
    await db.diagrams.put(diagram);
    const project = await db.projects.get(projectId);
    if (project) await db.projects.put(editedProject(project, timestamp));
  });
}

export async function importProject(input: unknown): Promise<ExportEnvelope> {
  const validated = validateExportEnvelope(input);
  return db.transaction('rw', db.projects, db.diagrams, async () => {
    let envelope = validated;
    const projectConflict = await db.projects.get(validated.project.id);
    const diagramConflicts = await db.diagrams.bulkGet(validated.diagrams.map((diagram) => diagram.id));
    if (projectConflict || diagramConflicts.some(Boolean)) envelope = duplicateExport(validated);
    envelope = validateExportEnvelope(envelope);
    envelope.project = editedProject(envelope.project);
    await db.projects.add(envelope.project);
    await db.diagrams.bulkAdd(envelope.diagrams);
    return envelope;
  });
}

export async function duplicateProject(projectId: string): Promise<ExportEnvelope> {
  return importProject(duplicateExport(await exportProject(projectId)));
}

export async function deleteProject(projectId: string): Promise<void> {
  await db.transaction('rw', db.projects, db.diagrams, async () => {
    await db.projects.delete(projectId);
    await db.diagrams.where('projectId').equals(projectId).delete();
  });
}

export async function deleteDiagramSubtree(projectId: string, diagramId: string): Promise<string[]> {
  const envelope = await exportProject(projectId);
  if (diagramId === envelope.project.rootDiagramId) throw new Error('O fluxograma principal não pode ser excluído separadamente.');
  const byId = new Map(envelope.diagrams.map((diagram) => [diagram.id, diagram]));
  if (!byId.has(diagramId)) throw new Error('Fluxograma não encontrado.');
  const removed = new Set<string>([diagramId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const diagram of envelope.diagrams) {
      if (diagram.parentDiagramId && removed.has(diagram.parentDiagramId) && !removed.has(diagram.id)) {
        removed.add(diagram.id);
        changed = true;
      }
    }
  }
  const target = byId.get(diagramId)!;
  if (target.parentDiagramId && target.ownerNodeId) {
    const parent = byId.get(target.parentDiagramId)!;
    parent.nodes = parent.nodes.map((node) => node.id === target.ownerNodeId ? { ...node, linkedDiagramId: undefined } : node);
  }
  const kept = envelope.diagrams.filter((diagram) => !removed.has(diagram.id));
  validateExportEnvelope({ ...envelope, diagrams: kept });
  await db.transaction('rw', db.projects, db.diagrams, async () => {
    if (target.parentDiagramId) await db.diagrams.put(byId.get(target.parentDiagramId)!);
    await db.diagrams.bulkDelete([...removed]);
    const project = await db.projects.get(projectId);
    if (project) await db.projects.put(editedProject(project));
  });
  return [...removed];
}

export async function deleteNodePreservingSubprocess(projectId: string, diagramId: string, nodeId: string): Promise<void> {
  const envelope = await exportProject(projectId);
  const diagrams = removeNodePreservingSubprocess(envelope.diagrams, diagramId, nodeId);
  const timestamp = now();
  const candidate = validateExportEnvelope({ ...envelope, project: editedProject(envelope.project, timestamp), diagrams });
  await db.transaction('rw', db.projects, db.diagrams, async () => {
    await db.diagrams.bulkPut(candidate.diagrams.map((diagram) => ({ ...diagram, updatedAt: timestamp })));
    await db.projects.put(candidate.project);
  });
}

export async function searchProjects(query: string): Promise<SearchResult[]> {
  const projects = await listProjects();
  const envelopes = await Promise.all(projects.map((project) => exportProject(project.id)));
  return searchExport(envelopes, query).slice(0, 100);
}

export function makeNode(kind: FlowNode['kind'], x: number, y: number, label?: string): FlowNode {
  const defaults: Record<FlowNode['kind'], string> = {
    startEnd: 'Início / Fim', process: 'Novo processo', decision: 'Nova decisão', inputOutput: 'Entrada / Saída', note: 'Anotação', text: 'Texto',
  };
  return {
    id: newId(), kind, label: label ?? defaults[kind], position: { x, y },
    ...(kind === 'text' ? { fontSize: 18, bold: false, textAlign: 'center' as const, textColor: '#253a2d' } : {}),
  };
}
