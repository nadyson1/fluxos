import { describe, expect, it } from 'vitest';
import sample from '../../samples/operacao-velluto.sample.json';
import { searchExport, validateExportEnvelope } from './domain';

describe('projeto demonstrativo', () => {
  it('valida a hierarquia de cinco níveis sem vínculos órfãos', () => {
    const envelope = validateExportEnvelope(sample);
    const deepest = envelope.diagrams.find((diagram) => diagram.name === 'Tratamento de objeções');
    expect(deepest?.parentDiagramId).toBe('sample-negociacao');
    expect(envelope.diagrams).toHaveLength(7);
  });

  it('encontra conteúdo interno com o caminho completo dos subprocessos', () => {
    const envelope = validateExportEnvelope(sample);
    const results = searchExport([envelope], 'tratamento de objecoes');
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'node',
        title: 'Tratamento de objeções',
        path: 'Operação VELLUTO (exemplo) > Operação VELLUTO > Marketing e captação > Funil de vendas > Negociação',
      }),
    ]));
  });
});
