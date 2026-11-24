import type { FlowEdge } from '../domain';

const LEGACY_TARGET_HANDLES = new Set(['in-left', 'in-bottom']);

/**
 * Before every anchor became bidirectional, React Flow normalized a drag that
 * started on one of these target handles in reverse. Such target-to-target
 * edges were persisted even though React Flow could not render them. Swap the
 * endpoints when restoring them so the saved direction matches the original
 * gesture. Existing valid edges are returned unchanged.
 */
export function normalizeLegacyTargetToTargetEdge(edge: FlowEdge): FlowEdge {
  if (
    edge.sourceHandle && edge.targetHandle &&
    LEGACY_TARGET_HANDLES.has(edge.sourceHandle) && LEGACY_TARGET_HANDLES.has(edge.targetHandle)
  ) {
    return {
      ...edge,
      source: edge.target,
      target: edge.source,
      sourceHandle: edge.targetHandle,
      targetHandle: edge.sourceHandle,
    };
  }
  return edge;
}
