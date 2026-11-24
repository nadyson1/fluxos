import { useEffect, useState } from 'react';
import { FileSearch, Folder, LoaderCircle, Network, Search, X } from 'lucide-react';
import { searchProjects } from '../repository';
import type { SearchResult } from '../domain';

type Props = { onClose: () => void; onChoose: (result: SearchResult) => void };

export function GlobalSearch({ onClose, onChoose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!query.trim()) { setResults([]); setLoading(false); setError(''); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const found = await searchProjects(query);
        if (active) setResults(found);
      } catch {
        if (active) setError('Não foi possível consultar os projetos locais.');
      } finally {
        if (active) setLoading(false);
      }
    }, 160);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop search-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="search-dialog" role="dialog" aria-modal="true" aria-label="Buscar em todos os projetos">
        <div className="global-search-input">
          <Search size={21} aria-hidden="true" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Projetos, fluxogramas ou blocos…" aria-label="Buscar em todos os projetos" />
          {loading ? <LoaderCircle className="spin" size={18} aria-label="Buscando" /> : <kbd>Esc</kbd>}
          <button type="button" className="icon-button" aria-label="Fechar busca" onClick={onClose}><X size={19} /></button>
        </div>
        {error ? <p className="search-empty">{error}</p> : !query.trim() ? <p className="search-empty">A busca percorre nomes e textos de blocos em todos os projetos.</p> : loading && !results.length ? <p className="search-empty">Buscando nos dados locais…</p> : results.length ? (
          <ul className="search-results">
            {results.map((result, index) => {
              const Icon = result.kind === 'project' ? Folder : result.kind === 'diagram' ? Network : FileSearch;
              const label = result.kind === 'project' ? 'Projeto' : result.kind === 'diagram' ? 'Fluxograma' : 'Bloco';
              return <li key={`${result.projectId}-${result.diagramId ?? ''}-${result.nodeId ?? ''}-${index}`}>
                <button type="button" className="search-result" onClick={() => onChoose(result)}>
                  <span className="search-result-icon"><Icon size={19} aria-hidden="true" /></span>
                  <span className="search-result-text"><strong>{result.title}</strong><small>{result.path}</small></span>
                  <span className="result-kind">{label}</span>
                </button>
              </li>;
            })}
          </ul>
        ) : <p className="search-empty">Nenhum resultado para “{query}”.</p>}
      </section>
    </div>
  );
}
