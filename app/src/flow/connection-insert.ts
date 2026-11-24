export type FinalConnectionDrop = {
  fromNode: { id: string } | null;
  fromHandle?: { id?: string | null; position?: 'left' | 'right' | 'top' | 'bottom' } | null;
  to: { x: number; y: number } | null;
  toNode: unknown | null;
  isValid: boolean | null;
};

export function getLooseConnectionInsertTarget(state: FinalConnectionDrop | null | undefined) {
  if (!state?.fromNode || !state.fromHandle?.id || state.toNode || state.isValid === true || !state.to) return null;
  return {
    sourceId: state.fromNode.id,
    sourceHandle: state.fromHandle.id,
    position: { x: state.to.x, y: state.to.y },
  };
}

const HANDLE_BY_POSITION = {
  left: 'in-left',
  right: 'out-right',
  top: 'out-top',
  bottom: 'in-bottom',
} as const;

const OPPOSITE_HANDLE = {
  'in-left': 'out-right',
  'out-right': 'in-left',
  'out-top': 'in-bottom',
  'in-bottom': 'out-top',
} as const;

export function getConnectionHandlesForNewNode(
  sourceHandle: string,
  sourcePosition: { x: number; y: number },
  targetPosition: { x: number; y: number },
) {
  const dx = targetPosition.x - sourcePosition.x;
  const dy = targetPosition.y - sourcePosition.y;
  const horizontalSource = sourceHandle === 'in-left' || sourceHandle === 'out-right';
  const useHorizontal = Math.abs(dx) > Math.abs(dy) || (Math.abs(dx) === Math.abs(dy) && horizontalSource);
  const targetSide = useHorizontal ? (dx >= 0 ? 'left' : 'right') : (dy >= 0 ? 'top' : 'bottom');
  return {
    sourceHandle,
    targetHandle: HANDLE_BY_POSITION[targetSide] ?? OPPOSITE_HANDLE[sourceHandle as keyof typeof OPPOSITE_HANDLE] ?? 'in-left',
  };
}
