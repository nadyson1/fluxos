import { describe, expect, it } from 'vitest';
import { calculatePinchViewport, requiresCustomPinch, shouldReleaseTouchSnapshot, updatePinchGesture } from './pinch-gesture';

describe('prioridade da pinça', () => {
  it('assume a pinça quando algum contato começa em uma área nopan', () => {
    expect(requiresCustomPinch(1, true)).toBe(false);
    expect(requiresCustomPinch(2, false)).toBe(false);
    expect(requiresCustomPinch(2, true)).toBe(true);
  });

  it('mantém ativo o estado da pinça até todos os dedos saírem', () => {
    expect(updatePinchGesture(false, 1)).toBe(false);
    expect(updatePinchGesture(false, 2)).toBe(true);
    expect(updatePinchGesture(true, 1)).toBe(true);
    expect(updatePinchGesture(true, 0)).toBe(false);
  });

  it('descarta o snapshot de interação quando o último toque termina', () => {
    expect(shouldReleaseTouchSnapshot(0)).toBe(true);
    expect(shouldReleaseTouchSnapshot(1)).toBe(false);
    expect(shouldReleaseTouchSnapshot(2)).toBe(false);
  });

  it('aproxima os dedos reduzindo o zoom e afasta ampliando ao redor do ponto central', () => {
    const input = {
      startViewport: { x: 100, y: 60, zoom: 1 },
      startCenter: { x: 200, y: 150 },
      currentCenter: { x: 200, y: 150 },
      startDistance: 100,
      minZoom: 0.2,
      maxZoom: 2.5,
    };

    expect(calculatePinchViewport({ ...input, currentDistance: 200 })).toEqual({ x: 0, y: -30, zoom: 2 });
    expect(calculatePinchViewport({ ...input, currentDistance: 50 })).toEqual({ x: 150, y: 105, zoom: 0.5 });
  });

  it('desloca o viewport pelo movimento do ponto médio sem alterar o zoom', () => {
    expect(calculatePinchViewport({
      startViewport: { x: 100, y: 60, zoom: 1 },
      startCenter: { x: 200, y: 150 },
      currentCenter: { x: 220, y: 130 },
      startDistance: 100,
      currentDistance: 100,
      minZoom: 0.2,
      maxZoom: 2.5,
    })).toEqual({ x: 120, y: 40, zoom: 1 });
  });

  it('respeita os limites de zoom configurados no editor', () => {
    const input = {
      startViewport: { x: 100, y: 60, zoom: 1 },
      startCenter: { x: 200, y: 150 },
      currentCenter: { x: 200, y: 150 },
      startDistance: 100,
      minZoom: 0.2,
      maxZoom: 2.5,
    };

    expect(calculatePinchViewport({ ...input, currentDistance: 400 }).zoom).toBe(2.5);
    expect(calculatePinchViewport({ ...input, currentDistance: 10 }).zoom).toBe(0.2);
  });
});
