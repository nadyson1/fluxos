export type FinalConnectionDrop = {
  fromNode: { id: string } | null;
  to: { x: number; y: number } | null;
  toNode: unknown | null;
  isValid: boolean | null;
};

export function getLooseConnectionInsertTarget(state: FinalConnectionDrop | null | undefined) {
  if (!state?.fromNode || state.toNode || state.isValid === true || !state.to) return null;
  return {
    sourceId: state.fromNode.id,
    position: { x: state.to.x, y: state.to.y },
  };
}
