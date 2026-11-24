import type { Diagram, FlowEdge, FlowNode, NodeKind } from './domain';

export type ConnectionNode = Pick<FlowNode, 'id' | 'kind'> | { id: string; data: Pick<FlowNode, 'kind'> };

export function getConnectedNodeKinds(): Exclude<NodeKind, 'text'>[] {
  return ['process', 'decision', 'startEnd', 'inputOutput', 'note'];
}

export function shouldRenderHandles(kind: NodeKind): boolean {
  return kind !== 'text';
}

export function isTextConnection(nodes: readonly ConnectionNode[], sourceId: string, targetId: string): boolean {
  return nodes.some((node) => (node.id === sourceId || node.id === targetId)
    && ('data' in node ? node.data.kind : node.kind) === 'text');
}

export function canCreateConnectedEdge(targetKind: NodeKind, sourceKind?: NodeKind): boolean {
  return targetKind !== 'text' && sourceKind !== 'text';
}

export function canConvertNodeToText(nodeId: string, edges: readonly Pick<FlowEdge, 'source' | 'target'>[]): boolean {
  return !edges.some((edge) => edge.source === nodeId || edge.target === nodeId);
}

export function removeTextConnectedEdges(diagram: Diagram): { diagram: Diagram; removedEdges: FlowEdge[] } {
  const textNodeIds = new Set(diagram.nodes.filter((node) => node.kind === 'text').map((node) => node.id));
  const removedEdges = diagram.edges.filter((edge) => textNodeIds.has(edge.source) || textNodeIds.has(edge.target));
  return {
    diagram: removedEdges.length
      ? { ...diagram, edges: diagram.edges.filter((edge) => !textNodeIds.has(edge.source) && !textNodeIds.has(edge.target)) }
      : diagram,
    removedEdges,
  };
}
