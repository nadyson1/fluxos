import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Network, Plus, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { normalizeSearchText, type Diagram } from '../domain';

type Props = {
  open: boolean;
  diagrams: Diagram[];
  currentId: string;
  onOpen: (diagramId: string) => void;
  onClose: () => void;
  onCreate: () => void;
};

export function ProcessTree({ open, diagrams, currentId, onOpen, onClose, onCreate }: Props) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const byId = useMemo(() => new Map(diagrams.map((diagram) => [diagram.id, diagram])), [diagrams]);

  useEffect(() => {
    const next = new Set<string>();
    let current = byId.get(currentId);
    while (current?.parentDiagramId) { next.add(current.parentDiagramId); current = byId.get(current.parentDiagramId); }
    setExpanded((existing) => new Set([...existing, ...next]));
  }, [currentId, byId]);

  const children = useMemo(() => {
    const groups = new Map<string | null, Diagram[]>();
    for (const diagram of diagrams) {
      const items = groups.get(diagram.parentDiagramId) ?? [];
      items.push(diagram);
      groups.set(diagram.parentDiagramId, items);
    }
    return groups;
  }, [diagrams]);

  const visibleForQuery = useMemo(() => {
    const queryNorm = normalizeSearchText(query);
    const visible = new Set<string>();
    if (!queryNorm) return visible;
    for (const diagram of diagrams) {
      if (!normalizeSearchText(diagram.name).includes(queryNorm)) continue;
      let current: Diagram | undefined = diagram;
      while (current && !visible.has(current.id)) {
        visible.add(current.id);
        current = current.parentDiagramId ? byId.get(current.parentDiagramId) : undefined;
      }
    }
    return visible;
  }, [query, diagrams, byId]);

  const toggle = (id: string) => setExpanded((old) => {
    const next = new Set(old);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderItems = (parentId: string | null, depth: number): ReactNode => (children.get(parentId) ?? [])
    .filter((diagram) => !query || visibleForQuery.has(diagram.id))
    .map((diagram) => {
      const hasChildren = (children.get(diagram.id)?.length ?? 0) > 0;
      const isExpanded = Boolean(query) || expanded.has(diagram.id);
      return (
        <li className="tree-branch" key={diagram.id}>
          <div className={`tree-row${diagram.id === currentId ? ' is-current' : ''}`} style={{ paddingInlineStart: 8 + depth * 18 }}>
            <button
              className="tree-expand icon-button"
              type="button"
              aria-label={isExpanded ? `Recolher ${diagram.name}` : `Expandir ${diagram.name}`}
              aria-expanded={isExpanded}
              onClick={() => hasChildren && toggle(diagram.id)}
              disabled={!hasChildren}
            >{hasChildren ? (isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : <span className="tree-spacer" />}</button>
            <button className="tree-open" type="button" onClick={() => onOpen(diagram.id)} title={diagram.name}>
              <Network size={15} aria-hidden="true" />
              <span>{diagram.name}</span>
            </button>
          </div>
          {hasChildren && isExpanded && <ul>{renderItems(diagram.id, depth + 1)}</ul>}
        </li>
      );
    });

  return (
    <aside className={`process-tree${open ? ' is-open' : ''}`} aria-label="Estrutura de processos" aria-hidden={!open}>
      <div className="tree-heading">
        <div><Network size={18} aria-hidden="true" /><h2>Estrutura de processos</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar árvore"><X size={19} /></button>
      </div>
      <label className="tree-search">
        <Search size={17} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar na árvore…" aria-label="Buscar nesta árvore" />
        {query && <button type="button" aria-label="Limpar busca" onClick={() => setQuery('')}><X size={15} /></button>}
      </label>
      <div className="tree-scroll">
        {diagrams.length ? <ul className="tree-list">{renderItems(null, 0)}</ul> : <p className="tree-empty">Este projeto ainda não tem fluxogramas.</p>}
        {query && visibleForQuery.size === 0 && <p className="tree-empty">Nenhum fluxograma encontrado.</p>}
      </div>
      <div className="tree-footer">
        <button type="button" className="button button-primary" onClick={onCreate}><Plus size={17} />Novo subprocesso</button>
      </div>
    </aside>
  );
}
