import {
  collection, doc, getDocs, onSnapshot, runTransaction, serverTimestamp,
  type DocumentReference, type DocumentSnapshot,
} from 'firebase/firestore';
import { duplicateExport, validateExportEnvelope, type Diagram, type ExportEnvelope, type Project } from '../domain';
import { db, type SyncedEntity, type SyncConflict } from '../database';
import { firestore } from './firebase';
import { normalizeFirestorePayload } from './serialization';

type EntityKind = SyncedEntity['kind'];
type CloudEntity = { revision: number; deleted: boolean; payload: Project | Diagram | null; committedAt?: unknown };
export type CloudSyncState = {
  status: 'local' | 'pending' | 'syncing' | 'synced' | 'error';
  uid: string | null;
  email: string | null;
  message: string;
  conflicts: SyncConflict[];
  projects: Record<string, { status: 'local' | 'pending' | 'syncing' | 'synced' | 'error' | 'conflict'; message: string }>;
};

const listeners = new Set<(state: CloudSyncState) => void>();
let state: CloudSyncState = { status: 'local', uid: null, email: null, message: 'Salvo localmente', conflicts: [], projects: {} };
let activeUid: string | null = null;
let unsubscribeCloud: (() => void) | undefined;
let unsubscribeDiagramSnapshots = new Map<string, () => void>();
let beforeRemoteApply: ((projectId: string) => Promise<void>) | undefined;
let afterRemoteApply: ((projectId: string) => Promise<void> | void) | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let syncTail: Promise<void> = Promise.resolve();

const markerId = (uid: string, kind: EntityKind, entityId: string) => `${uid}:${kind}:${entityId}`;
const projectRef = (uid: string, projectId: string) => doc(firestore, 'users', uid, 'projects', projectId);
const diagramRef = (uid: string, projectId: string, diagramId: string) => doc(firestore, 'users', uid, 'projects', projectId, 'diagrams', diagramId);
const versionRef = (ref: DocumentReference, revision: number) => doc(collection(ref, 'versions'), String(revision));
const conflictRef = (uid: string, projectId: string, id: string) => doc(firestore, 'users', uid, 'projects', projectId, 'conflicts', id);

