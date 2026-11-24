import {
  addEdge, Background, BackgroundVariant, ConnectionMode,
  MarkerType, MiniMap, ReactFlow, ReactFlowProvider, reconnectEdge,
  getNodesBounds, useReactFlow, useReactFlowStoreApi, useViewport, type Connection, type EdgeChangeset, type NodeChangeset, type OnConnectEnd,
} from '@xyflow/react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Maximize2, Minus, Plus } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Diagram, FlowEdge, FlowNode, NodeKind } from '../domain';
import { makeNode } from '../repository';
import { FlowEdgeView, type CanvasEdge, type FlowEdgeData } from './FlowEdgeView';
import { FlowNodeView, type CanvasNode, type FlowNodeData } from './FlowNodeView';
import { getLooseConnectionInsertTarget } from './connection-insert';
import { calculatePinchViewport, requiresCustomPinch, shouldReleaseTouchSnapshot, updatePinchGesture, type PinchPoint, type PinchViewport } from './pinch-gesture';
import { normalizeLegacyTargetToTargetEdge } from './edge-compatibility';
import type { EditorTool } from '../components/ToolRail';
import { ProcessTree } from '../components/ProcessTree';

type MenuState = {
  x: number;
  y: number;
  nodeId?: string;
  edgeId?: string;
  addAt?: { x: number; y: number };
  sourceId?: string;
  anchorRect?: { left: number; right: number; top: number; bottom: number };
  elementRect?: { left: number; right: number; top: number; bottom: number };
};

export type FlowCanvasHandle = {
  undo: () => void;
  redo: () => void;
  addNodeAt: (kind: NodeKind, clientX: number, clientY: number) => void;
  focusNode: (nodeId: string) => void;
  flushSave: () => Promise<void>;
};

type Props = {
  diagram: Diagram;
  diagrams: Diagram[];
  activeTool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  onSave: (diagram: Diagram) => Promise<void>;
  onNavigate: (diagramId: string) => void;
  onRequestSubprocess: (ownerNodeId: string | null, suggestedName: string) => void;
  onDeleteNode: (nodeId: string) => Promise<void>;
  treeOpen: boolean;
  onTreeOpenChange: (open: boolean) => void;
  focusNodeId?: string;
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void;
};

type Snapshot = { nodes: FlowNode[]; edges: FlowEdge[] };
type ActivePinchGesture = {
  touchIds: [number, number];
  startDistance: number;
  startCenter: PinchPoint;
  startViewport: PinchViewport;
};
type TouchInteractionSnapshot = {
  nodes: Map<string, { position: { x: number; y: number }; selected: boolean }>;
  edges: Map<string, boolean>;
};
const nodeTypes = { flowBlock: FlowNodeView };
const edgeTypes = { flowEdge: FlowEdgeView };
const textColors = [
  { name: 'Verde escuro', value: '#253a2d' },
  { name: 'Verde', value: '#3f7656' },
  { name: 'Âmbar', value: '#a87917' },
  { name: 'Terracota', value: '#8d3d33' },
  { name: 'Azul', value: '#445c85' },
];

function serializeNodes(nodes: CanvasNode[]): FlowNode[] {
  return nodes.map(({ id, position, data }) => ({
    id, position: { x: position.x, y: position.y }, kind: data.kind, label: data.label,
    ...(data.subtitle ? { subtitle: data.subtitle } : {}), ...(data.linkedDiagramId ? { linkedDiagramId: data.linkedDiagramId } : {}),
    ...(data.fontSize !== undefined ? { fontSize: data.fontSize } : {}),
    ...(data.bold !== undefined ? { bold: data.bold } : {}),
    ...(data.textAlign ? { textAlign: data.textAlign } : {}),
    ...(data.textColor ? { textColor: data.textColor } : {}),
  }));
}

function serializeEdges(edges: CanvasEdge[]): FlowEdge[] {
  return edges.map(({ id, source, target, sourceHandle, targetHandle, data }) => ({
    id, source, target, ...(sourceHandle ? { sourceHandle } : {}), ...(targetHandle ? { targetHandle } : {}),
    ...(data?.labelText ? { label: data.labelText } : {}), style: data?.lineStyle ?? 'smoothstep',
  }));
}

const emptyNodeCallbacks = (
  node: FlowNode,
  onEditLabel: FlowNodeData['onEditLabel'],
  onOpen: FlowNodeData['onOpen'],
  onOpenMenu: FlowNodeData['onOpenMenu'],
): CanvasNode => ({
  id: node.id, type: 'flowBlock', position: { ...node.position }, data: { ...node, onEditLabel, onOpen, onOpenMenu },
});

