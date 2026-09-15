// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

const context = vm.createContext({ setTimeout, clearTimeout });
vm.runInContext(await readFile(new URL('../src/probe.js', import.meta.url), 'utf8'), context);
const probe = context.YubinBoxProbe;

test('multiple reply candidates never become an exact target or RFC headers; identity remains a candidate', async () => {
  const messages = ['older', 'newer'].map((id) => ({
    isLoaded: () => true, getMessageIDAsync: async () => id,
    getSender: () => ({ emailAddress: `${id}@example.invalid` }),
    getRecipientsFull: async () => [{ emailAddress: 'domain@example.invalid' }],
    getTargetMessageID() { throw new Error('must not use internal API'); },
    getHeaders() { throw new Error('must not invent undocumented getter'); },
  }));
  const raw = await probe.relatedMessages({ status: 'ok', value: 'thread' }, [{
    getThreadIDAsync: async () => 'thread', getMessageViewsAll: () => messages,
  }]);
  const plain = probe.diagnosticPlain({ relatedMessages: raw }, true);
  assert.equal(plain.exactReplyTarget.status, 'unsupported');
  assert.equal(plain.exactReplyTarget.value, null);
  assert.ok(plain.exactReplyTarget.reason.includes('Thread membership'));
  assert.equal(plain.relatedMessages.candidates.length, 2);
  for (const candidate of plain.relatedMessages.candidates) {
    assert.equal(candidate.originalTo.status, 'unsupported');
    assert.equal(candidate.originalCc.value, null);
    assert.equal(candidate.receivingIdentityCandidates.selectedIdentity, null);
    assert.equal(candidate.receivingIdentityCandidates.value[0].emailAddress, 'domain@example.invalid');
    for (const field of Object.values(candidate.rfcHeaders)) {
      assert.equal(field.status, 'unsupported');
      assert.equal(field.api, null);
      assert.equal(field.value, null);
      assert.equal(field.attempted, false);
      assert.ok(field.reason);
    }
  }
});

test('forward and reply modes preserve SDK booleans but do not infer Reply All', () => {
  for (const isForward of [true, false]) {
    const plain = probe.diagnosticPlain(probe.composeFields({
      isForward: () => isForward, isReply: () => !isForward,
      getToRecipients: () => [], getCcRecipients: () => [],
      getSubject: () => 'Synthetic', getTextContent: () => 'text',
      getHTMLContent: () => '<p>text</p>', getThreadID: () => null,
    }));
    assert.equal(plain.mode.isForward.value, isForward);
    assert.equal(plain.mode.isReply.value, !isForward);
    assert.equal(plain.mode.replyVsReplyAll.status, 'unsupported');
    assert.equal(plain.gmailInternalIds.threadId.value, null);
    assert.equal(plain.bodyHTML.value, '<p>text</p>');
  }
});

test('diagnostic projection serializes only explicit mail fields, including null and undefined', () => {
  const sdkObject = {
    name: 'Test User', emailAddress: 'test@example.invalid',
    appId: 'secret-app-id', token: 'secret-token', password: 'secret-password',
    toJSON() { throw new Error('SDK serialization must not run'); },
  };
  sdkObject.internal = sdkObject;
  const fields = probe.composeFields({
    getToRecipients: () => [sdkObject, null, undefined],
    getSubject: () => undefined, getTextContent: () => null,
    getHTMLContent: () => '<p>test body</p>',
  });
  const snapshot = probe.diagnosticPlain({ compose: 'compose-1', revision: 1, reason: 'detected', ...fields, sdkObject });
  const related = probe.diagnosticPlain({ relatedMessages: { candidates: [{
    sender: { value: sdkObject }, recipientsFull: { value: [sdkObject] },
    gmailMessageId: { value: undefined }, sdkObject,
  }] } }, true);
  const json = JSON.stringify({ snapshot, related });
  assert.equal(typeof json, 'string');
  assert.ok(json.includes('test@example.invalid'));
  for (const secret of ['secret-', 'appId', 'token', 'password', 'internal', 'toJSON', 'sdkObject']) {
    assert.equal(json.includes(secret), false);
  }
  assert.equal(snapshot.subject.value, null);
  assert.equal(snapshot.bodyText.value, null);
  assert.equal(snapshot.bodyHTML.value, '<p>test body</p>');
  assert.equal(related.relatedMessages.candidates[0].gmailMessageId.value, null);
  assert.doesNotThrow(() => JSON.stringify(probe.diagnosticPlain(null)));
  assert.doesNotThrow(() => JSON.stringify(probe.diagnosticPlain(undefined, true)));
});

