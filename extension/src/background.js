// SPDX-License-Identifier: AGPL-3.0-only
/* global browser */
// InboxSDK's npm loader requests this protocol. Use Firefox's Promise API so
// injection errors are visible rather than acknowledging before execution.
console.info('[YubinBox PoC][background] started');
browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'yubinbox__inlineBlobDiagnostic') {
    if (globalThis.YubinBoxPocConfig?.diagnosticOutput !== true ||
        sender.id !== browser.runtime.id || !sender.tab || !sender.url?.startsWith('https://mail.google.com/') ||
        typeof message.url !== 'string' || !message.url.startsWith('blob:https://mail.google.com/')) {
      return Promise.resolve({ success: false, error: 'main-world-unavailable' });
    }
    return browser.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] }, world: 'MAIN',
      func: globalThis.YubinBoxInlineImages.fetchMetadata, args: [message.url],
    }).then((results) => results?.[0]?.result ?? { success: false, error: 'main-world-unavailable' },
      () => ({ success: false, error: 'main-world-unavailable' }));
  }
  if (message?.type !== 'inboxsdk__injectPageWorld') return undefined;
  console.info('[YubinBox PoC][background] injection request received', {
    gmailTabDetected: Boolean(sender.tab && sender.url?.startsWith('https://mail.google.com/')),
    sameExtension: sender.id === browser.runtime.id,
    tabId: sender.tab?.id,
    frameId: sender.frameId ?? 0,
  });
  if (sender.id !== browser.runtime.id || !sender.tab ||
      !sender.url?.startsWith('https://mail.google.com/')) {
    return Promise.resolve(false);
  }
  const injection = {
    target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] },
    world: 'MAIN',
    files: ['pageWorld.js'],
  };
  console.info('[YubinBox PoC][inject] executeScript calling', {
    files: injection.files, tabId: sender.tab.id,
    frameId: sender.frameId ?? 0, world: injection.world,
  });
  return browser.scripting.executeScript(injection).then((results) => {
    // pageWorld's return value / error text may contain page data. Log only
    // execution metadata, never the returned object or sender URL.
    console.info('[YubinBox PoC][inject] executeScript resolved', {
      hasError: Boolean(results?.some((result) => result.error)),
      resultCount: results?.length ?? 0,
      frames: results?.map((result) => ({
        frameId: result.frameId,
        resultType: typeof result.result,
        hasError: Boolean(result.error),
      })),
    });
    return true;
  }, (error) => {
    const safeNames = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'SecurityError', 'NotAllowedError', 'AbortError'];
    console.error('[YubinBox PoC][inject] executeScript rejected', {
      name: safeNames.includes(error?.name) ? error.name : 'OtherError',
      hasMessage: typeof error?.message === 'string',
      hasStack: typeof error?.stack === 'string',
      details: 'Raw exception omitted: it may contain page data or credentials.',
    });
    console.error('[YubinBox PoC] pageWorld injection failed. Check Gmail host access and Firefox >=128.');
    return false;
  });
});