function makeCanvasEdge(
  edge: FlowEdge,
  onRename: FlowEdgeData['onRename'],
  onEditingChange: FlowEdgeData['onEditingChange'],
  onOpenMenu: FlowEdgeData['onOpenMenu'],
): CanvasEdge {
  const compatibleEdge = normalizeLegacyTargetToTargetEdge(edge);
  return {
    id: compatibleEdge.id, source: compatibleEdge.source, target: compatibleEdge.target,
    sourceHandle: compatibleEdge.sourceHandle, targetHandle: compatibleEdge.targetHandle,
    type: 'flowEdge', markerEnd: { type: MarkerType.ArrowClosed, color: '#2e6647' },
    style: { stroke: '#2e6647', strokeWidth: 2 },
    data: {
      onRename, onEditingChange, onOpenMenu, labelText: compatibleEdge.label ?? '',
      lineStyle: compatibleEdge.style ?? 'smoothstep', editingLabel: false,
    }, reconnectable: true,
  };
}

function clientPoint(event: MouseEvent | TouchEvent) {
  if ('changedTouches' in event) {
    const touch = event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : { x: 240, y: 180 };
  }
  return { x: event.clientX, y: event.clientY };
}

const FlowCanvasInner = forwardRef<FlowCanvasHandle, Props>(function FlowCanvasInner(props, forwardedRef) {
  const { diagram } = props;
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  const flowStore = useReactFlowStoreApi<CanvasNode, CanvasEdge>();
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const viewport = useViewport();
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editingMenuText, setEditingMenuText] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [menuText, setMenuText] = useState('');
  const [zoomText, setZoomText] = useState('100%');
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [contextPosition, setContextPosition] = useState<{ left: number; top: number } | null>(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const diagramRef = useRef(diagram);
  const canvasRegionRef = useRef<HTMLDivElement>(null);
  const pinchGestureActiveRef = useRef(false);
  const pinchGestureOccurredRef = useRef(false);
  const activePinchGestureRef = useRef<ActivePinchGesture | null>(null);
  const touchInteractionSnapshotRef = useRef<TouchInteractionSnapshot | null>(null);
  const suppressClickUntilRef = useRef(0);
  const treeViewportTransformRef = useRef<{ scale: number; translateX: number; translateY: number } | null>(null);
  const historyRef = useRef<Snapshot[]>([]);
  const redoRef = useRef<Snapshot[]>([]);
  const persistTimer = useRef<number | undefined>(undefined);
  const persistNowRef = useRef<() => Promise<void>>(async () => {});

  nodesRef.current = nodes;
  edgesRef.current = edges;
  diagramRef.current = diagram;

  const updateHistoryState = useCallback(() => {
    const value = { undo: historyRef.current.length, redo: redoRef.current.length };
    props.onHistoryChange(value.undo > 0, value.redo > 0);
  }, [props.onHistoryChange]);

  const setNodeLabel = useCallback((id: string, label: string) => {
    historyRef.current.push({ nodes: serializeNodes(nodesRef.current), edges: serializeEdges(edgesRef.current) });
    redoRef.current = [];
    setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, label } } : node));
    updateHistoryState();
  }, [updateHistoryState]);

  const setEdgeLabel = useCallback((id: string, label: string) => {
    historyRef.current.push({ nodes: serializeNodes(nodesRef.current), edges: serializeEdges(edgesRef.current) });
    redoRef.current = [];
    setEdges((current) => current.map((edge) => edge.id === id ? { ...edge, data: { ...edge.data!, labelText: label } } : edge));
    updateHistoryState();
  }, [updateHistoryState]);

  const setEdgeEditing = useCallback((id: string, editingLabel: boolean) => {
    setEdges((current) => current.map((edge) => edge.id === id
      ? { ...edge, data: { ...edge.data!, editingLabel } }
      : edge));
  }, []);

  const openNodeActions = useCallback((
    nodeId: string,
    anchorRect: NonNullable<MenuState['anchorRect']>,
    elementRect: NonNullable<MenuState['elementRect']>,
  ) => {
    setEditingMenuText(false);
    setContextPosition(null);
    setMenu({ x: anchorRect.right + 6, y: anchorRect.top, nodeId, anchorRect, elementRect });
  }, []);

  const openEdgeActions = useCallback((edgeId: string, anchorRect: NonNullable<MenuState['anchorRect']>) => {
    setEditingMenuText(false);
    setContextPosition(null);
    setMenu({ x: anchorRect.right + 6, y: anchorRect.top, edgeId, anchorRect });
  }, []);

  const openDiagram = useCallback(async (diagramId: string) => {
    await persistNowRef.current();
    props.onNavigate(diagramId);
  }, [props.onNavigate]);

  const nodeOpen = useCallback((diagramId: string) => { void openDiagram(diagramId); }, [openDiagram]);

  const restoreSnapshot = useCallback((snapshot: Snapshot) => {
    setNodes(snapshot.nodes.map((node) => emptyNodeCallbacks(node, setNodeLabel, nodeOpen, openNodeActions)));
    setEdges(snapshot.edges.map((edge) => makeCanvasEdge(edge, setEdgeLabel, setEdgeEditing, openEdgeActions)));
  }, [nodeOpen, openEdgeActions, openNodeActions, setEdgeEditing, setEdgeLabel, setNodeLabel]);

  const recordHistory = useCallback(() => {
    historyRef.current = [...historyRef.current, { nodes: serializeNodes(nodesRef.current), edges: serializeEdges(edgesRef.current) }].slice(-60);
    redoRef.current = [];
    updateHistoryState();
  }, [updateHistoryState]);

  const updateTextFormat = useCallback((nodeId: string, patch: Partial<Pick<FlowNode, 'fontSize' | 'bold' | 'textAlign' | 'textColor'>>) => {
    recordHistory();
    setNodes((current) => current.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, ...patch } }
      : node));
  }, [recordHistory]);

  const flushSave = useCallback(async () => {
    if (persistTimer.current !== undefined) window.clearTimeout(persistTimer.current);
    persistTimer.current = undefined;
    const current = diagramRef.current;
    const treeTransform = treeViewportTransformRef.current;
    const savedViewport = treeTransform ? {
      x: (viewport.x - treeTransform.translateX) / treeTransform.scale,
      y: (viewport.y - treeTransform.translateY) / treeTransform.scale,
      zoom: viewport.zoom / treeTransform.scale,
    } : { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    const outgoing: Diagram = {
      ...current,
      nodes: serializeNodes(nodesRef.current),
      edges: serializeEdges(edgesRef.current),
      viewport: savedViewport,
      updatedAt: new Date().toISOString(),
    };
    await props.onSave(outgoing);
  }, [props.onSave, viewport.x, viewport.y, viewport.zoom]);
  persistNowRef.current = flushSave;

  useImperativeHandle(forwardedRef, () => ({
    undo: () => {
      const previous = historyRef.current.pop();
      if (!previous) return;
      redoRef.current.push({ nodes: serializeNodes(nodesRef.current), edges: serializeEdges(edgesRef.current) });
      restoreSnapshot(previous);
      updateHistoryState();
    },
    redo: () => {
      const next = redoRef.current.pop();
      if (!next) return;
      historyRef.current.push({ nodes: serializeNodes(nodesRef.current), edges: serializeEdges(edgesRef.current) });
      restoreSnapshot(next);
      updateHistoryState();
    },
    addNodeAt: (kind, clientX, clientY) => {
      const position = flowRef.current.screenToFlowPosition({ x: clientX, y: clientY });
      recordHistory();
      setNodes((current) => [...current, emptyNodeCallbacks(makeNode(kind, position.x, position.y), setNodeLabel, nodeOpen, openNodeActions)]);
      props.onToolChange('select');
    },
    focusNode: (nodeId) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (!node) return;
      setNodes((current) => current.map((item) => ({ ...item, selected: item.id === nodeId })));
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const zoom = Math.max(flowRef.current.getZoom(), 0.9);
        void flowRef.current.fitView({ nodes: [{ id: nodeId }], padding: 0.45, minZoom: zoom, maxZoom: zoom, duration: 280 });
      }));
    },
    flushSave,
  }), [flushSave, nodeOpen, openNodeActions, props.onToolChange, recordHistory, restoreSnapshot, setNodeLabel, updateHistoryState, viewport.zoom]);

  useEffect(() => {
    setNodes(diagram.nodes.map((node) => emptyNodeCallbacks(node, setNodeLabel, nodeOpen, openNodeActions)));
    setEdges(diagram.edges.map((edge) => makeCanvasEdge(edge, setEdgeLabel, setEdgeEditing, openEdgeActions)));
    historyRef.current = [];
    redoRef.current = [];
    void flowRef.current.setViewport(diagram.viewport ?? { x: 70, y: 80, zoom: 0.9 });
    updateHistoryState();
  }, [diagram.id, nodeOpen, openEdgeActions, openNodeActions, setEdgeEditing, setEdgeLabel, setNodeLabel, updateHistoryState]);

  useEffect(() => {
    const region = canvasRegionRef.current;
    if (!region) return;
    const existingTransform = treeViewportTransformRef.current;
    if (!props.treeOpen) {
      if (!existingTransform) return;
      treeViewportTransformRef.current = null;
      const current = flowRef.current.getViewport();
      void flowRef.current.setViewport({
        x: (current.x - existingTransform.translateX) / existingTransform.scale,
        y: (current.y - existingTransform.translateY) / existingTransform.scale,
        zoom: current.zoom / existingTransform.scale,
      }, { duration: 180 });
      return;
    }
    if (existingTransform || !nodes.length) return;
    const tree = region.querySelector<HTMLElement>('.process-tree');
    const bounds = getNodesBounds(nodes);
    const current = flowRef.current.getViewport();
    if (!tree || bounds.width <= 0 || bounds.height <= 0 || current.zoom <= 0) return;
    const panelLeft = tree.offsetLeft;
    const panelRight = panelLeft + tree.clientWidth;
    const contentLeft = current.x + bounds.x * current.zoom;
    const contentRight = current.x + (bounds.x + bounds.width) * current.zoom;
    if (contentLeft >= panelRight || contentRight <= panelLeft) return;

    const desiredLeft = panelRight + 16;
    const availableWidth = Math.max(120, region.clientWidth - desiredLeft - 16);
    const availableHeight = Math.max(120, region.clientHeight - 32);
    const scale = Math.max(0.6, Math.min(
      1,
      availableWidth / (bounds.width * current.zoom),
      availableHeight / (bounds.height * current.zoom),
    ));
    const zoom = current.zoom * scale;
    const target = {
      x: desiredLeft - bounds.x * zoom,
      y: (region.clientHeight - bounds.height * zoom) / 2 - bounds.y * zoom,
      zoom,
    };
    const translateX = target.x - current.x * scale;
    const translateY = target.y - current.y * scale;
    treeViewportTransformRef.current = { scale, translateX, translateY };
    void flowRef.current.setViewport(target, { duration: 180 });
  }, [diagram.id, nodes, props.treeOpen]);

  useEffect(() => {
    const value = Math.round(viewport.zoom * 100);
    setZoomText(`${value}%`);
  }, [viewport.zoom]);

  useEffect(() => {
    if (persistTimer.current !== undefined) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => { void flushSave(); }, 480);
    return () => { if (persistTimer.current !== undefined) window.clearTimeout(persistTimer.current); };
  }, [nodes, edges, diagram.id, flushSave]);

  useEffect(() => () => {
    if (persistTimer.current !== undefined) window.clearTimeout(persistTimer.current);
  }, []);

  useEffect(() => {
    const region = canvasRegionRef.current;
    if (!region) return;

    const getPoint = (touch: Touch, bounds: DOMRect): PinchPoint => ({
      x: touch.clientX - bounds.left,
      y: touch.clientY - bounds.top,
    });
    const getPair = (event: TouchEvent, gesture: ActivePinchGesture, bounds: DOMRect) => {
      const first = Array.from(event.touches).find((touch) => touch.identifier === gesture.touchIds[0]);
      const second = Array.from(event.touches).find((touch) => touch.identifier === gesture.touchIds[1]);
      if (!first || !second) return null;
      const a = getPoint(first, bounds);
      const b = getPoint(second, bounds);
      return {
        distance: Math.hypot(b.x - a.x, b.y - a.y),
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    };
    const stopNativeGesture = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };
    const isPanBlocked = (touch: Touch) => touch.target instanceof Element && Boolean(touch.target.closest('.nopan'));
    const restoreTouchInteraction = () => {
      const snapshot = touchInteractionSnapshotRef.current;
      if (!snapshot) return;
      setNodes((current) => current.map((node) => {
        const original = snapshot.nodes.get(node.id);
        if (!original) return node;
        if (node.position.x === original.position.x && node.position.y === original.position.y && node.selected === original.selected) return node;
        return { ...node, position: original.position, selected: original.selected };
      }));
      setEdges((current) => current.map((edge) => {
        const wasSelected = snapshot.edges.get(edge.id);
        return wasSelected === undefined || edge.selected === wasSelected ? edge : { ...edge, selected: wasSelected };
      }));
      touchInteractionSnapshotRef.current = null;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (pinchGestureActiveRef.current) {
        stopNativeGesture(event);
        return;
      }
      if (event.touches.length === 1 && !touchInteractionSnapshotRef.current) {
        touchInteractionSnapshotRef.current = {
          nodes: new Map(nodesRef.current.map((node) => [node.id, { position: { ...node.position }, selected: Boolean(node.selected) }])),
          edges: new Map(edgesRef.current.map((edge) => [edge.id, Boolean(edge.selected)])),
        };
      }
      if (event.touches.length < 2) return;

      restoreTouchInteraction();
      const touches = Array.from(event.touches);
      const connectionActive = flowStore.connectionStore.getState().connection.inProgress;
      if (!requiresCustomPinch(event.touches.length, touches.some(isPanBlocked) || connectionActive)) return;

      const [first, second] = touches;
      const bounds = region.getBoundingClientRect();
      const a = getPoint(first, bounds);
      const b = getPoint(second, bounds);
      const startDistance = Math.hypot(b.x - a.x, b.y - a.y);
      if (startDistance <= 0) return;

      activePinchGestureRef.current = {
        touchIds: [first.identifier, second.identifier],
        startDistance,
        startCenter: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        startViewport: flowRef.current.getViewport(),
      };
      pinchGestureActiveRef.current = true;
      pinchGestureOccurredRef.current = true;
      flowStore.optionsStore.getState().cancelConnection();
      stopNativeGesture(event);
    };

    const onTouchMove = (event: TouchEvent) => {
      const gesture = activePinchGestureRef.current;
      if (!gesture) return;
      stopNativeGesture(event);
      const pair = getPair(event, gesture, region.getBoundingClientRect());
      if (!pair) return;
      const viewport = calculatePinchViewport({
        startViewport: gesture.startViewport,
        startCenter: gesture.startCenter,
        currentCenter: pair.center,
        startDistance: gesture.startDistance,
        currentDistance: pair.distance,
        minZoom: 0.2,
        maxZoom: 2.5,
      });
      void flowRef.current.setViewport(viewport, { duration: 0 });
    };

    const finishPinchIfReleased = (event: TouchEvent) => {
      if (shouldReleaseTouchSnapshot(event.touches.length)) touchInteractionSnapshotRef.current = null;
      if (!pinchGestureActiveRef.current) return;
      pinchGestureActiveRef.current = updatePinchGesture(true, event.touches.length);
      if (event.touches.length !== 0) return;
      activePinchGestureRef.current = null;
      suppressClickUntilRef.current = Date.now() + 500;
      window.setTimeout(() => { pinchGestureOccurredRef.current = false; }, 0);
    };

    const suppressResidualClick = (event: MouseEvent) => {
      if (Date.now() >= suppressClickUntilRef.current) return;
      event.preventDefault();
      event.stopPropagation();
    };

    region.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    region.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    region.addEventListener('touchend', finishPinchIfReleased, { capture: true, passive: false });
    region.addEventListener('touchcancel', finishPinchIfReleased, { capture: true, passive: false });
    region.addEventListener('click', suppressResidualClick, true);
    return () => {
      region.removeEventListener('touchstart', onTouchStart, true);
      region.removeEventListener('touchmove', onTouchMove, true);
      region.removeEventListener('touchend', finishPinchIfReleased, true);
      region.removeEventListener('touchcancel', finishPinchIfReleased, true);
      region.removeEventListener('click', suppressResidualClick, true);
    };
  }, [flowStore, setEdges, setNodes]);

  useEffect(() => {
    if (!props.focusNodeId || !nodes.length) return;
    const node = nodes.find((item) => item.id === props.focusNodeId);
    if (!node) return;
    setNodes((current) => current.map((item) => ({ ...item, selected: item.id === props.focusNodeId })));
    const timeout = window.setTimeout(() => {
      const zoom = Math.max(flowRef.current.getZoom(), 0.9);
      void flowRef.current.fitView({ nodes: [{ id: node.id }], padding: 0.45, minZoom: zoom, maxZoom: zoom, duration: 280 });
    }, 240);
    return () => window.clearTimeout(timeout);
  }, [props.focusNodeId, nodes.length]);

  const onNodesChange = useCallback((changes: NodeChangeset<CanvasNode>) => setNodes((current) => changes.applyTo(current)), []);
  const onEdgesChange = useCallback((changes: EdgeChangeset<CanvasEdge>) => setEdges((current) => changes.applyTo(current)), []);

  const addNode = useCallback((kind: NodeKind, position: { x: number; y: number }, sourceId?: string) => {
    recordHistory();
    const node = makeNode(kind, position.x, position.y);
    setNodes((current) => [...current, emptyNodeCallbacks(node, setNodeLabel, nodeOpen, openNodeActions)]);
    if (sourceId) {
      const edge = makeCanvasEdge({ id: crypto.randomUUID(), source: sourceId, target: node.id, style: 'smoothstep' }, setEdgeLabel, setEdgeEditing, openEdgeActions);
      setEdges((current) => [...current, edge]);
    }
    props.onToolChange('select');
    setMenu(null);
  }, [nodeOpen, openEdgeActions, openNodeActions, props.onToolChange, recordHistory, setEdgeEditing, setEdgeLabel, setNodeLabel]);

  const onPaneClick = useCallback((event: MouseEvent | ReactMouseEvent<Element, MouseEvent>) => {
    if (menu) { setMenu(null); return; }
    if (!['process', 'decision', 'startEnd', 'inputOutput', 'note', 'text'].includes(props.activeTool)) return;
    const position = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addNode(props.activeTool as NodeKind, position);
  }, [addNode, menu, props.activeTool]);

  const onConnect = useCallback((connection: Connection) => {
    if (pinchGestureOccurredRef.current) return;
    recordHistory();
    setEdges((current) => addEdge(makeCanvasEdge({
      id: crypto.randomUUID(), source: connection.source!, target: connection.target!,
      sourceHandle: connection.sourceHandle ?? undefined, targetHandle: connection.targetHandle ?? undefined, style: 'smoothstep',
    }, setEdgeLabel, setEdgeEditing, openEdgeActions), current));
  }, [openEdgeActions, recordHistory, setEdgeEditing, setEdgeLabel]);

  const onConnectEnd = useCallback<OnConnectEnd>((event, state) => {
    if (pinchGestureOccurredRef.current) return;
    const insertTarget = getLooseConnectionInsertTarget(state);
    if (!insertTarget) return;
    const point = clientPoint(event);
    setMenu({ x: point.x, y: point.y, addAt: insertTarget.position, sourceId: insertTarget.sourceId });
  }, []);

  const onReconnect = useCallback((oldEdge: CanvasEdge, newConnection: Connection) => {
    recordHistory();
    setEdges((current) => reconnectEdge(oldEdge, newConnection, current));
  }, [recordHistory]);

  const onNodeDragStart = useCallback(() => recordHistory(), [recordHistory]);

  const onNodeContextMenu = useCallback((event: ReactMouseEvent, node: CanvasNode) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }, []);
  const onEdgeContextMenu = useCallback((event: ReactMouseEvent, edge: CanvasEdge) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id });
  }, []);
  const onPaneContextMenu = useCallback((event: MouseEvent | ReactMouseEvent<Element, MouseEvent>) => {
    event.preventDefault();
    const position = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setMenu({ x: event.clientX, y: event.clientY, addAt: position });
  }, []);

  const onNodeDragStop = useCallback(() => { void flushSave(); }, [flushSave]);

  const activeNode = menu?.nodeId ? nodes.find((node) => node.id === menu.nodeId) : undefined;
  const activeEdge = menu?.edgeId ? edges.find((edge) => edge.id === menu.edgeId) : undefined;
  useLayoutEffect(() => {
    if (!menu || !contextMenuRef.current) return;
    const menuBounds = contextMenuRef.current.getBoundingClientRect();
    let preferredX = menu.x;
    let preferredY = menu.y;
    if (menu.anchorRect) {
      const { right: anchorRight, top: anchorTop } = menu.anchorRect;
      const elementBounds = menu.elementRect ?? menu.anchorRect;
      const roomRight = window.innerWidth - elementBounds.right;
      const roomLeft = elementBounds.left;
      if (roomRight >= menuBounds.width + 8) {
        preferredX = elementBounds.right + 6;
        preferredY = anchorTop;
      } else if (roomLeft >= menuBounds.width + 8) {
        preferredX = elementBounds.left - menuBounds.width - 6;
        preferredY = anchorTop;
      } else {
        preferredX = anchorRight - menuBounds.width;
        const roomBelow = window.innerHeight - elementBounds.bottom;
        const roomAbove = elementBounds.top;
        if (roomBelow >= menuBounds.height + 8) preferredY = elementBounds.bottom + 6;
        else if (roomAbove >= menuBounds.height + 8) preferredY = elementBounds.top - menuBounds.height - 6;
        else preferredY = anchorTop;
      }
    }
    setContextPosition({
      left: Math.max(8, Math.min(preferredX, window.innerWidth - menuBounds.width - 8)),
      top: Math.max(8, Math.min(preferredY, window.innerHeight - menuBounds.height - 8)),
    });
  }, [menu, editingMenuText]);
  const contextStyle = menu ? {
    left: contextPosition?.left ?? Math.max(8, Math.min(menu.x, window.innerWidth - 228)),
    top: contextPosition?.top ?? Math.max(8, Math.min(menu.y, window.innerHeight - 300)),
  } : undefined;

  const duplicateNode = () => {
    if (!activeNode) return;
    recordHistory();
    const { id: _id, position, data } = activeNode;
    const duplicate: FlowNode = {
      id: crypto.randomUUID(), kind: data.kind, label: data.label, position: { x: position.x + 38, y: position.y + 38 },
      ...(data.subtitle ? { subtitle: data.subtitle } : {}),
      ...(data.fontSize !== undefined ? { fontSize: data.fontSize } : {}),
      ...(data.bold !== undefined ? { bold: data.bold } : {}),
      ...(data.textAlign ? { textAlign: data.textAlign } : {}),
      ...(data.textColor ? { textColor: data.textColor } : {}),
    };
    setNodes((current) => [...current, emptyNodeCallbacks(duplicate, setNodeLabel, nodeOpen, openNodeActions)]);
    setMenu(null);
  };

  const deleteNode = async () => {
    if (!activeNode) return;
    recordHistory();
    await props.onDeleteNode(activeNode.id);
    setNodes((current) => current.filter((node) => node.id !== activeNode.id));
    setEdges((current) => current.filter((edge) => edge.source !== activeNode.id && edge.target !== activeNode.id));
    setMenu(null);
  };

  const changeNodeKind = (kind: NodeKind) => {
    if (!activeNode) return;
    recordHistory();
    setNodes((current) => current.map((node) => node.id === activeNode.id ? {
      ...node,
      data: { ...node.data, kind, ...(kind === 'text' ? {
        fontSize: node.data.fontSize ?? 18,
        bold: node.data.bold ?? false,
        textAlign: node.data.textAlign ?? 'center',
        textColor: node.data.textColor ?? '#253a2d',
      } : {}) },
    } : node));
    setMenu(null);
  };

  const deleteEdge = () => {
    if (!activeEdge) return;
    recordHistory();
    setEdges((current) => current.filter((edge) => edge.id !== activeEdge.id));
    setMenu(null);
  };

  const editEdgeLabel = () => {
    if (!activeEdge) return;
    setEdges((current) => current.map((edge) => edge.id === activeEdge.id
      ? { ...edge, data: { ...edge.data!, editingLabel: true } }
      : edge));
    setMenu(null);
  };

  const changeLabelFromMenu = () => {
    if (!activeNode) return;
    setMenuText([activeNode.data.label, activeNode.data.subtitle ?? ''].join('\n'));
    setEditingMenuText(true);
    setTimeout(() => document.querySelector<HTMLInputElement>('.context-edit-input')?.focus(), 0);
  };

  const saveMenuText = () => {
    if (!activeNode) return;
    const [label, ...subtitle] = menuText.split('\n');
    const cleanLabel = label.trim() || activeNode.data.label;
    recordHistory();
    setNodes((current) => current.map((node) => node.id === activeNode.id ? { ...node, data: { ...node.data, label: cleanLabel, subtitle: subtitle.join('\n').trim() || undefined } } : node));
    setEditingMenuText(false);
    setMenu(null);
  };

  const nodeTypesMemo = useMemo(() => nodeTypes, []);
  const edgeTypesMemo = useMemo(() => edgeTypes, []);

  return (
    <div
      ref={canvasRegionRef}
      className={`canvas-region${props.activeTool === 'connect' ? ' mode-connect' : ''}`}
      onClick={(event) => { if (event.target === event.currentTarget && menu) setMenu(null); }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypesMemo}
        edgeTypes={edgeTypesMemo}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onReconnect={onReconnect}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={onPaneClick}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={24}
        connectOnClick
        edgesReconnectable
        deleteKeyCode={null}
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
        panOnDrag
        panOnScroll={false}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={2.5}
        defaultViewport={diagram.viewport ?? { x: 70, y: 80, zoom: 0.9 }}
        forceColorMode="light"
        fitViewOptions={{ padding: 0.14 }}
        proOptions={{ hideAttribution: true }}
        aria-label="Canvas de fluxogramas"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="#d7e0d8" />
        {minimapOpen && <MiniMap position="bottom-right" pannable zoomable nodeStrokeWidth={2} maskColor="rgb(250 252 250 / 66%)" />}
      </ReactFlow>

      <div className="canvas-zoom" aria-label="Controles de zoom">
        <button type="button" className="icon-button" title="Diminuir zoom" aria-label="Diminuir zoom" onClick={() => void flowRef.current.zoomOut({ duration: 120 })}><Minus size={17} /></button>
        <button type="button" className="zoom-value" title="Ajustar zoom" onClick={() => void flowRef.current.fitView({ padding: 0.18, duration: 180 })}>{zoomText}</button>
        <button type="button" className="icon-button" title="Aumentar zoom" aria-label="Aumentar zoom" onClick={() => void flowRef.current.zoomIn({ duration: 120 })}><Plus size={17} /></button>
        <span className="zoom-divider" />
        <button type="button" className="icon-button" title="Ajustar ao conteúdo" aria-label="Ajustar ao conteúdo" onClick={() => void flowRef.current.fitView({ padding: 0.18, duration: 180 })}><Maximize2 size={16} /></button>
        <button type="button" className={`icon-button mini-toggle${minimapOpen ? ' is-active' : ''}`} title={minimapOpen ? 'Ocultar minimapa' : 'Mostrar minimapa'} aria-label={minimapOpen ? 'Ocultar minimapa' : 'Mostrar minimapa'} onClick={() => setMinimapOpen((value) => !value)}><AlignCenter size={16} /></button>
      </div>

      <ProcessTree open={props.treeOpen} diagrams={props.diagrams} currentId={diagram.id} onOpen={openDiagram} onClose={() => props.onTreeOpenChange(false)} onCreate={() => props.onRequestSubprocess(null, `${diagram.name} — subprocesso`)} />

      {menu && <>
        <button type="button" className="menu-dismiss" aria-label="Fechar menu" onClick={() => setMenu(null)} />
        <div ref={contextMenuRef} className="context-menu" style={contextStyle} role="menu" onContextMenu={(event) => event.preventDefault()}>
          {activeNode && <>
            {editingMenuText ? <form onSubmit={(event) => { event.preventDefault(); saveMenuText(); }} className="context-edit-form">
              <label>{activeNode.data.kind === 'text' ? 'Texto livre' : 'Texto do bloco'}<input className="context-edit-input" value={menuText.split('\n')[0] ?? ''} onChange={(event) => setMenuText(`${event.target.value}\n${menuText.split('\n').slice(1).join('\n')}`)} /></label>
              {activeNode.data.kind !== 'text' && <label>Subtítulo<input value={menuText.split('\n').slice(1).join('\n')} onChange={(event) => setMenuText(`${menuText.split('\n')[0] ?? ''}\n${event.target.value}`)} /></label>}
              <button className="button button-primary" type="submit">Salvar texto</button>
            </form> : <>
              <button type="button" role="menuitem" onClick={duplicateNode}>{activeNode.data.kind === 'text' ? 'Duplicar texto' : 'Duplicar bloco'}</button>
              <button type="button" role="menuitem" onClick={changeLabelFromMenu}>Editar texto</button>
              {activeNode.data.kind === 'text' && <div className="context-submenu text-format-menu">
                <span>Formatação do texto</span>
                <div className="text-format-size">
                  <button type="button" aria-label="Diminuir fonte" title="Diminuir fonte" disabled={(activeNode.data.fontSize ?? 18) <= 10} onClick={() => updateTextFormat(activeNode.id, { fontSize: Math.max(10, (activeNode.data.fontSize ?? 18) - 2) })}><Minus size={16} /></button>
                  <span>{activeNode.data.fontSize ?? 18} px</span>
                  <button type="button" aria-label="Aumentar fonte" title="Aumentar fonte" disabled={(activeNode.data.fontSize ?? 18) >= 96} onClick={() => updateTextFormat(activeNode.id, { fontSize: Math.min(96, (activeNode.data.fontSize ?? 18) + 2) })}><Plus size={16} /></button>
                  <button type="button" aria-label="Negrito" title="Negrito" aria-pressed={activeNode.data.bold ?? false} className={(activeNode.data.bold ?? false) ? 'is-pressed' : ''} onClick={() => updateTextFormat(activeNode.id, { bold: !(activeNode.data.bold ?? false) })}><Bold size={16} /></button>
                </div>
                <div className="text-format-align" aria-label="Alinhamento">
                  {([{ value: 'left', label: 'Alinhar à esquerda', icon: AlignLeft }, { value: 'center', label: 'Centralizar', icon: AlignCenter }, { value: 'right', label: 'Alinhar à direita', icon: AlignRight }] as const).map(({ value, label, icon: Icon }) => <button key={value} type="button" aria-label={label} title={label} aria-pressed={(activeNode.data.textAlign ?? 'center') === value} className={(activeNode.data.textAlign ?? 'center') === value ? 'is-pressed' : ''} onClick={() => updateTextFormat(activeNode.id, { textAlign: value })}><Icon size={16} /></button>)}
                </div>
                <div className="text-color-palette" aria-label="Cor do texto">
                  {textColors.map(({ name, value }) => <button key={value} type="button" aria-label={`Cor do texto: ${name}`} title={name} aria-pressed={(activeNode.data.textColor ?? '#253a2d') === value} className={(activeNode.data.textColor ?? '#253a2d') === value ? 'is-selected' : ''} style={{ backgroundColor: value }} onClick={() => updateTextFormat(activeNode.id, { textColor: value })} />)}
                </div>
              </div>}
              <label className="context-type-control"><span>Tipo do elemento</span><select aria-label="Tipo do elemento" value={activeNode.data.kind} onChange={(event) => changeNodeKind(event.target.value as NodeKind)}>{(['process', 'decision', 'startEnd', 'inputOutput', 'note', 'text'] as NodeKind[]).map((kind) => <option key={kind} value={kind}>{({ process: 'Processo', decision: 'Decisão', startEnd: 'Início / fim', inputOutput: 'Entrada / saída', note: 'Anotação', text: 'Texto livre' })[kind]}</option>)}</select></label>
              {activeNode.data.kind !== 'text' && <button type="button" role="menuitem" onClick={() => { props.onRequestSubprocess(activeNode.id, `${activeNode.data.label} — subprocesso`); setMenu(null); }}>Criar subprocesso</button>}
              {activeNode.data.linkedDiagramId && <button type="button" role="menuitem" onClick={() => { void openDiagram(activeNode.data.linkedDiagramId!); setMenu(null); }}>Abrir subprocesso</button>}
              <button type="button" role="menuitem" className="danger-action" onClick={() => { void deleteNode(); }}>Excluir bloco</button>
            </>}
          </>}
          {activeEdge && <>
            <button type="button" role="menuitem" onClick={editEdgeLabel}>Editar rótulo</button>
            {activeEdge.data?.labelText && <button type="button" role="menuitem" onClick={() => { setEdgeLabel(activeEdge.id, ''); setMenu(null); }}>Excluir rótulo</button>}
            <button type="button" role="menuitem" onClick={() => { setEdgeLabel(activeEdge.id, 'Sim'); setMenu(null); }}>Rótulo “Sim”</button>
            <button type="button" role="menuitem" onClick={() => { setEdgeLabel(activeEdge.id, 'Não'); setMenu(null); }}>Rótulo “Não”</button>
            <button type="button" role="menuitem" className="danger-action" onClick={deleteEdge}>Excluir conexão</button>
          </>}
          {menu.addAt && <>
            <p className="context-heading">Inserir bloco conectado</p>
            {(['process', 'decision', 'startEnd', 'inputOutput', 'note', 'text'] as NodeKind[]).map((kind) => <button key={kind} type="button" role="menuitem" onClick={() => addNode(kind, menu.addAt!, menu.sourceId)}>{({ process: 'Processo', decision: 'Decisão', startEnd: 'Início / fim', inputOutput: 'Entrada / saída', note: 'Anotação', text: 'Texto livre' })[kind]}</button>)}
          </>}
        </div>
      </>}
    </div>
  );
});

export const FlowCanvas = forwardRef<FlowCanvasHandle, Props>(function FlowCanvas(props, ref) {
  return <ReactFlowProvider><FlowCanvasInner {...props} ref={ref} /></ReactFlowProvider>;
});