for (const diagnosticOutput of [true, false, 'true']) {
  test(`Compose events automatically capture relations only with explicit boolean opt-in (${JSON.stringify(diagnosticOutput)})`, async () => {
    let composeHandler;
    const timers = new Map();
    let timerId = 0;
    let reads = 0;
    const records = [];
    const view = Object.assign(new EventEmitter(), {
      isReply: () => true, isForward: () => false,
      getSubject: () => { reads++; return 'synthetic-private-subject'; },
      getThreadID: () => 'synthetic-thread',
      getCurrentDraftID: async () => { reads++; return 'synthetic-draft'; },
    });
    const thread = Object.assign(new EventEmitter(), {
      getThreadIDAsync: async () => 'synthetic-thread',
      getMessageViewsAll: () => [{
        isLoaded: () => true,
        getMessageIDAsync: async () => 'synthetic-message',
        getRecipientsFull: async () => { reads++; return [{ emailAddress: 'private@example.invalid' }]; },
      }],
    });
    const sandbox = vm.createContext({
      YubinBoxProbe: probe,
      YubinBoxPocConfig: { appId: 'synthetic-only', diagnosticOutput },
      InboxSDK: { load: async () => ({
        Conversations: { registerThreadViewHandler(fn) { fn(thread); } },
        Compose: { registerComposeViewHandler(fn) { composeHandler = fn; } },
      }) },
      document: { addEventListener() {} },
      console: { info() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {},
        log(value) {
          assert.equal(typeof value, 'string');
          if (value.includes('"compose"')) assert.match(value, /^\[YubinBox PoC\]\[(snapshot|related|sending-data)\]\n\{/);
          assert.equal(value.includes('synthetic-only'), false);
          records.push(JSON.parse(value.startsWith('[YubinBox PoC]') ? value.slice(value.indexOf('\n') + 1) : value));
        } },
      setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
      clearTimeout(id) { timers.delete(id); },
    });
    vm.runInContext(await readFile(new URL('../src/content.js', import.meta.url), 'utf8'), sandbox);
    await new Promise(setImmediate);
    composeHandler(view);
    const events = ['recipientsChanged', 'subjectChanged', 'bodyChanged', 'draftSaved'];
    for (const event of events) view.emit(event);
    assert.equal(timers.size, events.length);
    for (const [id, { fn, delay }] of [...timers]) {
      assert.equal(delay, 500);
      timers.delete(id);
      fn();
    }
    await new Promise(setImmediate);
    const snapshots = records.filter((record) => record.compose);
    if (diagnosticOutput === true) {
      for (const reason of ['detected', ...events]) {
        const base = snapshots.find((record) => record.reason === reason && record.subject);
        const related = snapshots.find((record) => record.reason === reason && record.gmailInternalDraftId);
        assert.equal(base.subject.value, 'synthetic-private-subject');
        assert.equal(base.mode.isReply.value, true);
        assert.equal(related.revision, base.revision);
        assert.equal(related.gmailInternalDraftId.value, 'synthetic-draft');
        assert.equal(related.relatedMessages.candidates[0].gmailMessageId.value, 'synthetic-message');
        assert.equal(related.relatedMessages.exactReplyTarget.status, 'unsupported');
      }
    } else {
      assert.equal(reads, 0);
      assert.equal(snapshots.length, 0);
      assert.equal(JSON.stringify(records).includes('private'), false);
    }
  });
}

test('error sanitizer reconstructs engine diagnostics and removes arbitrary private text', () => {
  const sanitize = (message) => probe.sanitizeLoadError(new TypeError(message), 'sdk_private_0123456789');
  assert.equal(sanitize('can\'t access property "sendMessage", window.chrome.runtime is undefined').sanitizedMessage,
    'can\'t access property "sendMessage", window.chrome.runtime is undefined');
  assert.equal(sanitize("Cannot read properties of undefined (reading 'subject-secret')").sanitizedMessage,
    "Cannot read properties of undefined (reading '<identifier>')");
  assert.equal(sanitize('secretBody is not a function').sanitizedMessage, '<expression> is not a function');
  for (const message of [
    'sdk_private_0123456789 failed',
    'sdk_other_9876543210 failed',
    'Subject: private subject; Body: confidential text',
    'Bearer confidential-token smtp_password=private-password',
    'https://example.invalid/?token=private-token',
    'Private Person lives at private street',
  ]) {
    assert.equal(sanitize(message).sanitizedMessage, '<redacted unrecognized message>');
  }
  const email = sanitize('recipient+test@example.invalid is not a function');
  assert.ok(email.sanitizedMessage.includes('<email>'));
  assert.equal(email.sanitizedMessage.includes('example.invalid'), false);
  assert.equal(email.name, 'TypeError');
  assert.equal(email.messagePresent, true);
  assert.equal(email.stackPresent, true);
  assert.ok(sanitize('private'.repeat(2000)).sanitizedMessage.length <= 240);
  assert.equal(probe.sanitizeLoadError(null).messagePresent, false);
  assert.equal(probe.sanitizeLoadError({ get message() { throw new Error('private'); } }).messagePresent, false);
  assert.equal(probe.sanitizeLoadError({ name: 'private', message: {} }).name, 'OtherError');
});

for (const phase of ['sdk-load', 'post-load']) {
  test(`reject diagnostics identify ${phase} without exposing exception contents`, async () => {
    const errors = [];
    const infos = [];
    let cleared = false;
    const failure = new TypeError('private@example.invalid is not a function');
    const sdk = {
      Conversations: { registerThreadViewHandler() { throw failure; } },
    };
    const sandbox = vm.createContext({
      YubinBoxProbe: probe,
      YubinBoxPocConfig: { appId: 'sdk_private_0123456789' },
      InboxSDK: { load: () => phase === 'sdk-load' ? Promise.reject(failure) : Promise.resolve(sdk) },
      document: {},
      console: {
        info(...args) { infos.push(args); },
        error(...args) { errors.push(args); },
        log() {}, groupCollapsed() {}, groupEnd() {},
      },
      setTimeout() { return 1; },
      clearTimeout() { cleared = true; },
    });
    vm.runInContext(await readFile(new URL('../src/content.js', import.meta.url), 'utf8'), sandbox);
    await new Promise(setImmediate);
    assert.equal(errors.length, 1);
    assert.ok(errors[0][0].includes(`[${phase}]`));
    assert.equal(errors[0][1].name, 'TypeError');
    assert.equal(errors[0][1].sanitizedMessage, '<expression> is not a function <email>');
    assert.equal(errors[0][1].messagePresent, true);
    assert.equal(errors[0][1].stackPresent, true);
    assert.equal(Object.hasOwn(errors[0][1], 'stack'), false);
    assert.equal(JSON.stringify(errors).includes('private'), false);
    assert.equal(infos.some(([label]) => label.includes('InboxSDK.load resolved')), phase === 'post-load');
    assert.equal(cleared, true);
  });
}

test('partial getter failure does not hide other fields; edits are re-read', () => {
  let subject = 'Synthetic subject';
  const view = {
    getSubject: () => subject,
    getToRecipients: () => [{ emailAddress: 'test@example.invalid' }],
    getTextContent: () => { throw new Error('sensitive error text'); },
    getThreadID: () => 'gmail-internal-thread',
  };
  const first = probe.composeFields(view);
  assert.equal(first.subject.value, 'Synthetic subject');
  assert.equal(first.bodyText.status, 'error');
  assert.equal(first.cc.status, 'api-unavailable');
  assert.equal(JSON.stringify(first).includes('sensitive error text'), false);
  subject = 'Edited synthetic subject';
  assert.equal(probe.composeFields(view).subject.value, subject);
  assert.equal(first.subject.value, 'Synthetic subject');
  for (const field of Object.values(first.rfcHeaders)) assert.equal(field.status, 'unsupported');
});

test('recipient count never becomes a Reply All classification', () => {
  const snapshot = probe.composeFields({
    isReply: () => true,
    getToRecipients: () => [{ emailAddress: 'a@example.invalid' }, { emailAddress: 'b@example.invalid' }],
  });
  assert.equal(snapshot.mode.isReply.value, true);
  assert.equal(snapshot.mode.replyVsReplyAll.status, 'unsupported');
});

test('async reads distinguish missing, null, rejection, and timeout', async () => {
  assert.equal((await probe.readAsync({}, 'missing')).status, 'api-unavailable');
  assert.equal((await probe.readAsync({ get: () => null }, 'get')).status, 'empty');
  assert.equal((await probe.readAsync({ get: () => Promise.reject(new Error('secret')) }, 'get')).status, 'error');
  assert.equal((await probe.readAsync({ get: () => new Promise(() => {}) }, 'get', 5)).status, 'timeout');
});

test('only matching threads are read; unloaded messages are not queried or treated as reply target', async () => {
  const loadedMessage = {
    isLoaded: () => true,
    getMessageIDAsync: async () => 'gmail-message-not-rfc',
    getRecipientsFull: async () => [{ emailAddress: 'original@example.invalid' }],
    getSender: () => ({ emailAddress: 'sender@example.invalid' }),
    getRecipientEmailAddresses: () => ['original@example.invalid'],
  };
  const result = await probe.relatedMessages({ status: 'ok', value: 'thread-A' }, [
    { getThreadIDAsync: async () => 'thread-B', getMessageViewsAll: () => { throw new Error('must not read'); } },
    { getThreadIDAsync: async () => 'thread-A', getMessageViewsAll: () => [loadedMessage, { isLoaded: () => false }] },
  ]);
  assert.equal(result.status, 'same-thread-candidates');
  assert.equal(result.exactReplyTarget, 'unverified');
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].gmailMessageId.value, 'gmail-message-not-rfc');
  assert.equal(result.candidates[1].details.status, 'not-collected');
  assert.equal((await probe.relatedMessages({ status: 'empty', value: null }, [])).status, 'not-collected');
});

