// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/probe.js', import.meta.url), 'utf8');
const makeRuntime = () => ({
  getURL: () => 'moz-extension://synthetic-extension/',
  sendMessage() {},
});
function run({ window = {}, chrome, browser, firefox = true, pageContext = false } = {}) {
  const logs = [];
  const context = vm.createContext({
    window, chrome, browser,
    navigator: { userAgent: firefox ? 'Firefox/128.0' : 'Chrome/128.0' },
    console: { info(...args) { logs.push(args); } },
  });
  if (pageContext) vm.runInContext('window = globalThis', context);
  vm.runInContext(source, context);
  context.YubinBoxProbe.applyFirefoxRuntimeShim();
  return { context, logs };
}

test('shim references the real callback runtime only on the isolated window', () => {
  const mainWorld = {};
  // Model Firefox's private Xray expandos; this is not a live Firefox test.
  const expandos = new Map();
  const isolatedWindow = new Proxy(mainWorld, {
    get(target, key) {
      if (key === 'wrappedJSObject') throw new Error('Shim must not unwrap the page');
      return expandos.has(key) ? expandos.get(key) : Reflect.get(target, key);
    },
    defineProperty(_target, key, descriptor) {
      expandos.set(key, descriptor.value);
      return true;
    },
  });
  const runtime = makeRuntime();
  const { logs } = run({ window: isolatedWindow, chrome: { runtime, tabs: {} }, browser: { runtime: makeRuntime() } });
  assert.equal(isolatedWindow.chrome.runtime, runtime);
  assert.equal(isolatedWindow.chrome.runtime.sendMessage, runtime.sendMessage);
  assert.deepEqual(Object.keys(isolatedWindow.chrome), ['runtime']);
  assert.equal(Object.hasOwn(mainWorld, 'chrome'), false);
  const states = logs.filter(([label]) => label.includes('[compat]'));
  assert.equal(states[0][1].windowChromePresent, false);
  assert.equal(states[1][1].windowChromePresent, true);
  assert.equal(states[1][1].shimApplied, true);
  for (const [, state] of states) assert.ok(Object.values(state).every((value) => typeof value === 'boolean'));
  assert.equal(JSON.stringify(logs).includes('synthetic-extension'), false);
});

test('shim preserves an existing window.chrome', () => {
  for (const existing of [{ runtime: {} }, null, false]) {
    const window = { chrome: existing };
    const { logs } = run({ window, chrome: { runtime: makeRuntime() } });
    assert.equal(window.chrome, existing);
    assert.equal(logs.at(-1)[1].shimApplied, false);
  }
});

test('shim does not fabricate runtime or proxy a browser-only API', () => {
  for (const apis of [{}, { chrome: {} }, { browser: { runtime: makeRuntime() } }]) {
    const window = {};
    const { logs } = run({ window, ...apis });
    assert.equal(Object.hasOwn(window, 'chrome'), false);
    assert.equal(logs.at(-1)[1].shimApplied, false);
  }
});

test('shim cannot apply to a MAIN-like global or a non-Firefox context', () => {
  const { context, logs } = run({ chrome: { runtime: makeRuntime() }, pageContext: true });
  assert.equal(logs.at(-1)[1].shimApplied, false);
  assert.equal(Object.keys(context.chrome).length, 1);
  const window = {};
  assert.equal(run({ window, chrome: { runtime: makeRuntime() }, firefox: false }).logs.at(-1)[1].shimApplied, false);
  assert.equal(Object.hasOwn(window, 'chrome'), false);
});

test('shim leaves invalid or non-writable environments untouched', () => {
  const runtime = { ...makeRuntime(), getURL: () => 'https://example.invalid/' };
  const window = {};
  assert.equal(run({ window, chrome: { runtime } }).logs.at(-1)[1].shimApplied, false);
  assert.equal(Object.hasOwn(window, 'chrome'), false);
  assert.equal(run({ window: Object.preventExtensions({}), chrome: { runtime: makeRuntime() } }).logs.at(-1)[1].shimApplied, false);
});
