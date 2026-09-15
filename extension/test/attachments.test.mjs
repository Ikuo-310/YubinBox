// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const script = await readFile(new URL('../src/attachments.js', import.meta.url), 'utf8');
function fixture() {
  const logs = [], handlers = new Map(), timers = new Map(), observers = [], documentHandlers = new Map();
  let documentAdds = 0;
  const doc = {
    addEventListener(type, handler, capture) { assert.equal(capture, true); documentAdds++; documentHandlers.set(type, handler); },
    removeEventListener(type, handler, capture) { assert.equal(capture, true); assert.equal(documentHandlers.get(type), handler); documentHandlers.delete(type); },
  };
  let rows = [];
  const root = {
    isConnected: true,
    ownerDocument: doc,
    contains: (target) => target === root,
    querySelectorAll: (selector) => selector === '.dL' ? rows : [],
    addEventListener: (type, handler) => handlers.set(type, handler),
    removeEventListener: (type, handler) => { assert.equal(handlers.get(type), handler); handlers.delete(type); },
  };
  const context = vm.createContext({ Blob, File, console: { log: (line) => logs.push(JSON.parse(line.split('\n')[1])) },
    setTimeout: (fn) => { const id = {}; timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id),
    MutationObserver: class {
      constructor(fn) { this.fn = fn; observers.push(this); }
      observe(target, options) { assert.equal(target, root); assert.equal(options.subtree, true); }
      disconnect() { this.disconnected = true; }
    },
  });
  vm.runInContext(script, context);
  return { start: context.YubinBoxAttachments.start, logs, handlers, timers, observers, root, documentHandlers,
    documentAdds: () => documentAdds,
    setRows(value) { rows = value; } };
}
test('attachments require strict opt-in and do not even read root when disabled', () => {
  for (const enabled of [false, undefined, 'true']) {
    const f = fixture();
    f.start({ getElement() { throw new Error('must not read'); } }, 'compose-1', enabled)();
    assert.equal(f.logs.length, 0);
    assert.equal(f.observers.length, 0);
    assert.equal(f.documentAdds(), 0);
  }
});
test('initial scan includes existing candidates; later removal remains unknown; cleanup stops queued work', () => {
  const f = fixture();
  f.setRows([{ querySelector: (s) => s === '.vI' ? { textContent: 'fixture.jpg' } : s === '.vJ' ? { textContent: '147 KB' } : null }]);
  const stop = f.start({ getElement: () => f.root }, 'compose-1', true);
  assert.equal(f.logs.at(-1).reason, 'initial-scan');
  assert.equal(f.logs.at(-1).candidates[0].name, 'fixture.jpg');
  assert.equal(f.logs.at(-1).uploadState, 'unknown');
  f.setRows([]);
  f.observers[0].fn();
  const [id, callback] = [...f.timers][0]; f.timers.delete(id); callback();
  assert.equal(f.logs.at(-1).candidateCount, 0);
  assert.equal(f.logs.at(-1).attachmentPresence, 'unknown');
  f.observers[0].fn();
  const late = [...f.timers.values()][0];
  stop(); stop();
  const count = f.logs.length; late(); f.observers[0].fn();
  assert.equal(f.logs.length, count);
  assert.equal(f.timers.size, 0);
  assert.equal(f.handlers.size, 0);
  assert.equal(f.documentHandlers.size, 0);
  assert.equal(f.observers[0].disconnected, true);
});
test('document capture reads only File metadata, attributes by containment, and shares listeners', () => {
  const f = fixture();
  const stop = f.start({ getElement: () => f.root }, 'one', true);
  const stopTwo = f.start({ getElement: () => f.root }, 'two', true);
  assert.equal(f.documentAdds(), 3);
  const file = new File(['PRIVATE_CONTENT'], 'fixture.jpg', { type: 'image/jpeg', lastModified: 123 });
  const forbidden = () => { throw new Error('forbidden'); };
  for (const method of ['arrayBuffer', 'text', 'stream', 'toJSON']) file[method] = forbidden;
  const event = { target: f.root, dataTransfer: { files: [file], items: { length: 1 }, toJSON: forbidden },
    preventDefault: forbidden, stopPropagation: forbidden, stopImmediatePropagation: forbidden };
  const drop = f.documentHandlers.get('drop');
  drop(event);
  assert.equal(f.logs.at(-1).compose, null); // Two matching roots cannot be resolved.
  stopTwo();
  for (const reason of ['dragenter', 'dragover', 'drop']) f.documentHandlers.get(reason)(event);
  const log = f.logs.at(-1);
  assert.equal(log.source, 'document-capture');
  assert.equal(log.reason, 'drop');
  assert.equal(log.compose, 'one');
  assert.equal(log.filesLength, 1);
  assert.equal(log.itemsLength, 1);
  assert.deepEqual(log.files[0], { name: 'fixture.jpg', type: 'image/jpeg', size: 15,
    lastModified: 123, instanceofFile: true, instanceofBlob: true, contentReadAttempted: false });
  drop({ ...event, target: {} });
  assert.equal(f.logs.at(-1).compose, null);
  assert.equal(f.logs.at(-1).attribution, 'unattributed');
  drop({ target: {} });
  assert.equal(f.logs.at(-1).dataTransferPresent, false);
  assert.equal(f.logs.at(-1).filesLength, null);
  drop({ target: {}, dataTransfer: { files: [], items: { length: 1 } } });
  assert.equal(f.logs.at(-1).filesLength, 0);
  assert.equal(f.logs.at(-1).itemsLength, 1);
  assert.ok(!JSON.stringify(f.logs).includes('PRIVATE_CONTENT'));
  stop();
  assert.equal(f.documentHandlers.size, 0);
  const count = f.logs.length; drop(event); assert.equal(f.logs.length, count);
});
test('file events copy metadata without reading bytes or serializing File objects', () => {
  const f = fixture();
  const stop = f.start({ getElement: () => f.root }, 'compose-2', true);
  const file = new File(['SECRET_BYTES'], 'fixture.txt', { type: 'text/plain' });
  for (const name of ['text', 'arrayBuffer', 'stream', 'toJSON']) file[name] = () => { throw new Error('content access forbidden'); };
  for (const type of ['dragenter', 'dragover', 'drop', 'change']) {
    f.handlers.get(type)({ type, dataTransfer: { files: [file] }, target: { matches: () => true, files: [file] } });
    assert.equal(f.logs.at(-1).source, 'file-event');
    assert.equal(f.logs.at(-1).files[0].sizeBytes, 12);
    assert.equal(f.logs.at(-1).files[0].fileObjectObserved, true);
  }
  assert.ok(!JSON.stringify(f.logs).includes('SECRET_BYTES'));
  stop();
});
test('root and scan failures remain diagnostic and separate Compose instances stay isolated', () => {
  const f = fixture();
  assert.doesNotThrow(() => f.start({ getElement() { throw new Error('secret'); } }, 'bad', true)());
  assert.equal(f.logs.at(-1).status, 'error');
  assert.ok(!JSON.stringify(f.logs).includes('secret'));
  const other = fixture();
  const stop = other.start({ getElement: () => other.root }, 'other', true);
  assert.equal(other.logs.at(-1).compose, 'other');
  assert.equal(other.logs.at(-1).candidateCount, 0);
  stop();
});
