type ExportPlatform = 'android' | 'web' | string;
type NativeExportRequest = { filename: string; content: string };

export function projectExportFilename(projectName: string): string {
  return `${projectName.replace(/[\\/:*?"<>|]/g, '-').trim() || 'fluxos'}.fluxos.json`;
}

export async function saveProjectJson<T>(
  projectName: string,
  envelope: T,
  platform: ExportPlatform,
  nativeSave: (request: NativeExportRequest) => Promise<unknown>,
  webSave: (filename: string, content: string) => void,
): Promise<void> {
  const filename = projectExportFilename(projectName);
  const content = JSON.stringify(envelope, null, 2);
  if (platform === 'android') {
    await nativeSave({ filename, content });
    return;
  }
  webSave(filename, content);
}
