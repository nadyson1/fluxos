import { describe, expect, it } from 'vitest';
import { getFlowHandleDirection } from './handle-directions';

describe('direção dos handles do canvas', () => {
  it('permite iniciar e concluir conexões em qualquer âncora no modo Loose', () => {
    expect(getFlowHandleDirection('left')).toBe('source');
    expect(getFlowHandleDirection('right')).toBe('source');
    expect(getFlowHandleDirection('top')).toBe('source');
    expect(getFlowHandleDirection('bottom')).toBe('source');
  });
});
