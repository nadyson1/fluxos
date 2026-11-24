import { describe, expect, it, vi } from 'vitest';
import { saveProjectJson } from './project-export';

describe('exportação JSON do projeto', () => {
  it('usa o seletor nativo no Android com nome sanitizado e JSON serializado', async () => {
    const nativeSave = vi.fn().mockResolvedValue({ cancelled: false });
    const webSave = vi.fn();
    const envelope = { format: 'fluxos-project', project: { name: 'Operação: teste' } };

    await saveProjectJson(envelope.project.name, envelope, 'android', nativeSave, webSave);

    expect(nativeSave).toHaveBeenCalledWith({
      filename: 'Operação- teste.fluxos.json',
      content: JSON.stringify(envelope, null, 2),
    });
    expect(webSave).not.toHaveBeenCalled();
  });

  it('mantém o download do navegador fora do Android', async () => {
    const nativeSave = vi.fn();
    const webSave = vi.fn();
    const envelope = { format: 'fluxos-project', project: { name: 'Fluxos' } };

    await saveProjectJson(envelope.project.name, envelope, 'web', nativeSave, webSave);

    expect(webSave).toHaveBeenCalledWith('Fluxos.fluxos.json', JSON.stringify(envelope, null, 2));
    expect(nativeSave).not.toHaveBeenCalled();
  });
});