function emit(next: Partial<CloudSyncState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

function setProjectSyncStatus(projectId: string, status: CloudSyncState['projects'][string]['status'], message: string) {
  emit({ projects: { ...state.projects, [projectId]: { status, message } } });
}

async function refreshProjectSyncStatuses(uid = activeUid): Promise<void> {
  const records: CloudSyncState['projects'] = {};
  const projects = await db.projects.toArray();
  const conflicts = uid ? await db.syncConflicts.where('uid').equals(uid).toArray() : [];
  const conflictIds = new Set(conflicts.map((item) => item.projectId));
  for (const project of projects) {
    const prior = state.projects[project.id];
    if (conflictIds.has(project.id)) {
      records[project.id] = { status: 'conflict', message: 'Há versões preservadas que precisam ser revisadas.' };
      continue;
    }
    if (!uid || !navigator.onLine) {
      records[project.id] = { status: 'local', message: 'Salvo neste dispositivo.' };
      continue;
    }
    const envelope = await getLocalEnvelope(project.id);
    const clean = envelope ? await isLocalProjectClean(uid, envelope) : false;
    if (prior?.status === 'error') records[project.id] = prior;
    else if (prior?.status === 'syncing') records[project.id] = prior;
    else records[project.id] = clean
      ? { status: 'synced', message: 'Sincronizado com a nuvem.' }
      : { status: 'pending', message: 'Alterações aguardando sincronização.' };
  }
  emit({ projects: records });
}

function emitSettledGlobalStatus(uid: string) {
  if (activeUid !== uid) return;
  const values = Object.values(state.projects);
  const conflict = values.some((item) => item.status === 'conflict');
  const error = values.some((item) => item.status === 'error');
  const pending = values.some((item) => item.status === 'pending');
  if (!navigator.onLine) emit({ status: 'local', message: 'Salvo localmente · aguardando conexão' });
  else if (conflict) emit({ status: 'error', message: 'Sincronização pausada para preservar versões em conflito.' });
  else if (error) emit({ status: 'error', message: 'Alguns projetos não puderam ser sincronizados.' });
  else if (pending) emit({ status: 'pending', message: 'Há alterações aguardando sincronização.' });
  else emit({ status: 'synced', message: 'Sincronizado' });
}

export function getCloudSyncState(): CloudSyncState { return state; }

export async function refreshProjectSyncState(): Promise<void> {
  await refreshProjectSyncStatuses();
  if (activeUid && state.status !== 'syncing') emitSettledGlobalStatus(activeUid);
}

export function subscribeCloudSync(listener: (state: CloudSyncState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function setRemoteApplyHooks(hooks: {
  beforeApply?: (projectId: string) => Promise<void>;
  afterApply?: (projectId: string) => Promise<void> | void;
}): void {
  beforeRemoteApply = hooks.beforeApply;
  afterRemoteApply = hooks.afterApply;
}

function contentHash(value: Project | Diagram): string {
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
  // Firestore map fields may arrive in a different insertion order than the
  // IndexedDB object. Canonical JSON prevents false conflicts on equal data.
  return JSON.stringify(canonicalize(clean));
}

function readEntity(snapshot: DocumentSnapshot): CloudEntity | null {
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (!Number.isSafeInteger(data.revision) || data.revision < 1 || typeof data.deleted !== 'boolean') return null;
  if (!data.deleted && (!data.payload || typeof data.payload !== 'object')) return null;
  return { revision: data.revision, deleted: data.deleted, payload: data.payload ?? null, committedAt: data.committedAt } as CloudEntity;
}

async function getLocalEnvelope(projectId: string): Promise<ExportEnvelope | null> {
  const project = await db.projects.get(projectId);
  if (!project) return null;
  const diagrams = await db.diagrams.where('projectId').equals(projectId).toArray();
  try {
    return validateExportEnvelope({ format: 'fluxos-project', schemaVersion: 1, exportedAt: new Date().toISOString(), project, diagrams });
  } catch {
    return null;
  }
}

async function listRemote(uid: string): Promise<Map<string, { project: CloudEntity; diagrams: Map<string, CloudEntity>; envelope: ExportEnvelope | null }>> {
  const output = new Map<string, { project: CloudEntity; diagrams: Map<string, CloudEntity>; envelope: ExportEnvelope | null }>();
  const projects = await getDocs(collection(firestore, 'users', uid, 'projects'));
  for (const projectSnapshot of projects.docs) {
    const project = readEntity(projectSnapshot);
    if (!project) continue;
    const diagrams = new Map<string, CloudEntity>();
    const children = await getDocs(collection(projectSnapshot.ref, 'diagrams'));
    for (const child of children.docs) {
      const entity = readEntity(child);
      if (entity) diagrams.set(child.id, entity);
    }
    let envelope: ExportEnvelope | null = null;
    if (!project.deleted && project.payload) {
      try {
        const payloadDiagrams = [...diagrams.entries()]
          .filter(([, item]) => !item.deleted && item.payload)
          .map(([, item]) => item.payload as Diagram);
        envelope = validateExportEnvelope({
          format: 'fluxos-project', schemaVersion: 1, exportedAt: new Date().toISOString(),
          project: project.payload, diagrams: payloadDiagrams,
        });
      } catch {
        // A transaction may have committed only part of a multi-document snapshot. The next listener event retries it.
      }
    }
    output.set(projectSnapshot.id, { project, diagrams, envelope });
  }
  return output;
}

async function getMarker(uid: string, kind: EntityKind, entityId: string) {
  return db.syncedEntities.get(markerId(uid, kind, entityId));
}

async function putMarker(uid: string, projectId: string, kind: EntityKind, entityId: string, revision: number, hash: string, deleted = false) {
  const record: SyncedEntity = { id: markerId(uid, kind, entityId), uid, projectId, kind, entityId, revision, contentHash: hash, deleted };
  await db.syncedEntities.put(record);
}

async function isLocalProjectClean(uid: string, local: ExportEnvelope): Promise<boolean> {
  const projectMarker = await getMarker(uid, 'project', local.project.id);
  if (!projectMarker || projectMarker.deleted || contentHash(local.project) !== projectMarker.contentHash) return false;
  const localIds = new Set(local.diagrams.map((item) => item.id));
  const markers = await db.syncedEntities.where('[uid+projectId]').equals([uid, local.project.id]).toArray();
  if (markers.some((item) => item.kind === 'diagram' && !localIds.has(item.entityId) && !item.deleted)) return false;
  for (const diagram of local.diagrams) {
    const marker = await getMarker(uid, 'diagram', diagram.id);
    if (!marker || marker.deleted || contentHash(diagram) !== marker.contentHash) return false;
  }
  return true;
}

async function saveLocalEnvelope(envelope: ExportEnvelope): Promise<void> {
  const valid = validateExportEnvelope(envelope);
  await db.transaction('rw', db.projects, db.diagrams, async () => {
    await db.projects.put(valid.project);
    const existing = await db.diagrams.where('projectId').equals(valid.project.id).toArray();
    const wanted = new Set(valid.diagrams.map((item) => item.id));
    await db.diagrams.bulkDelete(existing.filter((item) => !wanted.has(item.id)).map((item) => item.id));
    await db.diagrams.bulkPut(valid.diagrams);
  });
}

async function saveConflict(uid: string, local: ExportEnvelope, cloud: ExportEnvelope | null, reason: string, conflictId?: string): Promise<void> {
  const id = conflictId ?? `${uid}:${local.project.id}:${Date.now()}`;
  const conflict: SyncConflict = {
    id, uid, projectId: local.project.id, projectName: local.project.name, detectedAt: new Date().toISOString(),
    reason, localVersion: structuredClone(local), cloudVersion: cloud ? structuredClone(cloud) : null,
  };
  await db.syncConflicts.put(conflict);
  if (activeUid === uid) setProjectSyncStatus(local.project.id, 'conflict', reason);
  if (activeUid === uid) await refreshConflictList(uid);
  try {
    const ref = conflictRef(uid, local.project.id, id.replaceAll(':', '_'));
    await runTransaction(firestore, async (transaction) => {
      const current = await transaction.get(ref);
      if (!current.exists()) transaction.set(ref, normalizeFirestorePayload({
        id, reason, projectName: local.project.name,
        localVersion: conflict.localVersion, cloudVersion: conflict.cloudVersion, createdAt: serverTimestamp(),
      }));
    });
  } catch {
    // The local IndexedDB recovery copy remains authoritative while offline.
  }
}

async function refreshConflictList(uid: string) {
  emit({ conflicts: await db.syncConflicts.where('uid').equals(uid).reverse().sortBy('detectedAt') });
}

async function writeVersioned(uid: string, projectId: string, kind: EntityKind, entityId: string, payload: Project | Diagram | null, deleted: boolean, expectedRevision: number | null): Promise<number | null> {
  const ref = kind === 'project' ? projectRef(uid, projectId) : diagramRef(uid, projectId, entityId);
  return runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = readEntity(snapshot);
    if ((current?.revision ?? null) !== expectedRevision) return null;
    const revision = (current?.revision ?? 0) + 1;
    const safePayload = payload === null ? null : normalizeFirestorePayload(payload);
    transaction.set(ref, normalizeFirestorePayload({ revision, deleted, payload: safePayload, committedAt: serverTimestamp() }));
    transaction.set(versionRef(ref, revision), normalizeFirestorePayload({ revision, baseRevision: current?.revision ?? 0, deleted, payload: safePayload, committedAt: serverTimestamp() }));
    return revision;
  });
}

async function pushValue(uid: string, projectId: string, kind: EntityKind, entityId: string, value: Project | Diagram | null, deleted = false): Promise<boolean> {
  const marker = await getMarker(uid, kind, entityId);
  const hash = value ? contentHash(value) : '';
  if (!deleted && marker && !marker.deleted && hash === marker.contentHash) return true;
  if (marker?.deleted) return false;
  const expectedRevision = marker?.revision ?? null;
  const revision = await writeVersioned(uid, projectId, kind, entityId, value, deleted, expectedRevision);
  if (revision === null) return false;
  await putMarker(uid, projectId, kind, entityId, revision, hash, deleted);
  return true;
}

async function pushProject(uid: string, envelope: ExportEnvelope): Promise<void> {
  const projectId = envelope.project.id;
  setProjectSyncStatus(projectId, 'syncing', 'Enviando alterações para a nuvem.');
  const projectOk = await pushValue(uid, projectId, 'project', projectId, envelope.project);
  if (!projectOk) {
    const cloud = (await listRemote(uid)).get(projectId)?.envelope ?? null;
    await saveConflict(uid, envelope, cloud, 'O projeto foi alterado em outro dispositivo. As duas versões foram preservadas.');
    return;
  }
  const localIds = new Set(envelope.diagrams.map((item) => item.id));
  for (const diagram of envelope.diagrams) {
    const ok = await pushValue(uid, projectId, 'diagram', diagram.id, diagram);
    if (!ok) {
      const cloud = (await listRemote(uid)).get(projectId)?.envelope ?? null;
      await saveConflict(uid, envelope, cloud, `O fluxograma “${diagram.name}” foi alterado em outro dispositivo. As duas versões foram preservadas.`);
    }
  }
  const oldDiagramMarkers = await db.syncedEntities.where('[uid+projectId]').equals([uid, projectId]).toArray();
  for (const marker of oldDiagramMarkers) {
    if (marker.kind !== 'diagram' || marker.deleted || localIds.has(marker.entityId)) continue;
    const ok = await pushValue(uid, projectId, 'diagram', marker.entityId, null, true);
    if (!ok) await saveConflict(uid, envelope, (await listRemote(uid)).get(projectId)?.envelope ?? null, 'Um fluxograma removido ainda tinha alterações em outro dispositivo.');
  }
  const projectConflicts = await db.syncConflicts.where('uid').equals(uid).filter((item) => item.projectId === projectId).count();
  if (!projectConflicts) setProjectSyncStatus(projectId, 'synced', 'Sincronizado com a nuvem.');
}

async function completeCompatiblePartialProject(uid: string, local: ExportEnvelope, remote: { project: CloudEntity; diagrams: Map<string, CloudEntity>; envelope: ExportEnvelope | null }): Promise<boolean> {
  if (remote.project.deleted || remote.envelope || !remote.project.payload || typeof remote.project.payload !== 'object') return false;
  if (contentHash(local.project) !== contentHash(remote.project.payload as Project)) return false;
  const localDiagrams = new Map(local.diagrams.map((diagram) => [diagram.id, diagram]));
  for (const [id, entity] of remote.diagrams) {
    if (entity.deleted || !entity.payload) return false;
    const localDiagram = localDiagrams.get(id);
    if (!localDiagram || contentHash(localDiagram) !== contentHash(entity.payload as Diagram)) return false;
  }
  await putMarker(uid, local.project.id, 'project', local.project.id, remote.project.revision, contentHash(local.project));
  for (const [id, entity] of remote.diagrams) {
    await putMarker(uid, local.project.id, 'diagram', id, entity.revision, contentHash(entity.payload as Diagram));
  }
  await pushProject(uid, local);
  return true;
}

async function pushDeletedProject(uid: string, projectId: string): Promise<void> {
  const markers = await db.syncedEntities.where('[uid+projectId]').equals([uid, projectId]).toArray();
  for (const marker of markers) {
    if (marker.kind === 'diagram' && !marker.deleted) await pushValue(uid, projectId, 'diagram', marker.entityId, null, true);
  }
  const projectMarker = await getMarker(uid, 'project', projectId);
  if (projectMarker && !projectMarker.deleted) await pushValue(uid, projectId, 'project', projectId, null, true);
}

async function deleteLocalEnvelope(projectId: string): Promise<void> {
  await db.transaction('rw', db.projects, db.diagrams, async () => {
    await db.projects.delete(projectId);
    await db.diagrams.where('projectId').equals(projectId).delete();
  });
}

async function importCloudEnvelope(uid: string, envelope: ExportEnvelope, remote: { project: CloudEntity; diagrams: Map<string, CloudEntity> }): Promise<void> {
  const local = await getLocalEnvelope(envelope.project.id);
  if (!local) {
    await saveLocalEnvelope(envelope);
    await markEnvelope(uid, envelope, remote);
    return;
  }
  const projectMarker = await getMarker(uid, 'project', envelope.project.id);
  if (!projectMarker) {
    const equal = contentHash(local.project) === contentHash(envelope.project)
      && local.diagrams.length === envelope.diagrams.length
      && local.diagrams.every((item) => {
        const remoteDiagram = envelope.diagrams.find((candidate) => candidate.id === item.id);
        return Boolean(remoteDiagram && contentHash(item) === contentHash(remoteDiagram));
      });
    if (equal) {
      await markEnvelope(uid, envelope, remote);
      return;
    }
    const localCopy = duplicateExport(local);
    localCopy.project.name = `${local.project.name} — cópia local`;
    const root = localCopy.diagrams.find((item) => item.id === localCopy.project.rootDiagramId);
    if (root) root.name = localCopy.project.name;
    await saveLocalEnvelope(local);
    await db.projects.add(localCopy.project);
    await db.diagrams.bulkAdd(localCopy.diagrams);
    await saveLocalEnvelope(envelope);
    await markEnvelope(uid, envelope, remote);
    await pushProject(uid, localCopy);
    return;
  }
  if (await isLocalProjectClean(uid, local)) {
    await saveLocalEnvelope(envelope);
    await markEnvelope(uid, envelope, remote);
    return;
  }
  const id = `${uid}:${envelope.project.id}:remote-${remote.project.revision}-${[...remote.diagrams.values()].map((item) => item.revision).join('-')}`;
  await saveConflict(uid, local, envelope, 'Há alterações locais e remotas desde a última sincronização. Nenhuma versão foi sobrescrita.', id);
}

async function markEnvelope(uid: string, envelope: ExportEnvelope, remote: { project: CloudEntity; diagrams: Map<string, CloudEntity> }): Promise<void> {
  await putMarker(uid, envelope.project.id, 'project', envelope.project.id, remote.project.revision, contentHash(envelope.project));
  for (const diagram of envelope.diagrams) {
    const entity = remote.diagrams.get(diagram.id);
    if (entity) await putMarker(uid, envelope.project.id, 'diagram', diagram.id, entity.revision, contentHash(diagram), entity.deleted);
  }
  for (const [id, entity] of remote.diagrams) {
    if (entity.deleted) await putMarker(uid, envelope.project.id, 'diagram', id, entity.revision, '', true);
  }
}

async function firstMerge(uid: string): Promise<void> {
  const foreignLinks = await db.syncedEntities.where('uid').notEqual(uid).toArray();
  if (foreignLinks.length) {
    throw new Error('Este perfil local já está vinculado a outra conta Google. Entre com a mesma conta usada neste dispositivo para evitar misturar projetos.');
  }
  const localProjects = await db.projects.toArray();
  const locals = new Map<string, ExportEnvelope>();
  for (const project of localProjects) {
    const envelope = await getLocalEnvelope(project.id);
    if (envelope) locals.set(project.id, envelope);
  }
  let remotes = await listRemote(uid);
  // A missing local diagram with a live sync marker represents a local deletion
  // performed while offline. Publish its tombstone before merging remote data.
  for (const project of localProjects) {
    const local = locals.get(project.id);
    if (!local) continue;
    const localDiagramIds = new Set(local.diagrams.map((diagram) => diagram.id));
    const markers = await db.syncedEntities.where('[uid+projectId]').equals([uid, project.id]).toArray();
    for (const marker of markers) {
      if (marker.kind !== 'diagram' || marker.deleted || localDiagramIds.has(marker.entityId)) continue;
      const deleted = await pushValue(uid, project.id, 'diagram', marker.entityId, null, true);
      if (!deleted) await saveConflict(uid, local, remotes.get(project.id)?.envelope ?? null, 'Um fluxograma removido foi alterado na nuvem enquanto este dispositivo estava offline. A cópia remota foi preservada para recuperação.');
    }
  }
  remotes = await listRemote(uid);
  for (const [projectId, cloud] of remotes) {
    const local = locals.get(projectId);
    if (cloud.project.deleted) {
      if (local) {
        const marker = await getMarker(uid, 'project', projectId);
        if (marker && await isLocalProjectClean(uid, local)) await deleteLocalEnvelope(projectId);
        else await saveConflict(uid, local, null, 'Este projeto foi excluído na nuvem enquanto este dispositivo estava desatualizado. A versão local segue preservada para recuperação.');
      }
      continue;
    }
    if (!cloud.envelope) {
      if (local && !(await getMarker(uid, 'project', projectId))) {
        const repaired = await completeCompatiblePartialProject(uid, local, cloud);
        if (!repaired) await saveConflict(uid, local, null, 'A cópia remota está incompleta e diverge do projeto local. Ambas foram preservadas para recuperação.');
      }
      continue;
    }
    if (!local) {
      const marker = await getMarker(uid, 'project', projectId);
      if (marker?.deleted) continue;
      if (marker) {
        // A previously synchronized local project absent from Dexie is an
        // explicit local deletion, not a project that should be re-downloaded.
        await pushDeletedProject(uid, projectId);
        continue;
      }
    }
    await importCloudEnvelope(uid, cloud.envelope, cloud);
  }
  const refreshed = await db.projects.toArray();
  for (const project of refreshed) {
    const envelope = await getLocalEnvelope(project.id);
    if (!envelope) continue;
    const cloud = remotes.get(project.id);
    if (!cloud) {
      const linked = await getMarker(uid, 'project', project.id);
      if (!linked) await pushProject(uid, envelope);
      else await pushDeletedProject(uid, project.id);
    } else if (cloud.project.deleted) {
      if (!(await getMarker(uid, 'project', project.id))) {
        await saveConflict(uid, envelope, null, 'A nuvem contém uma exclusão anterior. O Fluxos preservou esta cópia local e não a republicou automaticamente.');
      }
    }
  }
}

async function reconcileRemote(uid: string, projectId: string): Promise<void> {
  if (activeUid !== uid) return;
  const remote = (await listRemote(uid)).get(projectId);
  if (!remote) return;
  const local = await getLocalEnvelope(projectId);
  if (remote.project.deleted) {
    if (!local) {
      await putMarker(uid, projectId, 'project', projectId, remote.project.revision, '', true);
      await refreshConflictList(uid);
      return;
    }
    const marker = await getMarker(uid, 'project', projectId);
    if (marker && await isLocalProjectClean(uid, local)) {
      await deleteLocalEnvelope(projectId);
      await putMarker(uid, projectId, 'project', projectId, remote.project.revision, '', true);
    } else {
      await saveConflict(uid, local, null, 'A nuvem excluiu este projeto enquanto havia alterações locais. A cópia local foi mantida.');
    }
    return;
  }
  if (!remote.envelope) return;
  if (!local) {
    await importCloudEnvelope(uid, remote.envelope, remote);
    await afterRemoteApply?.(projectId);
    return;
  }
  const markers = await db.syncedEntities.where('[uid+projectId]').equals([uid, projectId]).toArray();
  const hasMarkers = markers.some((item) => item.kind === 'project');
  if (!hasMarkers) {
    await importCloudEnvelope(uid, remote.envelope, remote);
    return;
  }
  if (await isLocalProjectClean(uid, local)) {
    const localProjectMarker = await getMarker(uid, 'project', projectId);
    let changed = (localProjectMarker?.revision ?? 0) !== remote.project.revision;
    // Compare tombstones as well as live diagrams. A deleted diagram is
    // intentionally absent from the envelope, so iterating the envelope alone
    // would leave it on devices that were online when the deletion happened.
    for (const [diagramId, entity] of remote.diagrams) {
      const marker = await getMarker(uid, 'diagram', diagramId);
      if (marker?.revision !== entity.revision || marker.deleted !== entity.deleted) changed = true;
    }
    if (changed) {
      await beforeRemoteApply?.(projectId);
      const latestLocal = await getLocalEnvelope(projectId);
      if (latestLocal && !(await isLocalProjectClean(uid, latestLocal))) {
        const id = `${uid}:${projectId}:remote-${remote.project.revision}-${[...remote.diagrams.values()].map((item) => item.revision).join('-')}`;
        await saveConflict(uid, latestLocal, remote.envelope, 'A edição local foi salva enquanto chegava uma alteração da nuvem. As duas versões foram preservadas.', id);
        return;
      }
      await saveLocalEnvelope(remote.envelope);
      await markEnvelope(uid, remote.envelope, remote);
      await afterRemoteApply?.(projectId);
    }
    return;
  }
  const id = `${uid}:${projectId}:remote-${remote.project.revision}-${[...remote.diagrams.values()].map((item) => item.revision).join('-')}`;
  await saveConflict(uid, local, remote.envelope, 'Há alterações locais e remotas desde a última sincronização. Nenhuma versão foi sobrescrita.', id);
}

async function pushAll(uid: string): Promise<void> {
  const localProjects = await db.projects.toArray();
  const localIds = new Set(localProjects.map((project) => project.id));
  for (const project of localProjects) {
    const envelope = await getLocalEnvelope(project.id);
    if (envelope) {
      try { await pushProject(uid, envelope); }
      catch (error) { setProjectSyncStatus(project.id, 'error', error instanceof Error ? error.message : 'Falha ao sincronizar este projeto.'); }
    }
  }
  const markers = await db.syncedEntities.where('uid').equals(uid).toArray();
  const missingProjects = new Set(markers.filter((item) => item.kind === 'project' && !item.deleted && !localIds.has(item.projectId)).map((item) => item.projectId));
  for (const projectId of missingProjects) await pushDeletedProject(uid, projectId);
}

let initialPromise: Promise<void> | undefined;
export async function startCloudSync(uid: string, email: string | null): Promise<void> {
  activeUid = uid;
  emit({ uid, email, status: 'syncing', message: 'Unindo projetos locais e da nuvem…', projects: {} });
  if (!initialPromise) initialPromise = firstMerge(uid).then(() => undefined).finally(() => { initialPromise = undefined; });
  try {
    await initialPromise;
    await pushAll(uid);
    unsubscribeCloud?.();
    for (const unsubscribe of unsubscribeDiagramSnapshots.values()) unsubscribe();
    unsubscribeDiagramSnapshots = new Map();
    const root = collection(firestore, 'users', uid, 'projects');
    unsubscribeCloud = onSnapshot(root, (snapshot) => {
      const visibleProjects = new Set(snapshot.docs.map((item) => item.id));
      for (const [id, unsubscribe] of unsubscribeDiagramSnapshots) {
        if (!visibleProjects.has(id)) { unsubscribe(); unsubscribeDiagramSnapshots.delete(id); }
      }
      for (const item of snapshot.docs) {
        const id = item.id;
        if (!unsubscribeDiagramSnapshots.has(id)) {
          const unsubscribe = onSnapshot(collection(item.ref, 'diagrams'), () => {
            syncTail = syncTail.then(() => reconcileRemote(uid, id)).catch((error) => reportError(error));
          }, reportError);
          unsubscribeDiagramSnapshots.set(id, unsubscribe);
        }
        syncTail = syncTail.then(() => reconcileRemote(uid, id)).catch((error) => reportError(error));
      }
    }, reportError);
    await refreshConflictList(uid);
    await refreshProjectSyncStatuses(uid);
    emitSettledGlobalStatus(uid);
  } catch (error) {
    reportError(error);
  }
}

export function stopCloudSync(): void {
  activeUid = null;
  unsubscribeCloud?.();
  unsubscribeCloud = undefined;
  for (const unsubscribe of unsubscribeDiagramSnapshots.values()) unsubscribe();
  unsubscribeDiagramSnapshots = new Map();
  if (debounceTimer) clearTimeout(debounceTimer);
  emit({ uid: null, email: null, status: 'local', message: 'Salvo localmente', conflicts: [], projects: {} });
}

export function requestCloudSync(): void {
  if (!activeUid) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const uid = activeUid;
    if (!uid || !navigator.onLine) {
      emit({ status: 'local', message: 'Salvo localmente · aguardando conexão' });
      if (uid) void refreshProjectSyncStatuses(uid);
      return;
    }
    emit({ status: 'syncing', message: 'Sincronizando…' });
    syncTail = syncTail.then(async () => {
      await pushAll(uid);
      await refreshConflictList(uid);
      if (activeUid === uid) {
        await refreshProjectSyncStatuses(uid);
        emitSettledGlobalStatus(uid);
      }
    }).catch(reportError);
  }, 500);
}

