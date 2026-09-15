// SPDX-License-Identifier: AGPL-3.0-only
(() => {
  // Gmail DOM hypotheses, not SDK APIs or Firefox-verified selectors.
  const rowSelector = '.dL';
  const nameSelector = '.vI';
  const sizeSelector = '.vJ';
  const documents = new Map();
  function observeDocument(doc, entry) {
    if (!doc?.addEventListener) return () => {};
    let shared = documents.get(doc);
    if (!shared) {
      shared = { entries: new Set(), handlers: [], sequence: 0 };
      try {
        for (const type of ['dragenter', 'dragover', 'drop']) {
          let last = -Infinity;
          const handler = (event) => {
            if (!shared.entries.size) return;
            const output = (data) => {
              try { console.log(`[YubinBox PoC][attachments]\n${JSON.stringify({
                source: 'document-capture', reason: type, sequence: ++shared.sequence,
                capturedAt: new Date().toISOString(), ...data,
              })}`); } catch {}
            };
            try {
              if (type === 'dragover' && Date.now() - last < 500) return;
              last = Date.now();
              const matches = [...shared.entries].filter(({ root }) => root?.contains?.(event.target));
              const transfer = event.dataTransfer;
              const list = transfer?.files;
              const files = list ? Array.from(list, (file) => ({
                name: typeof file.name === 'string' ? file.name : null,
                type: typeof file.type === 'string' ? file.type : null,
                size: Number.isFinite(file.size) ? file.size : null,
                lastModified: Number.isFinite(file.lastModified) ? file.lastModified : null,
                instanceofFile: typeof File !== 'undefined' && file instanceof File,
                instanceofBlob: typeof Blob !== 'undefined' && file instanceof Blob,
                contentReadAttempted: false,
              })) : [];
              output({ status: 'observed', compose: matches.length === 1 ? matches[0].compose : null,
                attribution: matches.length === 1 ? 'single-root-containment' : 'unattributed',
                dataTransferPresent: transfer != null,
                filesLength: list?.length ?? null, itemsLength: transfer?.items?.length ?? null,
                files, contentReadAttempted: false });
            } catch { output({ status: 'error', compose: null, attribution: 'unattributed' }); }
          };
          doc.addEventListener(type, handler, true);
          shared.handlers.push([type, handler]);
        }
      } catch (error) {
        for (const [type, handler] of shared.handlers) { try { doc.removeEventListener(type, handler, true); } catch {} }
        throw error;
      }
      documents.set(doc, shared);
    }
    shared.entries.add(entry);
    return () => {
      shared.entries.delete(entry);
      if (shared.entries.size) return;
      for (const [type, handler] of shared.handlers) { try { doc.removeEventListener(type, handler, true); } catch {} }
      documents.delete(doc);
    };
  }
  function start(view, compose, enabled) {
    if (enabled !== true) return () => {};
    let stopped = false;
    let observer;
    let timer;
    let root;
    let revision = 0;
    const removers = [];
    const emit = (reason, data) => {
      if (stopped) return;
      try {
        console.log(`[YubinBox PoC][attachments]\n${JSON.stringify({
          compose, revision: ++revision, reason, capturedAt: new Date().toISOString(), ...data,
        })}`);
      } catch { /* Diagnostics must not interrupt Gmail or routing. */ }
    };
    const safe = (reason, fn) => {
      try { fn(); }
      catch { emit(reason, { status: 'error', details: 'Exception details omitted.' }); }
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      try { clearTimeout(timer); } catch {}
      try { observer?.disconnect(); } catch {}
      for (const remove of removers) { try { remove(); } catch {} }
    };
    const scan = (reason) => safe(reason, () => {
      const rows = [...root.querySelectorAll(rowSelector)];
      emit(reason, {
        source: 'dom', status: 'observed', rootConnected: root.isConnected === true,
        selectors: { row: rowSelector, name: nameSelector, size: sizeSelector },
        selectorVerification: 'unverified-on-device',
        candidateCount: rows.length,
        attachmentPresence: rows.length ? 'candidate-present' : 'unknown',
        fileInputCount: root.querySelectorAll('input[type="file"]').length,
        progressIndicatorCount: root.querySelectorAll('[role="progressbar"], progress').length,
        uploadState: 'unknown',
        candidates: rows.map((row) => ({
          name: row.querySelector(nameSelector)?.textContent?.trim().slice(0, 512) ?? null,
          displayedSize: row.querySelector(sizeSelector)?.textContent?.trim().slice(0, 64) ?? null,
          mimeType: null, sizeBytes: null, bodyAccess: 'unknown', uploadState: 'unknown',
          progressIndicatorPresent: Boolean(row.querySelector('[role="progressbar"], progress')),
        })),
      });
    });
    safe('initialization', () => {
      // Present in 2.2.24's types, but implementation labels it undocumented.
      root = typeof view.getElement === 'function' ? view.getElement() : null;
      emit('root', {
        source: 'sdk-undocumented', api: 'ComposeView.getElement',
        status: root?.querySelectorAll ? 'ok' : 'unavailable',
        attachmentReadPublicApi: 'unsupported',
        observationScope: 'compose-root-only; outside-root events are not attributed',
      });
      if (!root?.querySelectorAll) return;
      const onEvent = (event) => safe(event.type, () => {
        if (stopped) return;
        if (event.type === 'change' && !event.target?.matches?.('input[type="file"]')) return;
        const list = event.type === 'change' ? event.target.files : event.dataTransfer?.files;
        // Copy metadata synchronously: drag data may be protected outside drop.
        const files = list ? [...list].map((file) => ({
          name: typeof file.name === 'string' ? file.name.slice(0, 512) : null,
          mimeType: typeof file.type === 'string' ? file.type : null,
          sizeBytes: Number.isFinite(file.size) ? file.size : null,
          blobObjectObserved: typeof Blob !== 'undefined' && file instanceof Blob,
          fileObjectObserved: typeof File !== 'undefined' && file instanceof File,
          contentReadAttempted: false,
        })) : [];
        emit(event.type, {
          source: 'file-event', status: 'observed', fileListAvailable: list != null,
          observedFileCount: files.length, files,
          attachmentCount: null, uploadState: 'unknown',
          note: 'Event files are not the current attachment list; an empty drag list does not prove absence.',
        });
      });
      for (const type of ['dragenter', 'dragover', 'drop', 'change']) {
        // Coalesce dragover without retaining event/File objects or changing events.
        let last = -Infinity;
        const handler = (event) => {
          if (type === 'dragover' && Date.now() - last < 500) return;
          last = Date.now();
          onEvent(event);
        };
        root.addEventListener(type, handler, true);
        removers.push(() => root.removeEventListener(type, handler, true));
      }
      observer = new MutationObserver(() => safe('observer-callback', () => {
        if (stopped || timer != null) return;
        timer = setTimeout(() => { timer = null; if (!stopped) scan('dom-changed'); }, 500);
      }));
      observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['class', 'role', 'aria-valuenow', 'aria-busy', 'value'] });
      emit('observer-installed', { source: 'dom', scope: 'entire-compose-root' });
    });
    // Initial scan is unconditional when a usable root exists, even with zero rows.
    if (root?.querySelectorAll) scan('initial-scan');
    safe('document-capture-initialization', () => {
      removers.push(observeDocument(root?.ownerDocument ?? globalThis.document, { root, compose }));
    });
    return stop;
  }
  globalThis.YubinBoxAttachments = Object.freeze({ start });
})();
