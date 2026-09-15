// SPDX-License-Identifier: AGPL-3.0-only
/* global InboxSDK */
(() => {
  const prefix = '[YubinBox PoC]';
  const probe = globalThis.YubinBoxProbe;
  const config = globalThis.YubinBoxPocConfig;
  console.info('[YubinBox PoC][sdk] Gmail page check', {
    gmailTabDetected: globalThis.location?.origin === 'https://mail.google.com',
  });
  console.info('[YubinBox PoC][sdk] object check', {
    sdkPresent: typeof globalThis.InboxSDK !== 'undefined',
    loadType: typeof globalThis.InboxSDK?.load,
    probePresent: Boolean(probe),
    appIdConfigured: Boolean(config?.appId),
  });
  if (!probe || !config?.appId || typeof globalThis.InboxSDK?.load !== 'function') {
    console.error(`${prefix} Missing local config or bundled SDK. Rebuild and load dist/manifest.json.`);
    return;
  }
  const views = new Map();
  const threads = new Set();
  let sequence = 0;
  console.info(`${prefix} content script started; SDK load pending.`, { diagnosticOutput: config.diagnosticOutput === true });
  const watchdog = setTimeout(() => {
    console.warn('[YubinBox PoC][sdk] load pending after 30s. Inspect background / inject stages.');
    logLoadState('pending-30s');
  }, 30000);

  function logLoadState(stage) {
    let mainWorldMarkerPresent = false;
    let mainWorldCheckSucceeded = false;
    try {
      // Firefox's unwrapped page window observes MAIN world, unlike the
      // isolated content-script global. Test existence without reading values.
      const pageWindow = globalThis.window?.wrappedJSObject;
      if (pageWindow) {
        mainWorldMarkerPresent = '__InboxSDKInjected' in pageWindow;
        mainWorldCheckSucceeded = true;
      }
    } catch {
      // Do not expose page objects or exception contents in diagnostic logs.
    }
    console.info(`[YubinBox PoC][sdk-state][${stage}]`, {
      scriptInjectedAttributePresent: Boolean(document.head?.hasAttribute('data-inboxsdk-script-injected')),
      mainWorldInboxSDKInjectedPresent: mainWorldMarkerPresent,
      userEmailAttributePresent: Boolean(document.head?.hasAttribute('data-inboxsdk-user-email-address')),
      mainWorldCheckSucceeded,
    });
  }

  function output(label, value) {
    // A string snapshot avoids DevTools showing live, subsequently mutated objects.
    console.groupCollapsed(`${prefix} ${label}`);
    console.log(JSON.stringify(value, null, 2));
    console.groupEnd();
  }
  function diagnosticOutput(kind, value) {
    if (config.diagnosticOutput !== true) return;
    const plain = probe.diagnosticPlain(value, kind === 'related');
    // Keep prefix and payload in ONE message so Console text filtering cannot
    // hide the payload beneath a matching group heading.
    console.log(`${prefix}[${kind}]\n${JSON.stringify(plain, null, 2)}`);
  }
  let domDiagnostics;
  // UI-facing PoC state. Selection is by registered id only; no send operation.
  globalThis.YubinBoxComposeState = Object.freeze({
    get(compose) {
      const state = [...views.values()].find((v) => v.label === compose);
      return state?.sendingData ? JSON.parse(JSON.stringify(state.sendingData)) : null;
    },
    selectIdentity(compose, identityId) {
      const state = [...views.values()].find((v) => v.label === compose);
      if (!state?.sendingData || state.sendingData.identityConfirmation.readOnly ||
          !probe.registeredIdentities(config.identities).some((v) => v.id === identityId)) return false;
      state.selectedIdentityId = identityId;
      state.refresh();
      return true;
    },
  });
  function registerCompose(view) {
    if (views.has(view)) return;
    const state = { label: `compose-${++sequence}`, timers: new Map(), revision: 0, busy: false, listeners: [] };
    views.set(view, state);
    try { state.stopAttachments = globalThis.YubinBoxAttachments?.start(view, state.label, config.diagnosticOutput); }
    catch { /* Attachment diagnostics must not affect Compose registration. */ }
    try { state.stopInlineImages = globalThis.YubinBoxInlineImages?.start(view, state.label, config.diagnosticOutput); }
    catch { /* Independent inline image diagnostic. */ }
    try { state.stopDiscard = globalThis.YubinBoxDiscard?.start(view, state.label, config.diagnosticOutput); }
    catch { /* Independent read-only discard diagnostic. */ }
    try { state.stopDiscardTest = globalThis.YubinBoxDiscardTest?.start(view, state.label, config.diagnosticOutput); }
    catch { /* Explicit discard test initialization must not affect routing. */ }
    state.correlation = Promise.resolve(null);
    if (domDiagnostics && config.diagnosticOutput === true) {
      state.correlation = domDiagnostics.correlate(state.label, probe.read(view, 'isReply').value === true,
        probe.read(view, 'isForward').value ?? null).catch(() => null);
    }
    const capture = async (reason, includeRelated = true) => {
      if (view.destroyed || !views.has(view)) return;
      const revision = ++state.revision;
      if (config.diagnosticOutput !== true) {
        console.info(`${prefix} ${state.label} #${revision} ${reason}`, { diagnosticOutput: false });
        return;
      }
      const snapshot = {
        compose: state.label, revision, reason, capturedAt: new Date().toISOString(),
        ...probe.composeFields(view),
      };
      snapshot.relatedMessages = probe.unavailable('Related information is collected asynchronously for this event; match compose and revision.');
      diagnosticOutput('snapshot', snapshot);
      if (!includeRelated) return;
      const [draftId, related] = await Promise.all([
        probe.readAsync(view, 'getCurrentDraftID'),
        probe.composeMode(snapshot) === 'reply'
          ? probe.relatedMessages(snapshot.gmailInternalIds.threadId, [...threads])
          : Promise.resolve(probe.unavailable('Reply-source lookup skipped for new/forward Compose.')),
      ]);
      if (view.destroyed || !views.has(view)) return;
      diagnosticOutput('related', {
        compose: state.label, revision, reason, capturedAt: snapshot.capturedAt,
        completedAt: new Date().toISOString(), changedDuringLookup: state.revision !== revision,
        gmailInternalDraftId: draftId, relatedMessages: related,
      });
      const correlation = probe.composeMode(snapshot) === 'reply'
        ? await probe.resolveReplySource('reply', snapshot.gmailInternalIds.threadId, [...threads], await state.correlation, config.identities)
        : null;
      if (view.destroyed || !views.has(view) || state.revision !== revision) return;
      state.sendingData = probe.sendingData(snapshot, draftId, correlation, config.identities, state.selectedIdentityId);
      console.log(`${prefix}[sending-data]\n${JSON.stringify({ compose: state.label, revision, ...state.sendingData }, null, 2)}`);
    };
    const captureEvent = (reason) => {
      void capture(reason).catch(() => {
        console.error(`${prefix} ${state.label} ${reason} capture failed; exception details omitted.`);
      });
    };
    state.refresh = () => captureEvent('identity-selected');
    state.captureRelated = async () => {
      if (state.busy) return;
      state.busy = true;
      try { await capture('manual Alt+Shift+Y', true); }
      catch { console.error(`${prefix} ${state.label} manual capture failed; inspect SDK diagnostics locally.`); }
      finally { state.busy = false; }
    };
    for (const event of ['recipientsChanged', 'bodyChanged', 'subjectChanged', 'responseTypeChanged', 'draftSaved']) {
      const handler = () => {
        // Debounce each event type separately: draftSaved must not hide a
        // subjectChanged/bodyChanged snapshot. Every type collects relations.
        clearTimeout(state.timers.get(event));
        state.timers.set(event, setTimeout(() => {
          state.timers.delete(event);
          captureEvent(event);
        }, 500));
      };
      view.on(event, handler);
      state.listeners.push([event, handler]);
    }
    view.on('destroy', () => {
      try { state.stopAttachments?.(); } catch { /* Independent diagnostic cleanup. */ }
      try { state.stopInlineImages?.(); } catch { /* Independent diagnostic cleanup. */ }
      try { state.stopDiscard?.(); } catch { /* Independent diagnostic cleanup. */ }
      try { state.stopDiscardTest?.(); } catch { /* Independent diagnostic cleanup. */ }
      for (const timer of state.timers.values()) clearTimeout(timer);
      state.timers.clear();
      for (const [event, handler] of state.listeners) view.removeListener(event, handler);
      views.delete(view);
      console.info(`${prefix} ${state.label} destroyed`);
    });
    captureEvent('detected');
  }
  let loadResolved = false;
  probe.applyFirefoxRuntimeShim();
  console.info('[YubinBox PoC][sdk-load] InboxSDK.load calling', { apiVersion: 2 });
  logLoadState('before-load-call');
  InboxSDK.load(2, config.appId, { eventTracking: false, globalErrorLogging: false })
    .then((sdk) => {
      loadResolved = true;
      console.info('[YubinBox PoC][sdk-load] InboxSDK.load resolved');
      clearTimeout(watchdog);
      console.info('[YubinBox PoC][post-load] initialization started');
      output('SDK loaded', { sdkPackage: config.sdkVersion, loader: sdk.LOADER_VERSION, implementation: sdk.IMPL_VERSION });
      sdk.Conversations.registerThreadViewHandler((view) => {
        threads.add(view);
        view.on('destroy', () => threads.delete(view));
      });
      sdk.Compose.registerComposeViewHandler(registerCompose);
      // Independent diagnostic observer; failures must not affect the SDK PoC.
      try { domDiagnostics = globalThis.YubinBoxDomAction?.start(sdk, config.diagnosticOutput); }
      catch {
        if (config.diagnosticOutput === true) console.info('[YubinBox PoC][dom-action] observer unavailable');
      }
      document.addEventListener('keydown', (event) => {
        if (event.isTrusted && !event.repeat && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyY') {
          // No preventDefault, stopPropagation, send hooks or Gmail UI changes.
          if (!views.size) console.info(`${prefix} No active Compose views detected.`);
          for (const state of views.values()) void state.captureRelated();
        }
      });
      console.info(`${prefix} Ready. Compose events capture snapshots and related candidates when diagnosticOutput is true.`);
      console.info('[YubinBox PoC][post-load] initialization completed');
    })
    .catch((error) => {
      clearTimeout(watchdog);
      // Keep the same catch/cleanup behavior; the flag labels which phase
      // failed without retrying, rethrowing, or changing SDK initialization.
      console.error(loadResolved
        ? '[YubinBox PoC][post-load] initialization failed'
        : '[YubinBox PoC][sdk-load] load rejected',
      probe.sanitizeLoadError(error, config.appId));
    });
  logLoadState('after-load-call');
})();
