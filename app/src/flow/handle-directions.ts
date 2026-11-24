export type FlowHandleSide = 'left' | 'right' | 'top' | 'bottom';
export type FlowHandleDirection = 'source' | 'target';

/**
 * Loose connections allow every anchor to act as either endpoint. React Flow
 * resolves an edge's origin only from source handles, so each physical anchor
 * must be declared as a source to support dragging from any side.
 */
export function getFlowHandleDirection(_side: FlowHandleSide): FlowHandleDirection {
  return 'source';
}
