/** Bound actual image HTTP requests across cards, tabs and recipe details. */
let active = 0;
const waiting: Array<() => void> = [];
const limit = 2;

export async function queuedImageRequest<T>(request: () => Promise<T>): Promise<T> {
  await new Promise<void>(resolve => {
    const acquire = () => { active += 1; resolve(); };
    if (active < limit) acquire();
    else waiting.push(acquire);
  });
  try { return await request(); }
  finally {
    active -= 1;
    waiting.shift()?.();
  }
}
