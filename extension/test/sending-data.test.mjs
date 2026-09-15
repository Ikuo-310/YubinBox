// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
const scope = vm.createContext({ setTimeout, clearTimeout });
vm.runInContext(await readFile(new URL('../src/probe.js', import.meta.url), 'utf8'), scope);
const probe = scope.YubinBoxProbe;
const identities = [
  { id: 'domain', address: 'contact@example.invalid', transport: 'yubinbox', token: 'must-not-copy' },
  { id: 'gmail', address: 'account@example.invalid', transport: 'gmail' },
];
const fields = (reply, forward) => probe.composeFields({
  isReply: () => reply, isForward: () => forward,
  getToRecipients: () => [{ name: 'Recipient', emailAddress: 'to@example.invalid' }],
  getCcRecipients: () => [], getBccRecipients: () => [{ emailAddress: 'bcc@example.invalid' }],
  getSubject: () => 'Gmail subject', getTextContent: () => 'text', getHTMLContent: () => '<p>text</p>',
  getThreadID: () => 'gmail-thread-after-save',
});
const correlation = (addresses) => ({ correlated: true,
  pendingTarget: { gmailMessageId: 'gmail-internal-only' },
  sourceRecipients: { status: 'ok', value: addresses.map((emailAddress) => ({ emailAddress })) },
});
test('unregistered Reply recipients use Gmail native without inventing or retaining an identity', () => {
  for (const address of ['fixture@gmail.com', 'unregistered@example.invalid']) {
    for (const registry of [[], identities]) {
      const data = probe.sendingData(fields(true, false), {}, correlation([address]), registry, 'domain');
      assert.equal(data.sendingIdentity, null);
      assert.equal(data.matchedIdentity, null);
      assert.equal(data.transport, 'gmail');
      assert.equal(data.identityResolution, 'auto');
      assert.equal(data.identityReason, 'no-yubinbox-identity-match');
      assert.equal(data.registeredIdentityCount, registry.length);
      assert.equal(data.identityConfirmation.required, true);
      assert.equal(data.identityConfirmation.address, null);
      assert.equal(data.identityConfirmation.transport, 'gmail');
      assert.equal(data.identityConfirmation.readOnly, true);
      assert.equal(data.identityConfirmation.selectionAllowed, false);
    }
  }
});
for (const origin of ['message-menu', 'thread-bottom-reply']) {
  test(`${origin} preserves the exact source instance visible recipients through failed auxiliary handoff`, async () => {
    const local = vm.createContext({ setTimeout, clearTimeout });
    vm.runInContext(await readFile(new URL('../src/probe.js', import.meta.url), 'utf8'), local);
    vm.runInContext(await readFile(new URL('../src/dom-action.js', import.meta.url), 'utf8'), local);
    let visibleReads = 0;
    const sourceView = {
      getMessageIDAsync() { assert.equal(this, sourceView); return Promise.resolve('source-internal-id'); },
      getRecipientEmailAddresses() { assert.equal(this, sourceView); visibleReads++; return [identities[0].address]; },
      getRecipientsFull() { assert.equal(this, sourceView); return Promise.reject(new Error('fixture auxiliary failure')); },
    };
    // Collection has no registry yet; the final resolver has the registered
    // identities. Auxiliary failure must not discard successfully read emails.
    let source;
    if (origin === 'message-menu') {
      const tracker = local.YubinBoxDomAction.createPendingTracker(() => {});
      tracker.capture([sourceView]);
      source = await tracker.correlate('reply', true, false);
    } else {
      source = await local.YubinBoxProbe.resolveReplySource('reply', { status: 'ok', value: 'thread' }, [{
        getThreadIDAsync: async () => 'thread', getMessageViewsAll: () => [sourceView],
      }], null, []);
    }
    assert.equal(visibleReads, 1);
    assert.equal(source.sourceRecipients.visibleRecipientEmails[0], identities[0].address);
    const data = local.YubinBoxProbe.sendingData(fields(true, false), {}, source, identities);
    assert.equal(data.sourceMessage.gmailMessageId, 'source-internal-id');
    assert.equal(data.sourceMessage.source, origin);
    assert.equal(data.sourceRecipientEmails[0], identities[0].address);
    assert.equal(data.matchedIdentity.id, 'domain');
    assert.equal(data.transport, 'yubinbox');
    assert.equal(data.identityResolution, 'auto');
    assert.equal(data.recipientSource, 'visible-recipient-emails');
  });
}
test('auxiliary timeout cannot hide visible recipients at final identity resolution', () => {
  const source = { ...correlation([]), sourceRecipients: {
    status: 'timeout', value: [], recipientSource: 'unavailable', visibleRecipientEmails: [identities[0].address],
  } };
  const data = probe.sendingData(fields(true, false), {}, source, identities);
  assert.equal(data.identityResolution, 'auto');
  assert.equal(data.transport, 'yubinbox');
  assert.equal(data.identityConfirmation.readOnly, true);
  for (const mode of [fields(false, false), fields(true, true)]) {
    const other = probe.sendingData(mode, {}, source, identities);
    assert.equal(other.identityResolution, 'manual');
    assert.equal(other.matchedIdentity, null);
  }
});
for (const identity of identities) {
  test(`visible recipient selects ${identity.transport} without waiting for full recipients`, async () => {
    let fullCalls = 0;
    const recipients = await probe.sourceRecipients({
      getRecipientEmailAddresses: () => [identity.address.toUpperCase()],
      getRecipientsFull: () => { fullCalls++; return new Promise(() => {}); },
    }, identities);
    const source = { ...correlation([]), sourceRecipients: recipients };
    const data = probe.sendingData(fields(true, false), {}, source, identities);
    assert.equal(fullCalls, 0);
    assert.equal(data.transport, identity.transport);
    assert.equal(data.identityResolution, 'auto');
    assert.equal(data.recipientSource, 'visible-recipient-emails');
    assert.equal(data.identityConfirmation.readOnly, true);
  });
  test(`bottom source picks last MessageView and selects ${identity.transport}`, async () => {
    const last = { getMessageIDAsync: async () => 'last-message',
      getRecipientEmailAddresses: () => [identity.address] };
    const source = await probe.resolveReplySource('reply', { status: 'ok', value: 'thread' }, [{
      getThreadIDAsync: async () => 'thread',
      getMessageViewsAll: () => [{ getMessageIDAsync: () => assert.fail('not the last message') }, last],
    }], null, identities);
    const data = probe.sendingData(fields(true, false), {}, source, identities);
    assert.equal(data.sourceMessage.gmailMessageId, 'last-message');
    assert.equal(data.sourceMessage.source, 'thread-bottom-reply');
    assert.equal(data.transport, identity.transport);
    assert.equal(data.identityResolution, 'auto');
  });
}
test('full recipient fallback is used only when visible list cannot match an identity', async () => {
  const recipients = await probe.sourceRecipients({ getRecipientEmailAddresses: () => ['other@example.invalid'],
    getRecipientsFull: async () => [{ emailAddress: identities[0].address }] }, identities);
  assert.equal(recipients.recipientSource, 'recipients-full');
  assert.equal(probe.sendingData(fields(true, false), {}, { ...correlation([]), sourceRecipients: recipients }, identities).identityResolution, 'auto');
});
test('ambiguous visible identities stay manual and missing recipients fall back to manual', async () => {
  for (const emails of [identities.map((v) => v.address), []]) {
    const recipients = await probe.sourceRecipients({ getRecipientEmailAddresses: () => emails,
      getRecipientsFull: async () => [] }, identities);
    const data = probe.sendingData(fields(true, false), {}, { ...correlation([]), sourceRecipients: recipients }, identities);
    assert.equal(data.identityResolution, 'manual-required');
    assert.equal(data.sendingIdentity, null);
  }
});
test('fresh pending source wins without thread lookup; new and forward never explore source', async () => {
  const badThreads = [{ getThreadIDAsync: () => assert.fail('must not explore') }];
  const pending = correlation([identities[0].address]);
  assert.equal(await probe.resolveReplySource('reply', { status: 'ok', value: 'thread' }, badThreads, pending, identities), pending);
  for (const mode of ['new', 'forward']) {
    assert.equal(await probe.resolveReplySource(mode, { status: 'ok', value: 'thread' }, badThreads, pending, identities), null);
  }
});
for (const [reply, forward, expected] of [[false, false, 'new'], [true, false, 'reply'], [true, true, 'forward'], [false, true, 'forward']]) {
  test(`mode reply=${reply} forward=${forward} normalizes to ${expected}`, () => {
    assert.equal(probe.composeMode(fields(reply, forward)), expected);
  });
}
test('Reply uses one registered identity and its declared transport, not address suffix', () => {
  for (const identity of identities) {
    const data = probe.sendingData(fields(true, false), {}, correlation([identity.address.toUpperCase()]), identities);
    assert.equal(data.sendingIdentity.id, identity.id);
    assert.equal(data.transport, identity.transport);
    assert.equal(data.identityResolution, 'auto');
    assert.equal(data.identityConfirmation.readOnly, true);
    assert.equal(data.identityConfirmation.required, true);
    assert.equal(data.sourceMessage.source, 'message-menu');
    assert.equal(data.sourceMessage.gmailMessageId, 'gmail-internal-only');
    assert.equal(JSON.stringify(data).includes('must-not-copy'), false);
  }
});
test('Reply All shares Reply behavior and preserves Compose values including Bcc', () => {
  const data = probe.sendingData(fields(true, false), { value: 'draft' }, correlation([identities[0].address]), identities);
  assert.equal(data.mode, 'reply');
  assert.equal(data.subject, 'Gmail subject');
  assert.equal(data.bodyHtml, '<p>text</p>');
  assert.equal(data.bcc[0].emailAddress, 'bcc@example.invalid');
  for (const key of ['rfcMessageId', 'inReplyTo', 'references', 'rfcHeaders']) assert.equal(key in data, false);
});
test('missing, ambiguous and timed-out source recipients require manual fallback', () => {
  for (const source of [null, correlation([]), correlation(identities.map((v) => v.address)),
    { ...correlation([]), sourceRecipients: { status: 'timeout' } }]) {
    const data = probe.sendingData(fields(true, false), {}, source, identities);
    assert.equal(data.identityResolution, 'manual-required');
    assert.equal(data.sendingIdentity, null);
    assert.equal(data.identityConfirmation.selectionAllowed, true);
    const chosen = probe.sendingData(fields(true, false), {}, source, identities, 'gmail');
    assert.equal(chosen.transport, 'gmail');
  }
});
test('auto Reply cannot be overridden; unknown identity ids cannot select a transport', () => {
  const source = correlation([identities[0].address]);
  assert.equal(probe.sendingData(fields(true, false), {}, source, identities, 'gmail').transport, 'yubinbox');
  assert.equal(probe.sendingData(fields(false, false), {}, null, identities, 'unknown').transport, null);
});
test('new and forward require manual selection and ignore reply source even with saved thread ID', () => {
  for (const forward of [false, true]) {
    const data = probe.sendingData(fields(forward, forward), {}, correlation([identities[0].address]), identities, 'gmail');
    assert.equal(data.identityResolution, 'manual');
    assert.equal(data.transport, 'gmail');
    assert.equal(data.sourceMessage.gmailMessageId, null);
    assert.equal(data.gmailThreadId, 'gmail-thread-after-save');
  }
});
test('Forward consumes pending target without Reply correlation', async () => {
  vm.runInContext(await readFile(new URL('../src/dom-action.js', import.meta.url), 'utf8'), scope);
  const tracker = scope.YubinBoxDomAction.createPendingTracker(() => {}, () => 0,
    async () => ({ status: 'ok', value: 'fixture' }));
  tracker.capture([{}]);
  assert.equal((await tracker.correlate('forward', true, true)).correlated, false);
  assert.equal((await tracker.correlate('reply', true, false)).correlated, false);
});
for (const mode of ['new', 'reply', 'forward']) {
  test(`content integration retains ${mode} sending state and limits source lookup to reply`, async () => {
    let handler;
    let lookups = 0;
    const logs = [];
    const view = Object.assign(new EventEmitter(), {
      isReply: () => mode !== 'new', isForward: () => mode === 'forward',
      getThreadID: () => 'saved-thread', getCurrentDraftID: async () => 'saved-draft',
      getSubject: () => 'Unchanged subject', getBccRecipients: () => [],
    });
    const thread = Object.assign(new EventEmitter(), {
      getThreadIDAsync: async () => { lookups++; return 'saved-thread'; },
      getMessageViewsAll: () => [],
    });
    const context = vm.createContext({
      YubinBoxProbe: probe, YubinBoxPocConfig: { appId: 'fixture', diagnosticOutput: true, identities },
      YubinBoxDomAction: { start: () => ({ correlate: async (label, reply, forward) => {
        assert.equal(forward, mode === 'forward');
        return reply && !forward ? correlation([identities[0].address]) : null;
      } }) },
      InboxSDK: { load: async () => ({
        Conversations: { registerThreadViewHandler(fn) { fn(thread); } },
        Compose: { registerComposeViewHandler(fn) { handler = fn; } },
      }) },
      document: { addEventListener() {} }, setTimeout: () => 1, clearTimeout() {},
      console: { info() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {}, log: (v) => logs.push(v) },
    });
    vm.runInContext(await readFile(new URL('../src/content.js', import.meta.url), 'utf8'), context);
    await new Promise(setImmediate);
    handler(view);
    await new Promise(setImmediate);
    const data = context.YubinBoxComposeState.get('compose-1');
    assert.equal(data.mode, mode);
    assert.equal(data.gmailDraftId, 'saved-draft');
    assert.equal(lookups, mode === 'reply' ? 1 : 0);
    assert.equal(data.identityResolution, mode === 'reply' ? 'auto' : 'manual');
    assert.equal(context.YubinBoxComposeState.selectIdentity('compose-1', 'gmail'), mode !== 'reply');
    await new Promise(setImmediate);
    assert.equal(context.YubinBoxComposeState.get('compose-1').transport, mode === 'reply' ? 'yubinbox' : 'gmail');
    assert.ok(logs.some((v) => v.startsWith('[YubinBox PoC][sending-data]')));
  });
}
