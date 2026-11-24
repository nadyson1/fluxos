import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, MoreHorizontal, Network } from 'lucide-react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { FlowNode } from '../domain';
import { getFlowHandleDirection } from './handle-directions';
import { shouldRenderHandles } from '../text-connections';

export type FlowNodeData = FlowNode & {
  onEditLabel: (id: string, label: string) => void;
  onOpen: (diagramId: string) => void;
  onOpenMenu: (
    id: string,
    anchor: { left: number; right: number; top: number; bottom: number },
    element: { left: number; right: number; top: number; bottom: number },
  ) => void;
};
export type CanvasNode = Node<FlowNodeData, 'flowBlock'>;

const titles: Record<FlowNode['kind'], string> = {
  startEnd: 'Início ou fim', process: 'Processo', decision: 'Decisão', inputOutput: 'Entrada ou saída', note: 'Anotação', text: 'Texto livre',
};

export function FlowNodeView({ id, data, selected }: NodeProps<CanvasNode>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(data.label), [data.label]);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);

  const finish = (commit: boolean) => {
    if (commit && draft.trim()) data.onEditLabel(id, draft.trim());
    else setDraft(data.label);
    setEditing(false);
  };
  const textStyle = data.kind === 'text' ? {
    fontSize: `${data.fontSize ?? 18}px`, fontWeight: data.bold ? 700 : 500,
    textAlign: data.textAlign ?? 'center' as const, color: data.textColor ?? '#253a2d',
  } : undefined;

  return (
    <div className={`flow-node flow-node--${data.kind}${selected ? ' is-selected' : ''}`}>
      {shouldRenderHandles(data.kind) && <>
        <Handle className="flow-handle" type={getFlowHandleDirection('left')} position={Position.Left} id="in-left" />
        <Handle className="flow-handle" type={getFlowHandleDirection('right')} position={Position.Right} id="out-right" />
        <Handle className="flow-handle" type={getFlowHandleDirection('top')} position={Position.Top} id="out-top" />
        <Handle className="flow-handle" type={getFlowHandleDirection('bottom')} position={Position.Bottom} id="in-bottom" />
      </>}
      <div className="flow-node-shape">
        {data.linkedDiagramId && (
          <button
            type="button"
            className="subprocess-open nodrag nopan"
            title={`Abrir subprocesso: ${data.label}`}
            aria-label={`Abrir subprocesso ${data.label}`}
            onClick={(event) => { event.stopPropagation(); data.onOpen(data.linkedDiagramId!); }}
          >
            <Network size={15} aria-hidden="true" />
            <span>Subfluxo</span>
            <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        )}
        <div className={`flow-node-copy${data.kind === 'text' ? ' free-text-copy' : ''}`} style={textStyle} onDoubleClick={(event) => { event.stopPropagation(); setEditing(true); }}>
          {editing ? (
            <input
              ref={input}
              className="node-label-input nodrag nopan"
              aria-label="Texto do bloco"
              style={textStyle}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => finish(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); finish(true); }
                if (event.key === 'Escape') { event.preventDefault(); finish(false); }
              }}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <div className="flow-node-label" title="Dê um duplo clique para editar" style={data.kind === 'text' ? {
              color: data.textColor ?? '#253a2d', fontSize: `${data.fontSize ?? 18}px`,
              fontWeight: data.bold ? 700 : 500, textAlign: data.textAlign ?? 'center',
            } : undefined}>{data.label}</div>
          )}
          {data.subtitle && <div className="flow-node-subtitle">{data.subtitle}</div>}
          <span className="sr-only">{titles[data.kind]}</span>
        </div>
      </div>
      {selected && <button
        type="button"
        className="node-context-trigger nodrag nopan"
        aria-label="Ações do bloco"
        title="Ações do bloco"
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          const element = event.currentTarget.parentElement?.getBoundingClientRect();
          if (!element) return;
          data.onOpenMenu(
            id,
            { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
            { left: element.left, right: element.right, top: element.top, bottom: element.bottom },
          );
        }}
      ><MoreHorizontal size={19} aria-hidden="true" /></button>}
    </div>
  );
}
