// SPDX-License-Identifier: AGPL-3.0-only
(() => {
  const marker = '[YubinBox discard test]';
  function start(view, compose, enabled) {
    if (enabled !== true) return () => {};
    let used = false, active = false, stopped = false, sequence = 0, summaryTimer;
    let discardSeen = false, destroySeen = false;
    const emit = (reason, data = {}) => {
      try { console.log(`[YubinBox PoC][discard]\n${JSON.stringify({ source: 'sdk-discard-test', compose,
        sequence: ++sequence, reason, capturedAt: new Date().toISOString(), ...data })}`); } catch {}
    };
    const readDraft = async (phase) => {
      let timer;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => view.getCurrentDraftID()).then(value => ({
            status: value == null ? 'empty' : 'ok', value: typeof value === 'string' ? value : null,
          })),
          new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'timeout', value: null }), 4000); }),
        ]);
        emit('draft-id', { phase, ...result });
      } catch { emit('draft-id', { phase, status: 'error', value: null }); }
      finally { clearTimeout(timer); }
    };
    const root = view.getElement();
    const button = root.ownerDocument.createElement('button');
    button.type = 'button';
    button.textContent = `診断専用：${compose} の discard() を1回テスト`;
    const eligible = () => !stopped && !view.destroyed && view.getSubject() === marker;
    const onDiscard = () => { if (active) { discardSeen = true; emit('discard-event'); } };
    const onDestroy = () => { destroySeen = true; if (active) emit('destroy-event'); stop(); };
    const cleanup = () => {
      clearTimeout(summaryTimer);
      view.removeListener('discard', onDiscard);
      view.removeListener('destroy', onDestroy);
    };
    async function run(event) {
      if (!event.isTrusted || used || active || stopped) return;
      try {
        if (!eligible()) { emit('test-rejected', { reasonDetail: 'Subject must exactly equal the test marker.', requiredSubject: marker }); return; }
        const answer = root.ownerDocument.defaultView.prompt(
          `このテスト下書きを実際に破棄します。件名：${marker}\n対象 ${compose} を入力すると実行します。`, '');
        if (answer !== compose || !eligible()) return;
        used = true; active = true; button.disabled = true;
        await readDraft('before');
        if (!eligible()) { emit('test-aborted'); active = false; cleanup(); return; }
        emit('discard-call-start');
        try {
          const result = view.discard();
          emit('discard-return', { returnType: typeof result,
            returnValue: result === undefined ? 'undefined' : result === null ? null :
              ['boolean', 'number'].includes(typeof result) ? result : '[omitted]' });
        } catch (error) {
          emit('discard-exception', { name: ['Error', 'TypeError', 'SecurityError'].includes(error?.name) ? error.name : 'OtherError' });
        }
        await readDraft('after');
        summaryTimer = setTimeout(() => {
          emit('event-summary', { discardSeen, destroySeen, observationWindowMs: 5000,
            draftDeletionVerified: false });
          active = false; cleanup();
        }, 5000);
      } catch { emit('test-error'); active = false; cleanup(); }
    }
    function stop() {
      stopped = true;
      button.removeEventListener('click', run);
      button.remove();
      // Preserve in-flight post-call and event-order diagnostics after destroy.
      if (!active) cleanup();
    }
    view.on('discard', onDiscard);
    view.on('destroy', onDestroy);
    button.addEventListener('click', run);
    root.appendChild(button);
    return stop;
  }
  globalThis.YubinBoxDiscardTest = Object.freeze({ start });
})();
