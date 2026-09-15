// SPDX-License-Identifier: AGPL-3.0-only
(() => {
  // Self-contained so executeScript can run exactly this diagnostic in MAIN.
  async function fetchMetadata(url) {
    if (typeof url !== 'string' || !url.startsWith('blob:https://mail.google.com/')) {
      return { success: false, attempted: false, error: 'invalid-blob-url' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let stage = 'fetch';
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return { success: false, attempted: true, error: 'http-status', status: response.status };
      stage = 'response.blob';
      const blob = await response.blob();
      return { success: true, attempted: true, size: blob.size, type: blob.type, instanceofBlob: blob instanceof Blob, error: null };
    } catch (error) {
      return { success: false, attempted: true, stage,
        error: ['TypeError', 'SecurityError', 'AbortError', 'NetworkError'].includes(error?.name) ? error.name : 'OtherError' };
    } finally { clearTimeout(timeout); }
  }
  function start(view, compose, enabled) {
    if (enabled !== true) return () => {};
    let stopped = false, observer, timer, sequence = 0;
    const seen = new WeakMap();
    const emit = (source, info, result) => {
      if (stopped) return;
      // Explicit projection even for results returned from MAIN world.
      try { console.log(`[YubinBox PoC][attachments]\n${JSON.stringify({
        source, compose, reason: 'inline-image-probe', ...info,
        attempted: result?.attempted === true, success: result?.success === true,
        size: Number.isFinite(result?.size) ? result.size : null,
        type: typeof result?.type === 'string' ? result.type : null,
        instanceofBlob: result?.instanceofBlob === true,
        error: ['invalid-blob-url', 'http-status', 'TypeError', 'SecurityError', 'AbortError', 'NetworkError',
          'OtherError', 'main-world-unavailable'].includes(result?.error) ? result.error : null,
        stage: ['fetch', 'response.blob'].includes(result?.stage) ? result.stage : null,
      })}`); } catch {}
    };
    const probe = async (url, info) => {
      const result = await fetchMetadata(url);
      emit('inline-image-content-script', info, result);
      if (result.success || stopped) return;
      try {
        const main = await browser.runtime.sendMessage({ type: 'yubinbox__inlineBlobDiagnostic', url });
        emit('inline-image-main-world', info, main);
      } catch { emit('inline-image-main-world', info, { error: 'main-world-unavailable' }); }
    };
    try {
      const root = view.getBodyElement();
      const scan = () => {
        if (stopped) return;
        try {
          for (const img of root.querySelectorAll('img[src]')) {
            const url = img.getAttribute('src');
            if (!url?.startsWith('blob:https://mail.google.com/') || seen.get(img) === url) continue;
            seen.set(img, url);
            const info = { image: ++sequence, dataSurl: img.getAttribute('data-surl'),
              srcIsBlob: true, alt: img.getAttribute('alt'), width: img.getAttribute('width'), height: img.getAttribute('height') };
            void probe(url, info).catch(() => {});
          }
        } catch { /* Independent diagnostics. */ }
      };
      observer = new MutationObserver(() => {
        if (stopped || timer != null) return;
        timer = setTimeout(() => { timer = null; scan(); }, 200);
      });
      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
      scan();
    } catch { emit('inline-image-content-script', {}, { error: 'OtherError' }); }
    return () => { stopped = true; clearTimeout(timer); observer?.disconnect(); };
  }
  globalThis.YubinBoxInlineImages = Object.freeze({ start, fetchMetadata });
})();
