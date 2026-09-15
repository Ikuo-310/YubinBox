// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';

const scripts = await Promise.all(['probe', 'dom-action', 'attachments', 'content'].map(async (name) =>
  readFile(new URL(`../src/${name}.js`, import.meta.url), 'utf8')));
for (const source of ['message-menu', 'thread-bottom-reply']) {
  for (const registered of [false, true]) {
    test(`real PoC module handoff: ${source}, identities ${registered ? 'registered' : 'absent'}`, async () => {
      const address = 'reply-fixture@example.invalid';
      const registry = registered ? [{ id: 'reply-fixture', address, transport: 'yubinbox' }] : [];
      let composeHandler;
      let click;
      let sourceReads = 0;
      const logs = [];
      const button = { tagName: 'BUTTON', parentElement: null,
        getAttribute: (name) => name === 'aria-label' ? 'その他のメッセージ オプション' : null,
        hasAttribute: () => false };
      const message = Object.assign(new EventEmitter(), {
        isLoaded: () => true,
        getElement: () => ({ contains: (node) => node === button }),
        getMessageIDAsync: async () => 'fixture-source-message',
        getRecipientEmailAddresses() { assert.equal(this, message); sourceReads++; return [address]; },
        getRecipientsFull: () => new Promise(() => {}), // Actual helper timeout path.
      });
      const thread = Object.assign(new EventEmitter(), {
        getThreadIDAsync: async () => 'fixture-thread',
        getMessageViewsAll: () => [message],
      });
      const compose = Object.assign(new EventEmitter(), {
        isReply: () => true, isForward: () => false,
        getThreadID: () => 'fixture-thread', getCurrentDraftID: async () => 'fixture-draft',
        getToRecipients: () => [], getCcRecipients: () => [], getBccRecipients: () => [],
        getSubject: () => 'Fixture', getTextContent: () => '', getHTMLContent: () => '',
      });
      const context = vm.createContext({
        YubinBoxPocConfig: { appId: 'fixture-only', diagnosticOutput: true, identities: registry },
        InboxSDK: { load: async () => ({
          Conversations: {
            registerThreadViewHandler(fn) { fn(thread); },
            registerMessageViewHandler(fn) { fn(message); },
          },
          Compose: { registerComposeViewHandler(fn) { composeHandler = fn; } },
        }) },
        document: { addEventListener(type, fn) { if (type === 'click') click = fn; } },
        console: { log: (line) => logs.push(line), info() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {} },
        // Preserve the timeout behavior without waiting four seconds per test.
        setTimeout: (fn, delay) => delay === 30000 ? null : setTimeout(fn, delay === 4000 ? 1 : delay),
        clearTimeout,
      });
      for (const script of scripts) vm.runInContext(script, context);
      await new Promise(setImmediate);
      if (source === 'message-menu') click({ target: button, isTrusted: true });
      composeHandler(compose);
      await new Promise((resolve) => setTimeout(resolve, 40));
      const jsonLog = (prefix) => JSON.parse(logs.find((line) => line.startsWith(prefix)).split('\n').slice(1).join('\n'));
      const related = jsonLog('[YubinBox PoC][related]');
      const data = jsonLog('[YubinBox PoC][sending-data]');
      assert.equal(related.relatedMessages.candidates[0].visibleRecipientEmails.value[0], address);
      assert.equal(related.relatedMessages.candidates[0].recipientsFull.status, 'timeout');
      assert.equal(data.sourceMessage.source, source);
      assert.equal(data.sourceMessage.gmailMessageId, 'fixture-source-message');
      assert.deepEqual(data.sourceRecipientEmails, [address]);
      assert.equal(data.recipientSource, 'visible-recipient-emails');
      assert.equal(data.identityResolution, 'auto');
      assert.equal(data.transport, registered ? 'yubinbox' : 'gmail');
      assert.equal(data.matchedIdentity?.address ?? null, registered ? address : null);
      if (!registered) {
        assert.equal(data.identityReason, 'no-yubinbox-identity-match');
        assert.equal(data.sendingIdentity, null);
        assert.equal(data.identityConfirmation.readOnly, true);
        assert.equal(data.identityConfirmation.selectionAllowed, false);
      }
      assert.ok(sourceReads >= 2); // related and source resolver, same SDK instance.
    });
  }
}
