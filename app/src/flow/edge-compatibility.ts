import type { FlowEdge } from '../domain';

/**
 * Legacy target-to-target edges have the same serialized handles as valid
 * modern edges. Without explicit provenance, swapping endpoints can silently
 * corrupt valid saved diagrams, so hydration preserves the serialized edge.
 */
export function normalizeLegacyTargetToTargetEdge(edge: FlowEdge): FlowEdge {
  return edge;
}