export async function refreshCloudConflicts(uid: string): Promise<void> { await refreshConflictList(uid); }

export async function restoreConflictVersion(conflictId: string, version: 'local' | 'cloud'): Promise<void> {
  const conflict = await db.syncConflicts.get(conflictId);
  if (!conflict) throw new Error('A versão de recuperação não foi encontrada.');
  const envelope = version === 'local' ? conflict.localVersion : conflict.cloudVersion;
  if (!envelope) throw new Error('Não há uma versão remota preservada para restaurar.');
  const copy = duplicateExport(envelope);
  copy.project.name = `${envelope.project.name} — cópia recuperada`;
  const root = copy.diagrams.find((item) => item.id === copy.project.rootDiagramId);
  if (root) root.name = copy.project.name;
  await saveLocalEnvelope(copy);
  await requestCloudSync();
  if (activeUid) await refreshConflictList(activeUid);
}

function reportError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Não foi possível sincronizar os projetos.';
  emit({ status: navigator.onLine ? 'error' : 'local', message: navigator.onLine ? message : 'Salvo localmente · aguardando conexão' });
}

export function watchNetworkStatus(): () => void {
  const update = () => {
    if (!navigator.onLine) {
      emit({ status: 'local', message: 'Salvo localmente · aguardando conexão' });
      if (activeUid) void refreshProjectSyncStatuses(activeUid);
    }
    else if (activeUid) requestCloudSync();
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  return () => {
    window.removeEventListener('online', update);
    window.removeEventListener('offline', update);
  };
}
