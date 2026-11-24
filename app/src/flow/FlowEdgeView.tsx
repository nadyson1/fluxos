import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, type Edge, type EdgeProps } from '@xyflow/react';

export type FlowEdgeData = {
  onRename: (id: string, label: string) => void;
  onEditingChange: (id: string, editing: boolean) => void;
  onOpenMenu: (id: string, anchor: { left: number; right: number; top: number; bottom: number }) => void;
  labelText: string;
  lineStyle: 'smoothstep' | 'bezier' | 'straight';
  editingLabel: boolean;
};
export type CanvasEdge = Edge<FlowEdgeData, 'flowEdge'>;

export function FlowEdgeView(props: EdgeProps<CanvasEdge>) {
  const pathProps = {
    sourceX: props.sourceX, sourceY: props.sourceY, targetX: props.targetX, targetY: props.targetY,
    sourcePosition: props.sourcePosition, targetPosition: props.targetPosition,
  };
  const [path, labelX, labelY] = props.data?.lineStyle === 'straight'
    ? getStraightPath(pathProps)
    : props.data?.lineStyle === 'bezier'
      ? getBezierPath(pathProps)
      : getSmoothStepPath({ ...pathProps, borderRadius: 14 });
  const [draft, setDraft] = useState(props.data?.labelText ?? '');
  const cancelled = useRef(false);
  const saved = useRef(false);
  const editing = Boolean(props.data?.editingLabel);
  useEffect(() => {
    setDraft(props.data?.labelText ?? '');
    if (editing) { cancelled.current = false; saved.current = false; }
  }, [editing, props.data?.labelText]);
  const save = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    if (saved.current) return;
    saved.current = true;
    props.data?.onRename(props.id, draft.trim());
    props.data?.onEditingChange(props.id, false);
  };
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} interactionWidth={20} />
      <EdgeLabelRenderer>
        <div className={`edge-label nodrag nopan${props.selected ? ' is-selected' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
          {editing ? (
            <form onSubmit={(event) => { event.preventDefault(); save(); }}>
              <input
                aria-label="Rótulo da conexão"
                autoFocus
                value={draft}
                placeholder="Sim, Não…"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={save}
                onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; setDraft(props.data?.labelText ?? ''); props.data?.onEditingChange(props.id, false); } }}
              />
            </form>
          ) : (
            <button
              type="button"
              aria-label={props.data?.labelText ? `Editar rótulo ${props.data.labelText}` : 'Adicionar rótulo à conexão'}
              onClick={() => props.data?.onEditingChange(props.id, true)}
              className={props.data?.labelText ? '' : 'edge-label-empty'}
            >{props.data?.labelText || '＋'}</button>
          )}
          {props.selected && !editing && <button
            type="button"
            className="edge-context-trigger"
            aria-label="Ações da conexão"
            title="Ações da conexão"
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              props.data?.onOpenMenu(props.id, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
            }}
          ><MoreHorizontal size={18} aria-hidden="true" /></button>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
