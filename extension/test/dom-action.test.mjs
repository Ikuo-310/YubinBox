// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/dom-action.js', import.meta.url), 'utf8');
const sandbox = vm.createContext({});
vm.runInContext(source, sandbox);
const helper = sandbox.YubinBoxDomAction;
test('pending menu target requires exactly one match and Reply consumes it once', async () => {
  for (const count of [0, 1, 2]) {
    const logs = [];
    const tracker = helper.createPendingTracker((line) => logs.push(JSON.parse(line.split('\n')[1])),
      () => 1000, async () => ({ status: 'ok', value: 'fixture-message' }));
    tracker.capture(Array.from({ length: count }, () => ({})));
    await new Promise(setImmediate);
    assert.equal(logs[0].stored, count === 1);
    await tracker.correlate('compose-1', true);
    assert.equal(logs.filter((entry) => Object.hasOwn(entry, 'correlated')).at(-1).correlated, count === 1);
    if (count === 1) assert.equal(logs.at(-1).pendingTarget.gmailMessageId, 'fixture-message');
    await tracker.correlate('compose-2', true);
    assert.equal(logs.filter((entry) => Object.hasOwn(entry, 'correlated')).at(-1).correlated, false);
  }
});
test('pending TTL starts at click; expiry, non-reply and replacement invalidate old targets', async () => {
  let clock = 0;
  const logs = [];
  const tracker = helper.createPendingTracker((line) => logs.push(JSON.parse(line.split('\n')[1])),
    () => clock, async () => ({ status: 'ok', value: 'fixture' }));
  tracker.capture([{}]);
  await new Promise(setImmediate);
  clock = 5000;
  await tracker.correlate('expired', true);
  assert.equal(logs.filter((entry) => Object.hasOwn(entry, 'correlated')).at(-1).correlated, false);
  tracker.capture([{}]);
  await tracker.correlate('forward-or-new', false);
  await tracker.correlate('later-reply', true);
  assert.equal(logs.filter((entry) => Object.hasOwn(entry, 'correlated')).at(-1).correlated, false);
  tracker.capture([{}]);
  tracker.capture([]);
  await tracker.correlate('replaced', true);
  assert.equal(logs.filter((entry) => Object.hasOwn(entry, 'correlated')).at(-1).correlated, false);
});
test('Reply can consume a pending ID lookup without allowing late re-arming', async () => {
  let resolve;
  const logs = [];
  const tracker = helper.createPendingTracker((line) => logs.push(JSON.parse(line.split('\n')[1])),
    () => 10, () => new Promise((fn) => { resolve = fn; }));
  tracker.capture([{}]);
  const correlation = tracker.correlate('compose-1', true);
  await Promise.resolve();
  resolve({ status: 'ok', value: 'fixture' });
  await correlation;
  assert.equal(logs.filter((entry) => Object.hasOwn(entry, 'correlated')).at(-1).correlated, true);
  await tracker.correlate('compose-2', true);
  assert.equal(logs.filter((entry) => Object.hasOwn(entry, 'correlated')).at(-1).correlated, false);
});
test('verified more-options button uses SDK containment and returns a diagnostic tracker', async () => {
  let click;
  const logs = [];
  const button = element({ role: 'button', 'aria-label': 'その他のメッセージ オプション' });
  sandbox.YubinBoxProbe = { readAsync: async () => ({ status: 'ok', value: 'fixture-menu-message' }) };
  const tracker = helper.start({ Conversations: { registerMessageViewHandler(fn) {
    fn({ on() {}, getElement() { return { contains: (node) => node === button }; } });
  } } }, true, { addEventListener(type, fn) { click = fn; } }, (line) => logs.push(line));
  click({ isTrusted: true, target: button });
  await tracker.correlate('compose-menu', true);
  const correlation = JSON.parse(logs.at(-1).split('\n')[1]);
  assert.equal(correlation.correlated, true);
  assert.equal(correlation.pendingTarget.gmailMessageId, 'fixture-menu-message');
});
test('evaluation reports loaded once only for boolean diagnostic opt-in', () => {
  for (const enabled of [true, false, undefined, 'true']) {
    const logs = [];
    vm.runInNewContext(source, {
      YubinBoxPocConfig: { diagnosticOutput: enabled }, console: { log: (line) => logs.push(line) },
    });
    assert.equal(logs.length, enabled === true ? 1 : 0);
    if (enabled === true) assert.equal(logs[0], '[YubinBox PoC][dom-helper] loaded');
  }
});
const element = (attrs = {}, parentElement = null) => ({
  tagName: 'DIV', parentElement,
  getAttribute: (key) => attrs[key] ?? null,
  hasAttribute: (key) => Object.hasOwn(attrs, key),
  get textContent() { throw new Error('must not read mail text'); },
  get innerHTML() { throw new Error('must not read HTML'); },
});
test('classifies only exact English/Japanese reply controls and rejects conflicting labels', () => {
  for (const [label, expected] of [['Reply', 'reply'], ['全員に返信', 'replyAll'], ['Forward', 'forward'], ['返信', 'reply'], ['Reply All', 'replyAll'], ['転送', 'forward']]) {
    assert.equal(helper.actionOf(element({ 'aria-label': label })), expected);
  }
  assert.equal(helper.classify('Reply to private@example.invalid'), 'unknown');
  assert.equal(helper.actionOf(element({ 'aria-label': 'Reply', title: 'Forward' })), 'unknown');
});
test('metadata omits arbitrary attribute values, body, credential and person strings', () => {
  const data = helper.metadata(element({
    'aria-label': 'private@example.invalid', title: 'secret subject',
    id: 'secret-token', class: 'secret-password', 'data-message-id': 'secret-id',
    'data-token': 'secret-token', 'data-app-id': 'sdk_private', role: 'secret-role',
  }));
  const json = JSON.stringify(data);
  assert.equal(json.includes('secret'), false);
  assert.equal(json.includes('private'), false);
  assert.equal(json.includes('sdk_'), false);
  assert.equal(data.idPresent, true);
  assert.equal(data.identifiersPresent[0], 'data-message-id');
});
test('disabled diagnostic registers no observers and emits nothing', () => {
  for (const enabled of [false, undefined, 'true']) {
    helper.start(null, enabled, null, () => assert.fail('must not log'));
  }
});
test('listener installation and unclassified clicks are logged safely with a 30-click cap', () => {
  const logs = [];
  let click;
  helper.start({ Conversations: { registerMessageViewHandler() {} } }, true,
    { addEventListener(type, fn) { click = fn; } }, (line) => logs.push(line));
  assert.equal(logs[0], '[YubinBox PoC][dom-helper] listener-installed');
  const parent = element({ role: 'button', title: 'secret-token' });
  const target = element({ 'aria-label': '返信 (r)', 'data-token': 'sdk_private' }, parent);
  for (let i = 0; i < 35; i++) click({ isTrusted: true, target });
  assert.equal(logs.length, 31);
  const first = JSON.parse(logs[1].slice(logs[1].indexOf('\n') + 1));
  assert.equal(first.action, 'unknown');
  assert.equal(first.classificationReason, 'no-exact-supported-label-within-8-levels');
  assert.equal(first.ancestry.length, 2);
  assert.equal(first.ancestry[1].role, 'button');
  assert.equal(first.target['aria-label'], '<redacted-unrecognized-label>');
  assert.equal(first.observedAttributes[0]['aria-label'], '返信 (r)');
  assert.equal(first.observedAttributes[1].title, '<redacted-credential>');
  assert.equal(JSON.parse(logs.at(-1).slice(logs.at(-1).indexOf('\n') + 1)).lastSample, true);
  assert.equal(logs.join('').includes('secret-token'), false);
  assert.equal(logs.join('').includes('private'), false);
});
test('real attributes are limited to unknown trusted clicks and exclude config and credentials', () => {
  let click;
  const logs = [];
  sandbox.YubinBoxPocConfig = { appId: 'configured-fixture-id' };
  helper.start({ Conversations: { registerMessageViewHandler() {} } }, true,
    { addEventListener(type, fn) { click = fn; } }, (line) => logs.push(line));
  const target = element({ 'aria-label': 'configured-fixture-id', title: 'Bearer test-value' });
  click({ isTrusted: true, target });
  const parse = () => JSON.parse(logs.at(-1).split('\n').slice(1).join('\n'));
  assert.equal(parse().observedAttributes[0]['aria-label'], '<redacted-credential>');
  assert.equal(parse().observedAttributes[0].title, '<redacted-credential>');
  assert.equal(logs.join('').includes('configured-fixture-id'), false);
  assert.equal(logs.join('').includes('test-value'), false);
  click({ isTrusted: false, target });
  assert.equal(parse().observedAttributes, undefined);
  click({ isTrusted: true, target: element({ 'aria-label': 'Reply' }) });
  assert.equal(parse().action, 'reply');
  assert.equal(parse().observedAttributes, undefined);
});
test('click containment uses SDK elements, not matching-looking DOM IDs; multiple matches stay unverified', async () => {
  for (const count of [0, 1, 2]) {
    let listener;
    const logs = [];
    const control = element({ 'aria-label': 'Reply', 'data-message-id': 'same-looking-id' });
    sandbox.YubinBoxProbe = {
      readAsync: async (v, key) => ({ status: 'ok', value: await v[key]() }),
      read: (v, key) => ({ status: 'ok', value: v[key]() }),
    };
    const views = Array.from({ length: count }, (_, i) => ({
      on() {}, getElement: () => {
        const root = element(); root.contains = (v) => v === control; return root;
      },
      getMessageIDAsync: async () => `sdk-id-${i}`,
      getThreadView: () => ({ getThreadIDAsync: async () => 'sdk-thread' }),
    }));
    helper.start({ Conversations: { registerMessageViewHandler(fn) { views.forEach(fn); } } }, true,
      { addEventListener(type, fn, options) {
        assert.equal(type, 'click'); assert.equal(options.capture, true); assert.equal(options.passive, true); listener = fn;
      } }, (line) => { if (line.startsWith('[YubinBox PoC][dom-action]')) logs.push(line); });
    listener({ isTrusted: true, target: control });
    await new Promise(setImmediate);
    assert.equal(logs.length, 1);
    assert.ok(logs[0].startsWith('[YubinBox PoC][dom-action]\n'));
    const result = JSON.parse(logs[0].slice(logs[0].indexOf('\n') + 1));
    assert.equal(result.candidateMatches.length, count);
    assert.equal(result.exactReplyTarget.value, null);
    assert.equal(result.exactReplyTarget.status, 'unverified');
    assert.equal(logs[0].includes('same-looking-id'), false);
    if (count === 2) assert.ok(result.candidateMatches.every((v) => v.confidence === 'low'));
    listener({ isTrusted: false, target: control });
    listener({ isTrusted: true, target: element({ title: 'Other action' }) });
    await new Promise(setImmediate);
    assert.equal(logs.length, 1);
  }
});
