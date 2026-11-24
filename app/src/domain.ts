export type NodeKind = 'startEnd' | 'process' | 'decision' | 'inputOutput' | 'note' | 'text';
export type TextAlignment = 'left' | 'center' | 'right';

export type FlowNode = {
  id: string;
  kind: NodeKind;
  label: string;
  subtitle?: string;
  position: { x: number; y: number };
  linkedDiagramId?: string;
  fontSize?: number;
  bold?: boolean;
  textAlign?: TextAlignment;
  textColor?: string;
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  style?: 'smoothstep' | 'bezier' | 'straight';
};

export type Diagram = {
  id: string;
  projectId: string;
  name: string;
  parentDiagramId: string | null;
  ownerNodeId: string | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport?: { x: number; y: number; zoom: number };
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  name: string;
  rootDiagramId: string;
  createdAt: string;
  updatedAt: string;
};

export type ExportEnvelope = {
  format: 'fluxos-project';
  schemaVersion: 1;
  exportedAt: string;
  project: Project;
  diagrams: Diagram[];
};

export type SearchResult = {
  kind: 'project' | 'diagram' | 'node';
  projectId: string;
  diagramId?: string;
  nodeId?: string;
  title: string;
  path: string;
  excerpt?: string;
};

const nodeKinds = new Set<NodeKind>(['startEnd', 'process', 'decision', 'inputOutput', 'note', 'text']);
const edgeStyles = new Set(['smoothstep', 'bezier', 'straight']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} deve ser um texto não vazio.`);
  return value;
}

function requireFinite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} precisa ser um número válido.`);
  return value;
}

