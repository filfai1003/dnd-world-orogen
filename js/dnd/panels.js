// D&D fork — the panels: the world's sliders on the left, each with a box to type its value; the Politica panel on the
// right (the map kept clear of it); and the view options trimmed to what a campaign needs — the hillshade always on, the
// clouds always off, the Antique colours, the rivers coloured by their year, no stars and no turning by itself.

import { detailFromSlider, sliderFromDetail } from '../detail-scale.js';

const $ = (id) => document.getElementById(id);

/** How a slider's value is shown and typed: to the number in the box, and back. */
const SHOWN = {
    sN: { to: (v) => detailFromSlider(+v), from: (n) => sliderFromDetail(n), min: 5000, max: 2560000, step: 1000 },
    sLc: { to: (v) => Math.round(100 * v), from: (n) => n / 100, min: 0, max: 100, step: 1 },
    sPrc: { to: (v) => Math.round(50 * v), from: (n) => n / 50, min: -50, max: 50, step: 5 },
};

/** A box beside each slider of the left panel, to type its value. */
export function sliderBoxes() {
    for (const s of document.querySelectorAll('#sidebarContent .cg input[type="range"]')) {
        const id = s.id, k = SHOWN[id], span = $(id.replace(/^s/, 'v'));
        const num = document.createElement('input');
        num.type = 'number'; num.className = 'dnd-num';
        num.min = String(k?.min ?? s.min); num.max = String(k?.max ?? s.max); num.step = String(k?.step ?? s.step);
        num.setAttribute('aria-label', s.closest('.cg')?.querySelector('label')?.firstChild?.textContent?.trim() ?? id);
        const show = () => { const v = k ? k.to(s.value) : +s.value; num.value = String(+(+v).toFixed(2)); };
        show();
        if (span) { span.classList.add('dnd-hidden'); span.after(num); } else s.before(num);
        s.addEventListener('input', show);
        num.addEventListener('change', () => {
            let n = +num.value;
            if (!(n === n)) { show(); return; }
            n = Math.max(+num.min, Math.min(+num.max, n));
            s.value = String(k ? k.from(n) : n);
            s.dispatchEvent(new Event('input', { bubbles: true }));
            s.dispatchEvent(new Event('change', { bubbles: true }));
            show();
        });
        num.addEventListener('keydown', (e) => { if (e.key === 'Enter') num.blur(); });
    }
}

/** The Politica panel on the right: folded or open, the map kept clear of it on a wide screen; on a phone, in the sheet. */
export function rightPanel(pv) {
    const aside = $('dndRight'), btn = $('dndRightToggle'), narrow = matchMedia('(max-width: 768px)');
    const layout = () => {
        // (the map composer's bar: over the map on a wide screen, at the top of the bottom sheet on a phone)
        const bar = $('dndBar');
        if (bar) {
            if (narrow.matches) { if (!bar.classList.contains('in-sheet-bar')) { ($('viewStripSlot') ?? $('sidebarContent').firstChild).after(bar); bar.classList.add('in-sheet-bar'); } }
            else if (bar.classList.contains('in-sheet-bar')) { document.querySelector('#layerBar .layer-row')?.appendChild(bar); bar.classList.remove('in-sheet-bar'); }
        }
        if (narrow.matches) {
            // (a phone: the panel goes into the bottom sheet, under the world's controls)
            if (aside.parentElement !== $('sidebarContent')) $('sidebarContent').appendChild(aside);
            aside.classList.add('in-sheet'); window.__openRight = 0;
        } else {
            if (aside.parentElement !== document.body) document.body.appendChild(aside);
            aside.classList.remove('in-sheet');
            window.__openRight = aside.classList.contains('collapsed') ? 0 : Math.round(aside.getBoundingClientRect().width) + 24;
        }
        if (pv.globe) pv.globe._dirty = true;
        pv.onChange?.('view');
    };
    btn.addEventListener('click', () => {
        const c = aside.classList.toggle('collapsed');
        btn.innerHTML = c ? '&#x00AB;' : '&#x00BB;'; btn.setAttribute('aria-expanded', String(!c));
        layout();
    });
    narrow.addEventListener('change', layout);
    addEventListener('resize', layout);
    layout();
}

/** The view options trimmed, and the look a campaign map keeps. */
export function trimView(pv) {
    const hide = (el) => el?.classList.add('dnd-hidden');
    for (const id of ['chkRotate', 'chkSpace', 'chkShade', 'chkClouds', 'chkRegime']) hide($(id)?.closest('label'));
    for (const id of ['paletteGroup', 'riverDensityGroup', 'mapTabs', 'subBar', 'mobileViewSwitch']) hide($(id));
    const v = pv.view;
    v.palette = 'antique'; v.shaded = true; v.clouds = false; v.byRegime = true; v.water = true;
    if ($('palette')) $('palette').value = 'antique';
    if ($('chkShade')) $('chkShade').checked = true;
    if ($('chkClouds')) $('chkClouds').checked = false;
    if ($('chkRegime')) $('chkRegime').checked = true;
    if ($('chkRotate')?.checked) $('chkRotate').click();
    if ($('chkSpace')?.checked) $('chkSpace').click();
}
