// SPDX-License-Identifier: AGPL-3.0-only
(() => {
  // Candidate signals only; no position-based selection or automatic action.
  const selector = 'button, [role="button"], .oh';
  const isDiscard = (value) => typeof value === 'string' &&
    /^(?:下書きを破棄|下書きの破棄|破棄|Discard draft|Discard)(?:\s*[（(][^()（）]{0,40}[）)])?$/i.test(value.trim());
  const label = (value) => value == null ? null : isDiscard(value) ? value.slice(0, 100) : '[redacted-unrecognized-label]';
  const role = (el) => {
    const value = el.getAttribute('role');
    return value == null ? null : ['button', 'dialog', 'group', 'toolbar', 'presentation', 'none'].includes(value) ? value : '[other-role]';
  };
  function describe(el) {
    const data = {};
    // Never dump dataset or arbitrary IDs/URLs. Unknown values remain redacted.
    for (const key of ['data-tooltip', 'data-tooltip-id', 'data-action', 'data-command']) {
      const value = el.getAttribute(key);
      if (value != null) data[key] = isDiscard(value) || /^(discard|discard-draft|delete-draft)$/i.test(value)
        ? value.slice(0, 100) : '[present-value-redacted]';
    }
    return { tagName: el.tagName, role: role(el), ariaLabel: label(el.getAttribute('aria-label')),
      title: label(el.getAttribute('title')), data,
      classes: ['oh', 'gU'].filter((name) => el.classList.contains(name)) };
  }
  function start(view, compose, enabled) {
    if (enabled !== true) return () => {};
    let stopped = false, observer, timer, last, sequence = 0;
    const emit = (value) => {
      if (stopped) return;
      try { console.log(`[YubinBox PoC][discard]\n${JSON.stringify({compose, sequence: ++sequence, ...value})}`); } catch {}
    };
    try {
      const root = view.getElement();
      const scan = (reason) => {
        if (stopped) return;
        try {
          const candidates = [];
          for (const el of root.querySelectorAll(selector)) {
            const matchedBy = [];
            for (const key of ['aria-label', 'title', 'data-tooltip']) if (isDiscard(el.getAttribute(key))) matchedBy.push(key);
            for (const key of ['data-action', 'data-command']) if (/^(discard|discard-draft|delete-draft)$/i.test(el.getAttribute(key) ?? '')) matchedBy.push(key);
            if (el.classList.contains('oh')) matchedBy.push('class-oh-unverified');
            if (!matchedBy.length) continue;
            const parents = [];
            for (let parent = el.parentElement; parent && root.contains(parent) && parents.length < 3; parent = parent.parentElement) {
              parents.push({ role: role(parent), ariaLabel: label(parent.getAttribute('aria-label')), title: label(parent.getAttribute('title')) });
              if (parent === root) break;
            }
            candidates.push({ ...describe(el), matchedBy, parents });
          }
          const value = { candidateCount: candidates.length, candidates,
            uniqueCandidate: candidates.length === 1, identification: candidates.length === 1 ? 'single-candidate-unverified' : 'unresolved',
            stableAttributeVerified: false, source: 'compose-root-dom', selector };
          const signature = JSON.stringify(value);
          if (reason !== 'initial-scan' && signature === last) return;
          last = signature;
          emit({ reason, ...value });
        } catch { emit({ reason, status: 'error', details: 'Exception details omitted.' }); }
      };
      observer = new MutationObserver(() => {
        if (stopped || timer != null) return;
        timer = setTimeout(() => { timer = null; scan('dom-changed'); }, 300);
      });
      observer.observe(root, { subtree: true, childList: true, attributes: true,
        attributeFilter: ['role', 'aria-label', 'title', 'class', 'data-tooltip', 'data-tooltip-id', 'data-action', 'data-command'] });
      scan('initial-scan');
    } catch { emit({ reason: 'initialization', status: 'error', details: 'Compose root or observer unavailable.' }); }
    return () => { stopped = true; clearTimeout(timer); observer?.disconnect(); };
  }
  globalThis.YubinBoxDiscard = Object.freeze({ start });
})();