export function validateExportEnvelope(input: unknown): ExportEnvelope {
  if (!isRecord(input) || input.format !== 'fluxos-project' || input.schemaVersion !== 1) {
    throw new Error('Arquivo inválido: formato ou versão não reconhecidos.');
  }
  if (!isRecord(input.project) || !Array.isArray(input.diagrams) || input.diagrams.length === 0) {
    throw new Error('Arquivo inválido: projeto ou diagramas ausentes.');
  }

  const project = input.project as unknown as Project;
  requireString(project.id, 'ID do projeto');
  requireString(project.name, 'Nome do projeto');
  requireString(project.rootDiagramId, 'Diagrama raiz');
  const ids = new Set<string>();
  const addId = (id: unknown, field: string) => {
    const value = requireString(id, field);
    if (ids.has(value)) throw new Error(`ID duplicado: ${value}.`);
    ids.add(value);
  };
  addId(project.id, 'ID do projeto');

  const diagrams: Diagram[] = (input.diagrams as unknown[]).map((raw, diagramIndex) => {
    const prefix = `Diagrama ${diagramIndex + 1}`;
    if (!isRecord(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
      throw new Error(`${prefix}: estrutura inválida.`);
    }
    const diagram = raw as unknown as Diagram;
    addId(diagram.id, `${prefix}: ID`);
    requireString(diagram.name, `${prefix}: nome`);
    if (diagram.projectId !== project.id) throw new Error(`${prefix}: pertence a outro projeto.`);
    if (diagram.parentDiagramId !== null && typeof diagram.parentDiagramId !== 'string') {
      throw new Error(`${prefix}: diagrama pai inválido.`);
    }
    if (diagram.ownerNodeId !== null && typeof diagram.ownerNodeId !== 'string') {
      throw new Error(`${prefix}: nó proprietário inválido.`);
    }
    const nodes: FlowNode[] = diagram.nodes.map((rawNode, nodeIndex) => {
      const nodePrefix = `${prefix}, nó ${nodeIndex + 1}`;
      if (!isRecord(rawNode) || !isRecord(rawNode.position)) throw new Error(`${nodePrefix}: estrutura inválida.`);
      const node = rawNode as unknown as FlowNode;
      addId(node.id, `${nodePrefix}: ID`);
      if (!nodeKinds.has(node.kind)) throw new Error(`${nodePrefix}: tipo de bloco inválido.`);
      requireString(node.label, `${nodePrefix}: texto`);
      const position = {
        x: requireFinite(node.position.x, `${nodePrefix}: posição X`),
        y: requireFinite(node.position.y, `${nodePrefix}: posição Y`),
      };
      if (node.subtitle !== undefined && typeof node.subtitle !== 'string') throw new Error(`${nodePrefix}: subtítulo inválido.`);
      if (node.linkedDiagramId !== undefined && typeof node.linkedDiagramId !== 'string') throw new Error(`${nodePrefix}: subprocesso inválido.`);
      if (node.fontSize !== undefined && (typeof node.fontSize !== 'number' || !Number.isFinite(node.fontSize) || node.fontSize < 10 || node.fontSize > 96)) {
        throw new Error(`${nodePrefix}: tamanho de fonte inválido.`);
      }
      if (node.bold !== undefined && typeof node.bold !== 'boolean') throw new Error(`${nodePrefix}: negrito inválido.`);
      if (node.textAlign !== undefined && !['left', 'center', 'right'].includes(node.textAlign)) throw new Error(`${nodePrefix}: alinhamento de texto inválido.`);
      if (node.textColor !== undefined && (typeof node.textColor !== 'string' || !/^#[\da-f]{6}$/i.test(node.textColor))) {
        throw new Error(`${nodePrefix}: cor do texto inválida.`);
      }
      return { ...node, position };
    });
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges: FlowEdge[] = diagram.edges.map((rawEdge, edgeIndex) => {
      const edgePrefix = `${prefix}, aresta ${edgeIndex + 1}`;
      if (!isRecord(rawEdge)) throw new Error(`${edgePrefix}: estrutura inválida.`);
      const edge = rawEdge as unknown as FlowEdge;
      addId(edge.id, `${edgePrefix}: ID`);
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) throw new Error(`${edgePrefix}: nó de origem ou destino inexistente.`);
      if (edge.label !== undefined && typeof edge.label !== 'string') throw new Error(`${edgePrefix}: rótulo inválido.`);
      if (edge.style !== undefined && !edgeStyles.has(edge.style)) throw new Error(`${edgePrefix}: estilo inválido.`);
      return { ...edge };
    });
    let viewport = diagram.viewport;
    if (viewport !== undefined) {
      if (!isRecord(viewport)) throw new Error(`${prefix}: viewport inválido.`);
      viewport = {
        x: requireFinite(viewport.x, `${prefix}: viewport X`),
        y: requireFinite(viewport.y, `${prefix}: viewport Y`),
        zoom: requireFinite(viewport.zoom, `${prefix}: zoom`),
      };
      if (viewport.zoom <= 0) throw new Error(`${prefix}: zoom precisa ser maior que zero.`);
    }
    return { ...diagram, nodes, edges, viewport };
  });

  const byId = new Map(diagrams.map((diagram) => [diagram.id, diagram]));
  for (const diagram of diagrams) {
    const visited = new Set<string>([diagram.id]);
    let ancestor = diagram.parentDiagramId;
    while (ancestor) {
      if (visited.has(ancestor)) throw new Error('Ciclo detectado na hierarquia de subprocessos.');
      visited.add(ancestor);
      const parent = byId.get(ancestor);
      if (!parent) throw new Error(`Diagrama pai inexistente para "${diagram.name}".`);
      ancestor = parent.parentDiagramId;
    }
  }
  const roots = diagrams.filter((diagram) => diagram.parentDiagramId === null);
  if (roots.length !== 1 || roots[0]?.id !== project.rootDiagramId) throw new Error('Projeto precisa ter um único diagrama raiz válido.');
  if (!byId.has(project.rootDiagramId)) throw new Error('Diagrama raiz inexistente.');

  const ownerKeys = new Set<string>();
  for (const diagram of diagrams) {
    if (diagram.parentDiagramId !== null) {
      const parent = byId.get(diagram.parentDiagramId);
      if (!parent) throw new Error(`Diagrama pai inexistente para "${diagram.name}".`);
      if (diagram.ownerNodeId !== null) {
        const owner = parent.nodes.find((node) => node.id === diagram.ownerNodeId);
        if (!owner) throw new Error(`Nó proprietário inexistente para "${diagram.name}".`);
        if (owner.linkedDiagramId !== diagram.id) throw new Error(`Vínculo entre nó e subprocesso inválido em "${diagram.name}".`);
        const ownerKey = `${parent.id}:${owner.id}`;
        if (ownerKeys.has(ownerKey)) throw new Error(`Nó proprietário associado a mais de um subprocesso.`);
        ownerKeys.add(ownerKey);
      }
    } else if (diagram.ownerNodeId !== null) {
      throw new Error('O diagrama raiz não pode ter um nó proprietário.');
    }
    for (const node of diagram.nodes) {
      if (!node.linkedDiagramId) continue;
      const child = byId.get(node.linkedDiagramId);
      if (!child || child.parentDiagramId !== diagram.id || child.ownerNodeId !== node.id) {
        throw new Error(`Subprocesso órfão ou incompatível no bloco "${node.label}".`);
      }
    }
    if (diagram.id !== project.rootDiagramId) {
      let current: Diagram | undefined = diagram;
      while (current?.parentDiagramId && current.id !== project.rootDiagramId) current = byId.get(current.parentDiagramId);
      if (current?.id !== project.rootDiagramId) throw new Error(`Diagrama "${diagram.name}" não está ligado à raiz do projeto.`);
    }
  }

  return structuredClone({ ...input, project: { ...project }, diagrams }) as ExportEnvelope;
}

export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}

