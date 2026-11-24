export type PinchPoint = { x: number; y: number };
export type PinchViewport = { x: number; y: number; zoom: number };

export function requiresCustomPinch(touchCount: number, hasPanBlockedTarget: boolean): boolean {
  return touchCount >= 2 && hasPanBlockedTarget;
}

export function updatePinchGesture(active: boolean, touchCount: number): boolean {
  if (touchCount >= 2) return true;
  return touchCount === 0 ? false : active;
}

export function shouldReleaseTouchSnapshot(touchCount: number): boolean {
  return touchCount === 0;
}

export function calculatePinchViewport({
  startViewport,
  startCenter,
  currentCenter,
  startDistance,
  currentDistance,
  minZoom,
  maxZoom,
}: {
  startViewport: PinchViewport;
  startCenter: PinchPoint;
  currentCenter: PinchPoint;
  startDistance: number;
  currentDistance: number;
  minZoom: number;
  maxZoom: number;
}): PinchViewport {
  if (startDistance <= 0 || startViewport.zoom <= 0) return startViewport;

  const zoom = Math.min(maxZoom, Math.max(minZoom, startViewport.zoom * currentDistance / startDistance));
  const worldX = (startCenter.x - startViewport.x) / startViewport.zoom;
  const worldY = (startCenter.y - startViewport.y) / startViewport.zoom;
  return {
    x: currentCenter.x - worldX * zoom,
    y: currentCenter.y - worldY * zoom,
    zoom,
  };
}
