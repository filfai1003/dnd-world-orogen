// The chrome Generate's and Import's pages share on the shared core (plans/SHARED_CORE_PLAN.md U3, U4): site storage that
// tolerates a browser forbidding it, the sliders' value bubbles and the Detail warning, the side panel (collapsed on a
// desktop, a bottom sheet dragged on a phone), the build overlay with its progress.

import { holdControls, clearBuildError } from './build-error.js';

const $ = (id) => document.getElementById(id);

/** Site storage, or nothing stored where the browser forbids it (privacy settings, some private windows). */
export const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* not remembered where the browser forbids it */ } },
};

/** A slider's value bubble over its thumb while it is dragged (its label's text: #vX for #sX). */
export function sliderTooltip(slider) {
    const cg = slider.closest('.cg');
    if (!cg) return;
    cg.style.position = 'relative';
    const tip = document.createElement('div');
    tip.className = 'slider-tooltip'; cg.appendChild(tip);
    const label = $(slider.id.replace('s', 'v'));
    // (the label is written by the slider's own input handler, which may run after this one: read once every handler has run)
    const show = () => { tip.textContent = label ? label.textContent : slider.value; tip.style.left = ((+slider.value - +slider.min) / (+slider.max - +slider.min) * slider.offsetWidth) + 'px'; };
    slider.addEventListener('pointerdown', () => { show(); tip.classList.add('visible'); });
    slider.addEventListener('input', () => queueMicrotask(show));
    const hide = () => tip.classList.remove('visible');
    slider.addEventListener('pointerup', hide); slider.addEventListener('pointercancel', hide);
}

/** The Detail slider's warning (lower thresholds on a touch device). */
export function detailWarning(detail, isTouch) {
    const orange = isTouch ? 200000 : 640000, red = isTouch ? 500000 : 1280000, cg = $('sN').closest('.cg'), warn = $('detailWarn');
    cg.classList.remove('detail-orange', 'detail-red'); warn.className = 'detail-warn';
    if (detail > red) { cg.classList.add('detail-red'); warn.classList.add('red'); warn.textContent = 'Very high — generation may be slow and unstable'; }
    else if (detail > orange) { cg.classList.add('detail-orange'); warn.classList.add('orange'); warn.textContent = 'High detail — generation may be slow and unstable'; }
    else warn.textContent = '';
}

/** Ranges inside a <details> drawn again when it opens (a browser may not move a hidden slider's thumb). */
export function redrawFoldedSliders() {
    document.querySelectorAll('details.section').forEach((det) => det.addEventListener('toggle', () => {
        if (det.open) det.querySelectorAll('input[type="range"]').forEach((s) => { const v = s.value; s.value = ''; s.value = v; });
    }));
}

/** The side panel: collapsed by its button on a desktop; on a phone a bottom sheet, dragged or tapped by its handle. */
export function sidePanel() {
    const ui = $('ui'), mobile = () => innerWidth <= 768;
    if (mobile()) ui.classList.add('collapsed');
    $('sidebarToggle').addEventListener('click', () => {
        const collapsed = ui.classList.toggle('collapsed');
        $('sidebarToggle').innerHTML = collapsed ? '»' : '«';
        $('sidebarToggle').title = collapsed ? 'Show panel' : 'Collapse panel';
    });
    const handle = $('sheetHandle');
    if (handle) {
        let startY = 0, startT = 0, dragging = false, lastY = 0, lastTime = 0, velocity = 0, didDrag = false;
        const translateY = () => new DOMMatrix(getComputedStyle(ui).transform).m42, collapsedY = () => ui.offsetHeight - 60;
        handle.addEventListener('pointerdown', (e) => {
            if (!mobile()) return;
            e.preventDefault(); handle.setPointerCapture(e.pointerId);
            dragging = true; didDrag = false; startY = lastY = e.clientY; lastTime = performance.now(); velocity = 0;
            startT = ui.classList.contains('collapsed') ? translateY() : 0;
            ui.style.transition = 'none'; ui.classList.add('dragging');
        });
        handle.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const now = performance.now(), dt = now - lastTime;
            if (dt > 0) velocity = (e.clientY - lastY) / dt;
            lastY = e.clientY; lastTime = now;
            if (Math.abs(e.clientY - startY) > 5) didDrag = true;
            ui.style.transform = `translateY(${Math.max(0, Math.min(collapsedY(), startT + e.clientY - startY))}px)`;
        });
        const end = (e) => {
            if (!dragging) return;
            try { handle.releasePointerCapture(e.pointerId); } catch { /* (already released) */ }
            dragging = false; ui.style.transition = ''; ui.classList.remove('dragging');
            const progress = collapsedY() > 0 ? 1 - translateY() / collapsedY() : 0;
            ui.classList.toggle('collapsed', velocity > 0.3 || (velocity > -0.3 && progress < 0.3));
            ui.style.transform = '';
        };
        handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
        handle.addEventListener('click', () => { if (!mobile()) return; if (didDrag) { didDrag = false; return; } ui.classList.toggle('collapsed'); });
    }
    return { mobile, collapse: () => { if (mobile()) ui.classList.add('collapsed'); } };
}

/** The build overlay: shown while a planet is built, with its progress; the controls held meanwhile. */
export function buildOverlay() {
    const overlay = $('buildOverlay'), fill = $('buildBarFill'), label = $('buildBarLabel');
    const o = {
        active: true,
        progress(pct, text) { if (!o.active) return; fill.style.transform = `scaleX(${pct / 100})`; label.textContent = text; },
        show() {
            clearBuildError();
            fill.style.transition = 'none'; fill.style.transform = 'scaleX(0)'; label.textContent = '';
            fill.offsetWidth;                                         // (the bar snapped to 0 before it eases again)
            fill.style.transition = '';
            o.active = true; overlay.classList.remove('hidden'); holdControls(true);
        },
        hide() { setTimeout(() => { o.active = false; holdControls(false); overlay.classList.add('hidden'); overlay.classList.remove('initial'); }, 300); },
    };
    holdControls(true);
    return o;
}