test('background limits injection to the requesting Gmail frame and reports failures', async () => {
  let handler;
  let request;
  const diagnostics = [];
  const browser = {
    runtime: { id: 'test-extension', onMessage: { addListener: (fn) => { handler = fn; } } },
    scripting: { executeScript: async (value) => {
      request = value;
      return [{ frameId: 0, result: 'synthetic-private-result' }];
    } },
  };
  vm.runInNewContext(await readFile(new URL('../src/background.js', import.meta.url), 'utf8'), {
    browser, console: {
      info(...args) { diagnostics.push(args); },
      error(...args) { diagnostics.push(args); },
    },
  });
  const sender = { id: 'test-extension', url: 'https://mail.google.com/mail/u/0/', tab: { id: 7 }, frameId: 0 };
  assert.equal(await handler({ type: 'inboxsdk__injectPageWorld' }, { ...sender, url: 'https://example.invalid/' }), false);
  assert.equal(request, undefined);
  assert.equal(await handler({ type: 'inboxsdk__injectPageWorld' }, sender), true);
  assert.equal(request.target.tabId, 7);
  assert.equal(request.world, 'MAIN');
  assert.equal(request.files[0], 'pageWorld.js');
  browser.scripting.executeScript = async () => [{ frameId: 0, error: new Error('synthetic-private-frame-error') }];
  assert.equal(await handler({ type: 'inboxsdk__injectPageWorld' }, sender), true);
  assert.equal(diagnostics.at(-1)[1].hasError, true);
  browser.scripting.executeScript = async () => { throw new Error('synthetic-private-exception'); };
  assert.equal(await handler({ type: 'inboxsdk__injectPageWorld' }, sender), false);
  const logged = JSON.stringify(diagnostics);
  for (const stage of ['started', 'injection request received', 'executeScript calling', 'executeScript resolved', 'executeScript rejected']) {
    assert.ok(logged.includes(stage));
  }
  assert.equal(logged.includes('synthetic-private'), false);
  assert.equal(logged.includes(sender.url), false);
});

