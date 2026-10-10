// Exercise the actual TypeScript queue without introducing a test framework.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = fs.readFileSync(require.resolve('../src/fridgechef/imageQueue.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const { queuedImageRequest } = context.exports;
(async () => {
  let active = 0, peak = 0;
  const finished = [];
  const tasks = Array.from({ length: 5 }, (_, i) => queuedImageRequest(async () => {
    active += 1;
    peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (i === 1) throw new Error('simulated failed request');
      finished.push(i);
      return i;
    } finally { active -= 1; }
  }));
  const results = await Promise.allSettled(tasks);
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.deepEqual(finished, [0, 2, 3, 4]);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(await queuedImageRequest(async () => 'still works'), 'still works');
  process.stdout.write('Image queue concurrency and failure recovery passed\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
