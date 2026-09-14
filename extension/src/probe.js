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
        replyVsReplyAll: unavailable('No dedicated public API found; compare manually labelled Reply / Reply All runs.'),
      },
      to: read(view, 'getToRecipients'),
      cc: read(view, 'getCcRecipients'),
      subject: read(view, 'getSubject'),
      bodyText: read(view, 'getTextContent'),
      bodyHTML: read(view, 'getHTMLContent'),
      gmailInternalIds: { threadId: read(view, 'getThreadID') },
      rfcHeaders: {
        messageId: unavailable('No public RFC Message-ID getter found. Gmail IDs are not RFC IDs.'),
        references: unavailable('No public References getter found.'),
        inReplyTo: unavailable('Exact reply target and its RFC Message-ID are unverified.'),
      },
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
    const base = {
      compose: string(value?.compose), revision: number(value?.revision),
      reason: string(value?.reason), capturedAt: string(value?.capturedAt),
    };
    if (related) return {
      ...base, completedAt: string(value?.completedAt),
      changedDuringLookup: boolean(value?.changedDuringLookup),
      gmailInternalDraftId: result(value?.gmailInternalDraftId),
      relatedMessages: {
        status: string(value?.relatedMessages?.status), exactReplyTarget: 'unverified',
        threadLookups: list(value?.relatedMessages?.threadLookups, (v) => result(v)),
        viewErrors: list(value?.relatedMessages?.viewErrors, (v) => result(v)),
        candidates: list(value?.relatedMessages?.candidates, (v) => ({
          index: number(v?.index), loaded: result(v?.loaded, boolean),
          gmailMessageId: result(v?.gmailMessageId), sender: result(v?.sender, contact),
          visibleRecipientEmails: result(v?.visibleRecipientEmails, (v) => list(v, string)),
          recipientsFull: result(v?.recipientsFull, contacts),
        })),
      },
    };
    return {
      ...base,
      mode: {
        isReply: result(value?.mode?.isReply, boolean),
        isForward: result(value?.mode?.isForward, boolean),
        isInlineReplyForm: result(value?.mode?.isInlineReplyForm, boolean),
        replyVsReplyAll: { status: 'not-collected', value: null },
      },
      to: result(value?.to, contacts), cc: result(value?.cc, contacts),
      subject: result(value?.subject), bodyText: result(value?.bodyText), bodyHTML: result(value?.bodyHTML),
      gmailInternalIds: { threadId: result(value?.gmailInternalIds?.threadId) },
      rfcHeaders: {
        messageId: { status: 'not-collected', value: null },
        references: { status: 'not-collected', value: null },
        inReplyTo: { status: 'not-collected', value: null },
      },
    };
  }
  globalThis.YubinBoxProbe = Object.freeze({ read, readAsync, composeFields, relatedMessages, unavailable, sanitizeLoadError, applyFirefoxRuntimeShim, diagnosticPlain });
})();