test('load state diagnostics read only presence in MAIN world before/after load and while pending', async () => {
  const logs = [];
  const attributes = new Set();
  const pageWindow = {};
  let pendingCheck;
  const sandbox = vm.createContext({
    window: { wrappedJSObject: pageWindow },
    // A marker on the isolated global must not count as a MAIN world marker.
    __InboxSDKInjected: true,
    YubinBoxProbe: probe,
    YubinBoxPocConfig: { appId: 'synthetic-private-app-id' },
    document: { head: { hasAttribute: (name) => attributes.has(name) } },
    InboxSDK: { load() {
      attributes.add('data-inboxsdk-script-injected');
      Object.defineProperty(pageWindow, '__InboxSDKInjected', {
        get() { throw new Error('Marker value must not be read'); },
      });
      return new Promise(() => {});
    } },
    console: {
      info(...args) { logs.push(args); }, warn() {}, error() {},
    },
    setTimeout(fn, delay) { assert.equal(delay, 30000); pendingCheck = fn; return 1; },
    clearTimeout() {},
  });
  vm.runInContext(await readFile(new URL('../src/content.js', import.meta.url), 'utf8'), sandbox);
  attributes.add('data-inboxsdk-user-email-address');
  pendingCheck();
  const states = logs.filter(([label]) => label.includes('[sdk-state]'));
  assert.equal(states.length, 3);
  assert.ok(states[0][0].endsWith('[before-load-call]'));
  assert.ok(states[1][0].endsWith('[after-load-call]'));
  assert.ok(states[2][0].endsWith('[pending-30s]'));
  assert.equal(states[0][1].mainWorldInboxSDKInjectedPresent, false);
  assert.equal(states[1][1].mainWorldInboxSDKInjectedPresent, true);
  assert.equal(states[0][1].scriptInjectedAttributePresent, false);
  assert.equal(states[1][1].scriptInjectedAttributePresent, true);
  assert.equal(states[1][1].userEmailAttributePresent, false);
  assert.equal(states[2][1].userEmailAttributePresent, true);
  for (const [, state] of states) {
    assert.equal(state.mainWorldCheckSucceeded, true);
    assert.ok(Object.values(state).every((value) => typeof value === 'boolean'));
  }
  assert.equal(JSON.stringify(logs).includes('synthetic-private'), false);
  sandbox.window = {};
  pendingCheck();
  assert.equal(logs.at(-1)[1].mainWorldCheckSucceeded, false);
});

