// SPDX-License-Identifier: AGPL-3.0-only
(() => {
  if (globalThis.YubinBoxPocConfig?.diagnosticOutput === true) {
    console.log('[YubinBox PoC][dom-helper] loaded');
  }
  const labels = new Map([
    ['reply', 'reply'], ['返信', 'reply'],
    ['reply all', 'replyAll'], ['全員に返信', 'replyAll'],
    ['forward', 'forward'], ['転送', 'forward'],
  ]);
  function classify(label) {
    return typeof label === 'string' ? labels.get(label.trim().toLowerCase()) ?? 'unknown' : 'unknown';
  }
  function actionOf(element) {
    const actions = ['aria-label', 'title'].map((key) => classify(element?.getAttribute?.(key)))
      .filter((action) => action !== 'unknown');
    return new Set(actions).size === 1 ? actions[0] : 'unknown';
  }
  function clickMetadata(element) {
    const safeLabel = (value) => value == null ? null
      : classify(value) === 'unknown' ? '<redacted-unrecognized-label>'
        : value.trim().toLowerCase();
    const basic = metadata(element);
    return {
      tagName: basic.tagName, role: basic.role,
      'aria-label': safeLabel(element?.getAttribute?.('aria-label')),
      title: safeLabel(element?.getAttribute?.('title')),
    };
  }
  function observedAttributes(element) {
    const safe = (value) => {
      if (typeof value !== 'string') return null;
      const appId = globalThis.YubinBoxPocConfig?.appId;
      // Only these four attributes are observed. Keep unknown UI labels intact,
      // but suppress known configuration and credential-shaped strings.
      if ((appId && value.includes(appId)) ||
          /sdk_|bearer\s|token|password|passwd|secret|authorization|credential|smtp|認証|パスワード/i.test(value)) {
        return '<redacted-credential>';
      }
      return value.replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g, '<email>');
    };
    return {
      tagName: safe(element?.tagName), role: safe(element?.getAttribute?.('role')),
      'aria-label': safe(element?.getAttribute?.('aria-label')),
      title: safe(element?.getAttribute?.('title')),
    };
  }
  // No textContent, innerHTML, arbitrary attribute values, IDs or classes.
  // Presence of narrowly selected identifiers is useful without exposing data.
  function metadata(element) {
    const get = (key) => element?.getAttribute?.(key);
    const role = get('role');
    const tag = element?.tagName;
    return {
      tagName: ['DIV', 'SPAN', 'BUTTON', 'A', 'SVG', 'PATH'].includes(tag) ? tag : 'other',
      role: ['button', 'menuitem', 'menu', 'listitem', 'article'].includes(role) ? role : null,
      ariaLabelAction: classify(get('aria-label')), titleAction: classify(get('title')),
      idPresent: Boolean(element?.hasAttribute?.('id')),
      classPresent: Boolean(element?.hasAttribute?.('class')),
      identifiersPresent: ['data-message-id', 'data-legacy-message-id', 'data-thread-id', 'data-legacy-thread-id']
        .filter((key) => element?.hasAttribute?.(key)),
    };
  }
  function summarize(action, domTarget, containers, matches) {
    return {
      action, domTarget, containers,
      candidateMatches: matches,
      candidateStatus: matches.length === 0 ? 'no-candidate' : matches.length === 1 ? 'single-candidate' : 'multiple-candidates',
      exactReplyTarget: { status: 'unverified', value: null,
        reason: 'Click containment is diagnostic evidence only; no Compose association or Gmail action completion is proven. Detached menus may have no containing MessageView.' },
    };
  }
  function createPendingTracker(log, now = Date.now, readId = (view) => globalThis.YubinBoxProbe.readAsync(view, 'getMessageIDAsync')) {
    const ttlMs = 5000;
    let pendingDomMessageTarget = null;
    function capture(matches) {
      // Even a failed/new menu click invalidates the previous candidate.
      pendingDomMessageTarget = null;
      const capturedAt = now();
      const record = { capturedAt, matchCount: matches.length, confidence: 'medium',
        reason: 'more-options-button-inside-single-message-view' };
      if (matches.length !== 1) {
        log(`[YubinBox PoC][dom-pending-target]\n${JSON.stringify({ ...record,
          gmailMessageId: null, confidence: 'low', stored: false, reason: 'requires-single-message-view' })}`);
        return;
      }
      const view = matches[0];
      const pending = { ...record, view };
      pendingDomMessageTarget = pending;
      // Reserve synchronously so a Compose detected before the async ID resolves
      // can consume this click, without re-arming it when the lookup completes.
      pending.ready = Promise.resolve().then(() => readId(view)).catch(() => ({ status: 'error' })).then((id) => {
        const valid = !view.destroyed && now() - capturedAt < ttlMs &&
          id.status === 'ok' && typeof id.value === 'string' && id.value.length > 0;
        const result = { ...record, gmailMessageId: valid ? id.value : null };
        log(`[YubinBox PoC][dom-pending-target]\n${JSON.stringify({ ...result,
          stored: valid && pendingDomMessageTarget === pending,
          reason: valid ? record.reason : 'id-unavailable-destroyed-or-expired' })}`);
        return valid ? result : null;
      });
    }
    async function correlate(compose, isReply) {
      const pending = pendingDomMessageTarget;
      pendingDomMessageTarget = null; // Any newly detected Compose consumes it.
      const age = pending ? now() - pending.capturedAt : null;
      const result = isReply === true && pending && age >= 0 && age < ttlMs
        ? await pending.ready : null;
      const ageMs = pending ? now() - pending.capturedAt : null;
      const valid = Boolean(result && !pending.view.destroyed && ageMs >= 0 && ageMs < ttlMs);
      log(`[YubinBox PoC][dom-compose-correlation]\n${JSON.stringify({
        compose, isReply, pendingTarget: valid ? { ...result, ageMs } : null,
        correlated: valid, ttlMs,
        reason: valid ? 'temporal-diagnostic-candidate-only-not-exact-reply-target'
          : 'no-fresh-single-target-or-not-reply',
      })}`);
    }
    return { capture, correlate };
  }
  function start(sdk, enabled, doc = document, log = (line) => console.log(line)) {
    if (enabled !== true) return;
    const views = new Set();
    const pending = createPendingTracker(log);
    let clickCount = 0;
    sdk.Conversations.registerMessageViewHandler((view) => {
      views.add(view);
      view.on('destroy', () => views.delete(view));
    });
    doc.addEventListener('click', (event) => {
      // Bound the ancestor search; only aria/title-labelled reply controls.
      let control = event.target;
      let action = 'unknown';
      const ancestry = [];
      let conflictingLabels = false;
      for (let depth = 0; control && depth < 8; depth++, control = control.parentElement) {
        const ariaAction = classify(control.getAttribute?.('aria-label'));
        const titleAction = classify(control.getAttribute?.('title'));
        conflictingLabels ||= ariaAction !== 'unknown' && titleAction !== 'unknown' && ariaAction !== titleAction;
        ancestry.push({ depth, ...clickMetadata(control) });
        action = actionOf(control);
        if (action !== 'unknown') break;
      }
      // Bounded to the first 30 received clicks per page load. Classification
      // and existing action diagnostics continue after this diagnostic budget.
      if (clickCount < 30) {
        clickCount++;
        const observed = [];
        if (action === 'unknown' && event.isTrusted) {
          for (let node = event.target, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
            observed.push({ depth, ...observedAttributes(node) });
          }
        }
        log(`[YubinBox PoC][dom-click]\n${JSON.stringify({
          sequence: clickCount, limit: 30, lastSample: clickCount === 30,
          isTrusted: event.isTrusted === true,
          target: clickMetadata(event.target), ancestry, action,
          ...(observed.length ? { observedAttributes: observed } : {}),
          classificationReason: !event.isTrusted ? 'untrusted-event-ignored'
            : action !== 'unknown' ? 'exact-supported-label-on-target-or-ancestor'
              : conflictingLabels ? 'conflicting-action-labels'
                : 'no-exact-supported-label-within-8-levels',
        }, null, 2)}`);
      }
      if (!event.isTrusted) return;
      // Observe only the explicitly verified menu-button label. Menu item text
      // is not read; this does not extend Reply / Reply All / Forward rules.
      for (let node = event.target, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
        if ((node.tagName === 'BUTTON' || node.getAttribute?.('role') === 'button') &&
            ['aria-label', 'title'].some((key) => node.getAttribute?.(key) === 'その他のメッセージ オプション')) {
          const matches = [];
          for (const view of views) {
            if (view.destroyed) continue;
            try {
              const root = view.getElement();
              if (root === node || root.contains(node)) matches.push(view);
            } catch { /* No raw exceptions or fallback ID matching. */ }
          }
          pending.capture(matches);
          break;
        }
      }
      if (action === 'unknown') return;
      const domTarget = { clicked: metadata(event.target), control: metadata(control) };
      const containers = [];
      for (let node = control.parentElement, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
        containers.push({ ancestorDepth: depth + 1, ...metadata(node) });
      }
      // Capture containment synchronously, before Gmail potentially removes UI.
      const matches = [];
      for (const view of views) {
        if (view.destroyed) continue;
        try {
          const root = view.getElement();
          if (root === control || root.contains(control)) matches.push({ view, container: metadata(root) });
        } catch { /* No SDK exception contents in DOM diagnostics. */ }
      }
      void Promise.all(matches.map(async ({ view, container }) => {
        const id = await globalThis.YubinBoxProbe.readAsync(view, 'getMessageIDAsync');
        const thread = globalThis.YubinBoxProbe.read(view, 'getThreadView');
        const threadId = thread.status === 'ok'
          ? await globalThis.YubinBoxProbe.readAsync(thread.value, 'getThreadIDAsync') : null;
        return {
          gmailMessageId: typeof id.value === 'string' ? id.value : null,
          messageIdStatus: id.status,
          gmailThreadId: typeof threadId?.value === 'string' ? threadId.value : null,
          threadIdStatus: threadId?.status ?? thread.status,
          container, matchReason: 'SDK MessageView.getElement() contains the labelled clicked control; no DOM ID comparison.',
          confidence: matches.length === 1 ? 'medium' : 'low',
        };
      })).then((candidates) => {
        log(`[YubinBox PoC][dom-action]\n${JSON.stringify(summarize(action, domTarget, containers, candidates), null, 2)}`);
      }).catch(() => {
        log('[YubinBox PoC][dom-action]\n{"status":"error","reason":"Diagnostic lookup failed; exception details omitted."}');
      });
    }, { capture: true, passive: true });
    log('[YubinBox PoC][dom-helper] listener-installed');
    return pending;
  }
  globalThis.YubinBoxDomAction = Object.freeze({ classify, actionOf, metadata, summarize, start, createPendingTracker });
})();
