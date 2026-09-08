(() => {
  'use strict';
  const mounted = new WeakMap();
  const HOVER_DELAY = 1000, VISIBLE_DURATION = 3000;
  let active = null;
  const GRIP = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="4" r="1"/><circle cx="11" cy="4" r="1"/><circle cx="5" cy="8" r="1"/><circle cx="11" cy="8" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="11" cy="12" r="1"/></svg>';

  function attach(surface, options) {
    if(window.notchAPI?.launcherLayout)return () => {};
    if (!surface) return () => {};
    mounted.get(surface)?.();
    const controller = new AbortController(), signal = controller.signal;
    const on = (target, name, fn, extra = {}) => target.addEventListener(name, fn, { ...extra, signal });
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'panel-detach-handle';
    button.innerHTML = `${GRIP}<span>拖出</span>`;
    button.setAttribute('aria-label', `${options.label}：按住拖出面板，或点击悬浮`);
    button.title = '按住拖出面板；点击也可悬浮';
    surface.classList.add('detach-surface'); surface.append(button);
    let hoverTimer, hideTimer, suppressUntil = 0, hovered = false, disposed = false;
    function conceal() {
      clearTimeout(hoverTimer); clearTimeout(hideTimer);
      surface.classList.remove('detach-hover');
    }
    // Only a fresh boundary entry arms the timer; motion or typing cannot re-arm it.
    on(surface, 'pointerenter', (event) => {
      if (hovered) return;
      hovered = true; conceal();
      if (event.buttons || active) return;
      hoverTimer = setTimeout(() => {
        if (disposed || !hovered || active) return;
        surface.classList.add('detach-hover');
        hideTimer = setTimeout(conceal, VISIBLE_DURATION);
      }, HOVER_DELAY);
    });
    on(surface, 'pointerleave', () => { hovered = false; conceal(); });
    on(surface, 'input', conceal);
    on(surface, 'pointerdown', (event) => { if (!button.contains(event.target)) conceal(); });
    on(document, 'pointercancel', conceal);
    on(window, 'blur', conceal);

    function reset(session) {
      surface.classList.remove('detach-dragging');
      button.removeAttribute('aria-busy');
      if (button.hasPointerCapture?.(session.pointerId)) button.releasePointerCapture(session.pointerId);
      if (active === session) active = null;
      conceal();
    }
    async function finish(session, cancel = false) {
      if (session.released) return;
      session.released = true; session.cancelled = cancel;
      if (session.started || cancel) suppressUntil = performance.now() + 500;
      reset(session);
      if (!session.started) return;
      try {
        const started = await session.started;
        if (!started?.ok) { if (!cancel && !started?.cancelled) options.error?.(started?.error); return; }
        const result = await options.drag(cancel || disposed ? 'cancel' : 'end', { token: started.token });
        if (!cancel && !disposed && !result?.ok) options.error?.(result?.error);
      } catch { if (!cancel && !disposed) options.error?.('drag_failed'); }
    }
    on(button, 'pointerdown', (event) => {
      if (event.button !== 0 || event.isPrimary === false || active) return;
      event.preventDefault(); event.stopPropagation();
      button.setPointerCapture(event.pointerId);
      clearTimeout(hideTimer);
      surface.classList.add('detach-dragging');
      active = { button, pointerId: event.pointerId, x: event.clientX, y: event.clientY, released: false, started: null,
        cancel() { void finish(this, true); } };
    });
    on(button, 'pointermove', (event) => {
      const session = active;
      if (!session || session.button !== button || session.released || event.pointerId !== session.pointerId) return;
      if (event.buttons === 0) { void finish(session, true); return; }
      if (!session.started && Math.hypot(event.clientX - session.x, event.clientY - session.y) >= 6) {
        surface.classList.add('detach-dragging'); button.setAttribute('aria-busy', 'true');
        session.started = Promise.resolve().then(() => options.prepare()).then(() => {
          if (session.cancelled || disposed) return { ok: false, cancelled: true };
          return options.drag('start', { kind: options.kind, id: options.id, theme: document.documentElement.dataset.theme });
        }).catch(() => ({ ok: false, error: 'save_failed' }));
      }
    });
    on(button, 'pointerup', (event) => {
      if (active?.button !== button) return;
      event.stopPropagation(); void finish(active);
    });
    on(button, 'pointercancel', () => { if (active?.button === button) active.cancel(); });
    on(button, 'lostpointercapture', () => { if (active?.button === button) active.cancel(); });
    on(button, 'click', async (event) => {
      event.preventDefault(); event.stopPropagation();
      if (performance.now() < suppressUntil && event.detail !== 0 || active) return;
      conceal();
      button.disabled = true;
      try { await options.open(); } catch { options.error?.('save_failed'); }
      finally { button.disabled = false; }
    });
    function dispose() {
      disposed = true;
      if (active?.button === button) active.cancel();
      conceal(); controller.abort(); button.remove();
      surface.classList.remove('detach-surface', 'detach-hover', 'detach-dragging');
      mounted.delete(surface);
    }
    mounted.set(surface, dispose);
    return dispose;
  }
  function cancelActive() { if (!active) return false; active.cancel(); return true; }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && cancelActive()) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('blur', cancelActive);
  window.addEventListener('pagehide', cancelActive);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelActive(); });
  window.PanelDetachHandles = { attach, cancelActive, clear: (surface) => mounted.get(surface)?.() };
})();