test('content tracks separate Compose views, manual capture, and destroy cleanup without send hooks', async () => {
  let registerCompose;
  let keydown;
  const records = [];
  const timers = new Map();
  let timerId = 0;
  const sandbox = vm.createContext({
    YubinBoxProbe: probe,
    YubinBoxPocConfig: { appId: 'synthetic-test-only', sdkVersion: 'fixture', diagnosticOutput: true },
    InboxSDK: { load: async () => ({
      Conversations: { registerThreadViewHandler() {} },
      Compose: { registerComposeViewHandler(fn) { registerCompose = fn; } },
    }) },
    console: { info() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {}, log(value) { records.push(JSON.parse(value.startsWith('[YubinBox PoC]') ? value.slice(value.indexOf('\n') + 1) : value)); } },
    document: { addEventListener(name, fn) { assert.equal(name, 'keydown'); keydown = fn; } },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(await readFile(new URL('../src/content.js', import.meta.url), 'utf8'), sandbox);
  await new Promise(setImmediate);
  const first = Object.assign(new EventEmitter(), { getSubject: () => 'first' });
  const second = Object.assign(new EventEmitter(), { getSubject: () => 'second' });
  registerCompose(first);
  registerCompose(second);
  assert.equal(records.find((r) => r.compose === 'compose-1').subject.value, 'first');
  assert.equal(records.find((r) => r.compose === 'compose-2').subject.value, 'second');
  assert.equal(first.listenerCount('presending'), 0);
  first.getSubject = () => 'edited';
  first.emit('subjectChanged');
  for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
  assert.equal(records.at(-1).subject.value, 'edited');
  first.emit('bodyChanged');
  first.destroyed = true;
  first.emit('destroy');
  assert.equal(timers.size, 0);
  assert.equal(first.listenerCount('subjectChanged'), 0);
  const before = records.length;
  keydown({ isTrusted: true, altKey: true, shiftKey: true, code: 'KeyY' });
  await new Promise(setImmediate);
  assert.ok(records.length > before);
  assert.ok(records.slice(before).every((r) => r.compose === 'compose-2'));
});
