import { ArrowRight, LayoutGrid, MousePointer2, PanelLeft, Type, type LucideIcon } from 'lucide-react';
import type { PointerEvent } from 'react';
import type { NodeKind } from '../domain';

export type EditorTool = 'select' | 'connect' | NodeKind;

type Props = {
  activeTool: EditorTool;
  onSelect: (tool: EditorTool) => void;
  onShapePointerDown: (kind: NodeKind, event: PointerEvent<HTMLButtonElement>) => void;
  onToggleTree: () => void;
  onOpenLibrary: () => void;
  treeOpen: boolean;
};

const shapes: { kind: NodeKind; label: string }[] = [
  { kind: 'process', label: 'Processo' },
  { kind: 'decision', label: 'Decisão' },
  { kind: 'startEnd', label: 'Início / fim' },
  { kind: 'inputOutput', label: 'Entrada / saída' },
  { kind: 'note', label: 'Anotação' },
  { kind: 'text', label: 'Texto' },
];

function ShapeGlyph({ kind }: { kind: NodeKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' as const };
  return <svg width="23" height="23" viewBox="0 0 24 24" aria-hidden="true">
    {kind === 'process' && <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" {...common} />}
    {kind === 'decision' && <path d="m12 3.2 8.8 8.8-8.8 8.8L3.2 12 12 3.2Z" {...common} />}
    {kind === 'startEnd' && <rect x="3.2" y="6.2" width="17.6" height="11.6" rx="5.8" {...common} />}
    {kind === 'inputOutput' && <path d="M6.2 5.5h14.3l-2.7 13H3.5l2.7-13Z" {...common} />}
    {kind === 'note' && <><path d="M5 3.8h10.8L19 7v13.2H5V3.8Z" {...common} /><path d="M15.5 4v3.8H19M8 11h8M8 14.5h8" {...common} /></>}
  </svg>;
}

export function ToolRail({ activeTool, onSelect, onShapePointerDown, onToggleTree, onOpenLibrary, treeOpen }: Props) {
  const select = (tool: EditorTool) => onSelect(tool);
  const ToolButton = ({ tool, label, icon: Icon }: { tool: EditorTool; label: string; icon: LucideIcon }) => (
    <button
      type="button"
      className={`rail-tool${activeTool === tool ? ' is-active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={activeTool === tool}
      onClick={() => select(tool)}
    >
      <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );

  return (
    <nav className="tool-rail" aria-label="Ferramentas do editor">
      <div className="rail-scroll">
        <ToolButton tool="select" label="Selecionar" icon={MousePointer2} />
        {shapes.map(({ kind, label }) => <button
          key={kind}
          type="button"
          className={`rail-tool${activeTool === kind ? ' is-active' : ''}`}
          title={label}
          aria-label={label}
          aria-pressed={activeTool === kind}
          onClick={() => select(kind)}
          onPointerDown={(event) => onShapePointerDown(kind, event)}
        >{kind === 'text' ? <Type size={23} strokeWidth={1.8} aria-hidden="true" /> : <ShapeGlyph kind={kind} />}<span>{label}</span></button>)}
        <ToolButton tool="connect" label="Conector" icon={ArrowRight} />
        <div className="rail-divider" />
        <button type="button" className={`rail-tool${treeOpen ? ' is-active' : ''}`} onClick={onToggleTree} aria-label="Árvore de processos" aria-pressed={treeOpen} title="Árvore de processos">
          <PanelLeft size={22} strokeWidth={1.8} aria-hidden="true" /><span>Árvore</span>
        </button>
      </div>
      <button type="button" className="rail-tool rail-library" onClick={onOpenLibrary} aria-label="Biblioteca de projetos" title="Biblioteca de projetos">
        <LayoutGrid size={22} strokeWidth={1.8} aria-hidden="true" /><span>Projetos</span>
      </button>
    </nav>
  );
}
