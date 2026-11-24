export function enqueueSave(previous: Promise<void>, save: () => Promise<void>): Promise<void> {
  return previous.catch(() => undefined).then(save);
}