export function searchExport(envelopes: ExportEnvelope[], rawQuery: string): SearchResult[] {
  const query = normalizeSearchText(rawQuery);
  if (!query) return [];
  const results: SearchResult[] = [];
  for (const envelope of envelopes) {
    const { project, diagrams } = envelope;
    const diagramById = new Map(diagrams.map((diagram) => [diagram.id, diagram]));
    const pathFor = (diagram: Diagram) => {
      const names: string[] = [];
      let current: Diagram | undefined = diagram;
      const seen = new Set<string>();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        names.unshift(current.name);
        current = current.parentDiagramId ? diagramById.get(current.parentDiagramId) : undefined;
      }
      return [project.name, ...names.filter((name, index) => index > 0 || name !== project.name)].join(' > ');
    };
    if (normalizeSearchText(project.name).includes(query)) {
      results.push({ kind: 'project', projectId: project.id, title: project.name, path: project.name });
    }
    for (const diagram of diagrams) {
      const path = pathFor(diagram);
      if (normalizeSearchText(diagram.name).includes(query)) {
        results.push({ kind: 'diagram', projectId: project.id, diagramId: diagram.id, title: diagram.name, path });
      }
      for (const node of diagram.nodes) {
        if (`${node.label} ${node.subtitle ?? ''}`.length && normalizeSearchText(`${node.label} ${node.subtitle ?? ''}`).includes(query)) {
          results.push({ kind: 'node', projectId: project.id, diagramId: diagram.id, nodeId: node.id, title: node.label, path, excerpt: node.subtitle });
        }
      }
    }
  }
  return results;
}

export function duplicateExport(source: ExportEnvelope, idFactory: () => string = () => crypto.randomUUID()): ExportEnvelope {
  const envelope = validateExportEnvelope(source);
  const ids = new Map<string, string>();
  const assign = (id: string) => {
    const next = idFactory();
    if ([...ids.values()].includes(next)) throw new Error('O gerador produziu IDs repetidos.');
    ids.set(id, next);
  };
  assign(envelope.project.id);
  for (const diagram of envelope.diagrams) {
    assign(diagram.id);
    diagram.nodes.forEach((node) => assign(node.id));
    diagram.edges.forEach((edge) => assign(edge.id));
  }
  const now = new Date().toISOString();
  const copy: ExportEnvelope = {
    format: 'fluxos-project',
    schemaVersion: 1,
    exportedAt: now,
    project: { ...envelope.project, id: ids.get(envelope.project.id)!, rootDiagramId: ids.get(envelope.project.rootDiagramId)!, name: `${envelope.project.name} — cópia`, createdAt: now, updatedAt: now },
    diagrams: envelope.diagrams.map((diagram) => ({
      ...diagram,
      id: ids.get(diagram.id)!,
      projectId: ids.get(diagram.projectId)!,
      parentDiagramId: diagram.parentDiagramId ? ids.get(diagram.parentDiagramId)! : null,
      ownerNodeId: diagram.ownerNodeId ? ids.get(diagram.ownerNodeId)! : null,
      nodes: diagram.nodes.map((node) => ({ ...node, id: ids.get(node.id)!, linkedDiagramId: node.linkedDiagramId ? ids.get(node.linkedDiagramId) : undefined })),
      edges: diagram.edges.map((edge) => ({ ...edge, id: ids.get(edge.id)!, source: ids.get(edge.source)!, target: ids.get(edge.target)! })),
      createdAt: now,
      updatedAt: now,
    })),
  };
  return validateExportEnvelope(copy);
}

export function removeNodePreservingSubprocess(diagrams: Diagram[], diagramId: string, nodeId: string): Diagram[] {
  const cloned = structuredClone(diagrams);
  const diagram = cloned.find((item) => item.id === diagramId);
  if (!diagram) throw new Error('Fluxograma não encontrado.');
  const node = diagram.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error('Bloco não encontrado.');
  diagram.nodes = diagram.nodes.filter((item) => item.id !== nodeId);
  diagram.edges = diagram.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
  if (node.linkedDiagramId) {
    const child = cloned.find((item) => item.id === node.linkedDiagramId);
    if (child) child.ownerNodeId = null;
  }
  return cloned;
}
