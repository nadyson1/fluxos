import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Folder, MoreHorizontal, Network, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { normalizeSearchText, type Diagram, type Project } from '../domain';

type ProjectRecord = { project: Project; diagrams: Diagram[] };
type Props = {
  projects: ProjectRecord[];
  onCreate: () => void;
  onOpen: (projectId: string, diagramId: string) => void;
  onRename: (project: Project) => void;
  onDuplicate: (project: Project) => void;
  onDelete: (project: Project) => void;
  onSearch: () => void;
  onImportExample: () => void;
  exampleImported: boolean;
};

export function ProjectLibrary({ projects, onCreate, onOpen, onRename, onDuplicate, onDelete, onSearch, onImportExample, exampleImported }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const visibleProjects = useMemo(() => {
    const text = normalizeSearchText(query);
    if (!text) return projects;
    return projects.filter(({ project, diagrams }) => normalizeSearchText(project.name).includes(text) || diagrams.some((diagram) => normalizeSearchText(diagram.name).includes(text)));
  }, [projects, query]);
  const toggle = (id: string) => setExpanded((old) => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });

  return (
    <main className="library-page">
      <div className="library-header">
        <div><p className="library-kicker">Fluxos</p><h1>Seus projetos</h1><p className="library-description">Abra um processo ou continue organizando suas ideias.</p></div>
        <div className="library-actions">
          <button type="button" className="button button-secondary" onClick={onSearch}><Search size={17} />Buscar</button>
          <button type="button" className="button button-primary" onClick={onCreate}><Plus size={18} />Novo projeto</button>
        </div>
      </div>
      <label className="library-filter"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar projetos por nome…" aria-label="Filtrar projetos" /></label>
      {visibleProjects.length ? <div className="project-list">
        {visibleProjects.map(({ project, diagrams }) => {
          const root = diagrams.find((diagram) => diagram.id === project.rootDiagramId);
          const children = new Map<string | null, Diagram[]>();
          diagrams.forEach((diagram) => { const group = children.get(diagram.parentDiagramId) ?? []; group.push(diagram); children.set(diagram.parentDiagramId, group); });
          const open = expanded.has(project.id);
          const renderTree = (parentId: string | null, depth: number): ReactNode => (children.get(parentId) ?? []).map((diagram) => {
            const hasChildren = (children.get(diagram.id)?.length ?? 0) > 0;
            const isOpen = expanded.has(diagram.id) || (diagram.id === project.rootDiagramId && open);
            return <li key={diagram.id}>
              <div className="library-tree-row" style={{ paddingInlineStart: 4 + depth * 22 }}>
                <button type="button" className="icon-button tree-expand" disabled={!hasChildren} aria-label={isOpen ? `Recolher ${diagram.name}` : `Expandir ${diagram.name}`} onClick={() => toggle(diagram.id)}>{hasChildren ? isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : <span className="tree-spacer" />}</button>
                <button type="button" className="library-tree-link" onClick={() => onOpen(project.id, diagram.id)}><Network size={15} /><span>{diagram.name}</span></button>
              </div>
              {hasChildren && isOpen && <ul>{renderTree(diagram.id, depth + 1)}</ul>}
            </li>;
          });
          return <article className="project-entry" key={project.id}>
            <div className="project-entry-head">
              <button type="button" className="project-main-link" onClick={() => root && onOpen(project.id, root.id)}>
                <span className="project-mark"><Folder size={20} aria-hidden="true" /></span>
                <span className="project-title-block"><strong>{project.name}</strong><small>{diagrams.length} {diagrams.length === 1 ? 'fluxograma' : 'fluxogramas'} · alterado em {new Date(project.updatedAt).toLocaleDateString('pt-BR')}</small></span>
              </button>
              <div className="project-entry-actions">
                <button className="button button-open" type="button" onClick={() => root && onOpen(project.id, root.id)}>Abrir</button>
                <div className="menu-anchor">
                  <button className="icon-button" type="button" aria-label={`Ações para ${project.name}`} title="Ações do projeto" onClick={() => toggle(`menu-${project.id}`)}><MoreHorizontal size={20} /></button>
                  {expanded.has(`menu-${project.id}`) && <div className="small-menu">
                    <button type="button" onClick={() => { toggle(`menu-${project.id}`); onRename(project); }}><Pencil size={16} />Renomear</button>
                    <button type="button" onClick={() => { toggle(`menu-${project.id}`); onDuplicate(project); }}><Copy size={16} />Duplicar</button>
                    <button type="button" className="danger-action" onClick={() => { toggle(`menu-${project.id}`); onDelete(project); }}><Trash2 size={16} />Excluir</button>
                  </div>}
                </div>
                <button className="icon-button" type="button" aria-expanded={open} aria-label={open ? 'Recolher fluxogramas' : 'Explorar fluxogramas'} title="Explorar fluxogramas" onClick={() => toggle(project.id)}>{open ? <ChevronDown size={19} /> : <ChevronRight size={19} />}</button>
              </div>
            </div>
            {open && <div className="project-tree"><ul>{renderTree(null, 0)}</ul></div>}
          </article>;
        })}
      </div> : projects.length ? <div className="library-empty"><p>Nenhum projeto corresponde a “{query}”.</p></div> : (
        <section className="library-empty">
          <div className="empty-mark"><Network size={28} aria-hidden="true" /></div>
          <h2>Comece pelo primeiro processo</h2>
          <p>Crie um projeto em branco ou importe o exemplo para explorar a árvore de subprocessos.</p>
          <div className="empty-actions"><button className="button button-primary" type="button" onClick={onCreate}><Plus size={17} />Criar projeto</button>{!exampleImported && <button className="button button-secondary" type="button" onClick={onImportExample}>Importar exemplo</button>}</div>
        </section>
      )}
      {projects.length > 0 && !exampleImported && <div className="example-callout"><span>Quer ver como funcionam os níveis aninhados?</span><button type="button" onClick={onImportExample}>Importar projeto de exemplo</button></div>}
    </main>
  );
}
