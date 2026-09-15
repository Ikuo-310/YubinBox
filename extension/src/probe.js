// SPDX-License-Identifier: AGPL-3.0-only
// Plain content-script helpers, also exercised with Node's built-in test runner.
(() => {
  console.info('[YubinBox PoC][probe] execution started');
  function applyFirefoxRuntimeShim() {
    // Firefox exposes extension globals on the content-script global, which
    // is distinct from its Xray-wrapped window. Never unwrap that window or
    // export functions/objects to the page. Xray expandos stay in this sandbox.
    const globalChrome = typeof chrome !== 'undefined' ? chrome : undefined;
    const globalBrowser = typeof browser !== 'undefined' ? browser : undefined;
    const isolatedWindow = globalThis.window;
    let shimApplied = false;
    const state = () => ({
      globalChromePresent: typeof globalChrome !== 'undefined',
      windowChromePresent: typeof isolatedWindow?.chrome !== 'undefined',
      chromeRuntimePresent: Boolean(globalChrome?.runtime),
      browserPresent: typeof globalBrowser !== 'undefined',
      browserRuntimePresent: Boolean(globalBrowser?.runtime),
      shimApplied,
    });
    console.info('[YubinBox PoC][compat][before]', state());
    try {
      const runtime = globalChrome?.runtime;
      // InboxSDK uses chrome.runtime.sendMessage(message, callback). Do not
      // alias the Promise-oriented browser.runtime or implement a proxy.
      if (/Firefox\//.test(globalThis.navigator?.userAgent ?? '') &&
          isolatedWindow && isolatedWindow !== globalThis &&
          typeof isolatedWindow.chrome === 'undefined' &&
          typeof runtime?.sendMessage === 'function' &&
          typeof runtime?.getURL === 'function' &&
          runtime.getURL('').startsWith('moz-extension://')) {
        Object.defineProperty(isolatedWindow, 'chrome', {
          value: { runtime }, configurable: true, writable: true,
        });
        shimApplied = true;
      }
    } catch {
      // Unavailable/non-writable APIs leave the original SDK path untouched.
      // Exception details and runtime URLs must not enter these logs.
    }
    console.info('[YubinBox PoC][compat][after]', state());
  }
  function sanitizeLoadError(error, appId) {
    const field = (key) => {
      try { return typeof error?.[key] === 'string' ? error[key] : undefined; }
      catch { return undefined; }
    };
    const name = field('name');
    const message = field('message');
    const safeNames = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'SecurityError', 'NotAllowedError', 'AbortError'];
    let sanitizedMessage = '<message unavailable>';
    if (message !== undefined) {
      // Arbitrary mail subjects/bodies and credentials cannot be reliably
      // detected with regexes. Reconstruct recognized engine errors only;
      // never pass through unknown text, URLs, quoted values or identifiers.
      let text = appId ? message.split(appId).join('<app-id>') : message;
      text = text.replace(/sdk_[^\s"'<>]+/g, '<app-id>');
      text = text.replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g, '<email>');
      const hadEmail = text.includes('<email>');
      const tooLong = text.length > 4096;
      text = text.slice(0, 4096);
      // These are fixed SDK/platform symbols, not arbitrary property names.
      const symbols = new Set([
        'window', 'document', 'globalThis', 'chrome', 'browser', 'runtime',
        'sendMessage', 'getURL', 'head', 'body', 'classList', 'hasAttribute',
        'addEventListener', 'dispatchEvent', 'createElement', 'querySelector',
        'InboxSDK', 'load', 'Conversations', 'Compose',
        'registerThreadViewHandler', 'registerComposeViewHandler',
        'then', 'catch', 'has', 'get', 'set', 'add', 'isArray', 'defineProperty',
      ]);
      const safeSymbol = (value) => symbols.has(value) ? value : '<identifier>';
      const safeExpression = (value) => value.split('.').every((part) => symbols.has(part))
        ? value : '<expression>';
      let match;
      if (tooLong) sanitizedMessage = '<redacted oversized message>';
      else if ((match = /^can't access property "([^"]+)", (.+) is (undefined|null)$/.exec(text))) {
        sanitizedMessage = `can't access property "${safeSymbol(match[1])}", ${safeExpression(match[2])} is ${match[3]}`;
      } else if ((match = /^Cannot read properties of (undefined|null) \(reading ['"]([^'"]+)['"]\)$/.exec(text))) {
        sanitizedMessage = `Cannot read properties of ${match[1]} (reading '${safeSymbol(match[2])}')`;
      } else if ((match = /^(.+) is not a function$/.exec(text))) {
        sanitizedMessage = `${safeExpression(match[1])} is not a function`;
      } else if ((match = /^(.+) is (undefined|null)$/.exec(text))) {
        sanitizedMessage = `${safeExpression(match[1])} is ${match[2]}`;
      } else if (["can't convert undefined to object", 'Cannot convert undefined or null to object', 'cyclic object value', 'Illegal invocation'].includes(text)) {
        sanitizedMessage = text;
      } else {
        sanitizedMessage = '<redacted unrecognized message>';
      }
      if (hadEmail) sanitizedMessage += ' <email>';
      sanitizedMessage = sanitizedMessage.slice(0, 240);
    }
    return {
      name: safeNames.includes(name) ? name : 'OtherError',
      sanitizedMessage,
      messagePresent: message !== undefined,
      stackPresent: field('stack') !== undefined,
    };
  }
  const unavailable = (reason) => ({ status: 'not-collected', reason });
  const unsupported = (reason) => ({ api: null, status: 'unsupported', value: null, attempted: false, reason });
  const exactTarget = () => unsupported('No public ComposeView-to-MessageView association API in core 2.2.24. Thread membership, order, sender and recipient counts do not identify the reply target.');
  const replyAll = () => unsupported('isReply() does not distinguish Reply from Reply All; no dedicated public getter. Record the Gmail operation manually.');
  const originalRecipientRoles = () => unsupported('getRecipientsFull() combines To/Cc/Bcc; original To and Cc cannot be separated with the reviewed public APIs.');
  const rfcHeaders = () => ({
    messageId: unsupported('No public RFC Message-ID getter in core 2.2.24; Gmail message IDs are not RFC Message-IDs.'),
    references: unsupported('No public References getter in core 2.2.24.'),
    inReplyTo: unsupported('No public In-Reply-To getter in core 2.2.24. No reply header is inferred from thread membership.'),
  });
  const valueResult = (value) => value == null
    ? { status: 'empty', value: null }
    : { status: 'ok', value };
  function read(target, method) {
    if (typeof target?.[method] !== 'function') return { status: 'api-unavailable', api: method };
    try {
      return { api: method, ...valueResult(target[method]()) };
    } catch {
      // Do not copy exception messages: SDK errors may contain mail data.
      return { api: method, status: 'error' };
    }
  }
  async function readAsync(target, method, timeoutMs = 4000) {
    if (typeof target?.[method] !== 'function') return { status: 'api-unavailable', api: method };
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => target[method]()).then(
          (value) => ({ api: method, ...valueResult(value) }),
          () => ({ api: method, status: 'error' }),
        ),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ api: method, status: 'timeout' }), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function composeFields(view) {
    return {
      mode: {
        isReply: read(view, 'isReply'),
        isForward: read(view, 'isForward'),
        isInlineReplyForm: read(view, 'isInlineReplyForm'),
        replyVsReplyAll: replyAll(),
      },
      to: read(view, 'getToRecipients'),
      cc: read(view, 'getCcRecipients'),
      bcc: read(view, 'getBccRecipients'),
      subject: read(view, 'getSubject'),
      bodyText: read(view, 'getTextContent'),
      bodyHTML: read(view, 'getHTMLContent'),
      gmailInternalIds: { threadId: read(view, 'getThreadID') },
      exactReplyTarget: exactTarget(),
      rfcHeaders: rfcHeaders(),
    };
  }
  async function relatedMessages(threadId, threadViews) {
    if (threadId.status !== 'ok' || !threadId.value) {
      return unavailable('No Compose Gmail thread ID; no reply-source inference.');
    }
    const threads = await Promise.all(threadViews.filter((v) => !v.destroyed).map(async (view) => ({
      view, id: await readAsync(view, 'getThreadIDAsync'),
    })));
    const matches = threads.filter(({ view, id }) => !view.destroyed && id.status === 'ok' && id.value === threadId.value);
    const candidates = [];
    const viewErrors = [];
    for (const { view } of matches) {
      const all = read(view, 'getMessageViewsAll');
      if (all.status !== 'ok') { viewErrors.push(all); continue; }
      candidates.push(...await Promise.all(all.value.filter((v) => !v.destroyed).map(async (message, index) => {
        const loaded = read(message, 'isLoaded');
        if (loaded.value !== true) return { index, loaded, details: unavailable('Expand the original message in Gmail and capture again.') };
        const [gmailMessageId, recipientsFull] = await Promise.all([
          readAsync(message, 'getMessageIDAsync'),
          readAsync(message, 'getRecipientsFull'),
        ]);
        return {
          index, loaded, gmailMessageId,
          sender: read(message, 'getSender'),
          visibleRecipientEmails: read(message, 'getRecipientEmailAddresses'),
          recipientsFull,
          recipientMeaning: 'Combined recipients; not separate original To/Cc or forwarding envelope headers.',
        };
      })));
    }
    return {
      status: matches.length ? 'same-thread-candidates' : 'no-matching-observed-thread',
      exactReplyTarget: 'unverified',
      threadLookups: threads.map(({ id }) => id),
      viewErrors, candidates,
      note: 'Same-thread membership does not prove which message is being replied to. RFC headers are not collected.',
    };
  }
  // Copy only diagnostic fields. Never serialize SDK objects or invoke toJSON.
  function diagnosticPlain(value, related = false) {
    const string = (v) => typeof v === 'string' ? v : null;
    const boolean = (v) => typeof v === 'boolean' ? v : null;
    const number = (v) => Number.isFinite(v) ? v : null;
    const contact = (v) => ({ name: string(v?.name), emailAddress: string(v?.emailAddress) });
    const list = (v, convert) => Array.isArray(v) ? Array.from(v, convert) : [];
    const result = (v, convert = string) => ({
      api: string(v?.api), status: string(v?.status),
      value: convert(v?.value),
    });
    const contacts = (v) => list(v, contact);
    const identityCandidates = (v) => ({
      api: 'getRecipientsFull', status: string(v?.status),
      value: contacts(v?.value), selectedIdentity: null,
      reason: 'Combined recipient candidates only; no configured identities or exact reply target to select from.',
    });
    const base = {
      compose: string(value?.compose), revision: number(value?.revision),
      reason: string(value?.reason), capturedAt: string(value?.capturedAt),
    };
    if (related) return {
      ...base, completedAt: string(value?.completedAt),
      changedDuringLookup: boolean(value?.changedDuringLookup),
      gmailInternalDraftId: result(value?.gmailInternalDraftId),
      exactReplyTarget: exactTarget(), rfcHeaders: rfcHeaders(),
      relatedMessages: {
        status: string(value?.relatedMessages?.status), exactReplyTarget: exactTarget(),
        reason: string(value?.relatedMessages?.reason),
        threadLookups: list(value?.relatedMessages?.threadLookups, (v) => result(v)),
        viewErrors: list(value?.relatedMessages?.viewErrors, (v) => result(v)),
        candidates: list(value?.relatedMessages?.candidates, (v) => ({
          index: number(v?.index), loaded: result(v?.loaded, boolean),
          gmailMessageId: result(v?.gmailMessageId), sender: result(v?.sender, contact),
          visibleRecipientEmails: result(v?.visibleRecipientEmails, (v) => list(v, string)),
          recipientsFull: result(v?.recipientsFull, contacts),
          originalTo: originalRecipientRoles(), originalCc: originalRecipientRoles(),
          receivingIdentityCandidates: identityCandidates(v?.recipientsFull),
          rfcHeaders: rfcHeaders(),
        })),
      },
    };
    return {
      ...base,
      mode: {
        isReply: result(value?.mode?.isReply, boolean),
        isForward: result(value?.mode?.isForward, boolean),
        isInlineReplyForm: result(value?.mode?.isInlineReplyForm, boolean),
        replyVsReplyAll: replyAll(),
      },
      to: result(value?.to, contacts), cc: result(value?.cc, contacts), bcc: result(value?.bcc, contacts),
      subject: result(value?.subject), bodyText: result(value?.bodyText), bodyHTML: result(value?.bodyHTML),
      gmailInternalIds: { threadId: result(value?.gmailInternalIds?.threadId) },
      exactReplyTarget: exactTarget(),
      rfcHeaders: rfcHeaders(),
    };
  }
  function composeMode(fields) {
    if (fields?.mode?.isForward?.value === true) return 'forward';
    return fields?.mode?.isForward?.value === false && fields?.mode?.isReply?.value === true ? 'reply' : 'new';
  }
  function registeredIdentities(values) {
    if (!Array.isArray(values)) return [];
    const identities = values.filter((v) => v && typeof v.id === 'string' && v.id.length > 0 &&
      typeof v.address === 'string' && /^[^\s@]+@[^\s@]+$/.test(v.address) &&
      ['gmail', 'yubinbox'].includes(v.transport))
      .map((v) => ({ id: v.id, address: v.address, transport: v.transport }));
    // Duplicate ids cannot safely be selected by id.
    return identities.filter((v) => identities.filter((other) => other.id === v.id).length === 1);
  }
  async function sourceRecipients(view, identities) {
    const visible = read(view, 'getRecipientEmailAddresses');
    const emails = visible.status === 'ok' && Array.isArray(visible.value)
      ? visible.value.filter((v) => typeof v === 'string') : [];
    const matches = registeredIdentities(identities).filter((v) => emails.some((email) => email.toLowerCase() === v.address.toLowerCase()));
    if (matches.length === 1) return { status: 'ok', visibleRecipientEmails: emails, value: emails.map((emailAddress) => ({ emailAddress })),
      recipientSource: 'visible-recipient-emails' };
    // An incomplete auxiliary list must never erase visible ambiguity.
    if (matches.length > 1) return { status: 'ok', visibleRecipientEmails: emails, value: emails.map((emailAddress) => ({ emailAddress })),
      recipientSource: 'visible-recipient-emails' };
    const full = await readAsync(view, 'getRecipientsFull');
    return { status: full.status, recipientSource: full.status === 'ok' ? 'recipients-full' : 'unavailable',
      value: full.status === 'ok' && Array.isArray(full.value) ? full.value.map((v) => ({
        emailAddress: typeof v?.emailAddress === 'string' ? v.emailAddress : null,
      })) : [], visibleRecipientEmails: emails };
  }
  async function resolveReplySource(mode, threadId, threadViews, pending, identities) {
    if (mode !== 'reply') return null;
    if (pending?.correlated === true) return pending;
    if (threadId?.status !== 'ok' || !threadId.value) return null;
    const matching = [];
    for (const thread of threadViews) {
      if (thread.destroyed) continue;
      const id = await readAsync(thread, 'getThreadIDAsync');
      if (id.status === 'ok' && id.value === threadId.value) matching.push(thread);
    }
    if (matching.length !== 1) return null;
    const messages = read(matching[0], 'getMessageViewsAll');
    if (messages.status !== 'ok' || !Array.isArray(messages.value)) return null;
    const view = messages.value.at(-1);
    if (!view || view.destroyed) return null;
    const id = await readAsync(view, 'getMessageIDAsync');
    if (id.status !== 'ok' || typeof id.value !== 'string' || !id.value || view.destroyed) return null;
    return { correlated: true, pendingTarget: { gmailMessageId: id.value, source: 'bottom-reply' },
      sourceRecipients: await sourceRecipients(view, identities) };
  }
  function sendingData(fields, draftId, correlation, identities, selectedIdentityId = null) {
    const mode = composeMode(fields);
    const plain = diagnosticPlain(fields);
    const registry = registeredIdentities(identities);
    const source = mode === 'reply' && correlation?.correlated === true ? correlation : null;
    const recipients = source?.sourceRecipients;
    const visible = Array.isArray(recipients?.visibleRecipientEmails)
      ? recipients.visibleRecipientEmails.filter((v) => typeof v === 'string').map((v) => v.toLowerCase()) : [];
    const visibleMatches = registry.filter((v) => visible.includes(v.address.toLowerCase()));
    // Visible recipients are observations, not the result of registry matching.
    // Preserve them when auxiliary lookup fails, even with an empty registry.
    const useVisible = visibleMatches.length > 0 ||
      (visible.length > 0 && (recipients?.status !== 'ok' || !recipients.value?.length));
    const addresses = useVisible ? visible : recipients?.status === 'ok' && Array.isArray(recipients.value)
      ? recipients.value.map((v) => typeof v?.emailAddress === 'string' ? v.emailAddress.toLowerCase() : null) : [];
    const matches = registry.filter((v) => addresses.includes(v.address.toLowerCase()));
    const automatic = mode === 'reply' && matches.length === 1 ? matches[0] : null;
    const nativeFallback = mode === 'reply' && matches.length === 0 && addresses.some((v) => typeof v === 'string' && v.length > 0);
    const autoResolved = Boolean(automatic || nativeFallback);
    const selected = registry.find((v) => v.id === selectedIdentityId) ?? null;
    const sendingIdentity = nativeFallback ? null : automatic ?? selected;
    const transport = nativeFallback ? 'gmail' : sendingIdentity?.transport ?? null;
    const identityResolution = mode !== 'reply' ? 'manual' : autoResolved ? 'auto' : 'manual-required';
    const reason = mode !== 'reply' ? 'user-selection-required' : automatic ? 'single-registered-recipient-match'
      : nativeFallback ? 'no-yubinbox-identity-match'
        : matches.length > 1 ? 'multiple-registered-recipient-matches' : 'source-recipients-unavailable';
    return {
      mode, sendingIdentity, transport, identityResolution,
      identityReason: reason,
      registeredIdentityCount: registry.length,
      sourceRecipientEmails: addresses.filter((v) => v !== null), matchedIdentity: automatic,
      recipientSource: useVisible ? 'visible-recipient-emails' : recipients?.recipientSource ?? (recipients?.status === 'ok' ? 'recipients-full' : 'unavailable'),
      identityConfirmation: { required: true, readOnly: autoResolved,
        selectionAllowed: !autoResolved, address: sendingIdentity?.address ?? null,
        transport },
      to: plain.to.value, cc: plain.cc.value, bcc: plain.bcc.value,
      subject: plain.subject.value, bodyText: plain.bodyText.value, bodyHtml: plain.bodyHTML.value,
      gmailThreadId: plain.gmailInternalIds.threadId.value,
      gmailDraftId: typeof draftId?.value === 'string' ? draftId.value : null,
      sourceMessage: { gmailMessageId: source?.pendingTarget?.gmailMessageId ?? null,
        source: source ? (source.pendingTarget.source === 'bottom-reply' ? 'thread-bottom-reply' : 'message-menu') : null },
      // Missing fields remain distinguishable; this PoC does not authorize send.
      fieldStatus: Object.fromEntries(['to', 'cc', 'bcc', 'subject', 'bodyText', 'bodyHTML'].map((key) => [key, plain[key].status])),
    };
  }
  globalThis.YubinBoxProbe = Object.freeze({ read, readAsync, composeFields, relatedMessages, unavailable, sanitizeLoadError, applyFirefoxRuntimeShim, diagnosticPlain, composeMode, registeredIdentities, sendingData, sourceRecipients, resolveReplySource });
})();
