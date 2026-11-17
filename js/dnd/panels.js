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

/** The dock on the right (composer.js: the rail and its panels): the map kept clear of it on a wide screen; on a phone,
 *  at the top of the bottom sheet. */
export function dockLayout(pv, composer) {
    const dock = $('dndDock'), narrow = matchMedia('(max-width: 768px)');
    const layout = () => {
        if (narrow.matches) {
            if (dock.parentElement !== $('sidebarContent')) $('sidebarContent').prepend(dock);
            dock.classList.add('in-sheet'); window.__openRight = 0;
        } else {
            if (dock.parentElement !== document.body) document.body.appendChild(dock);
            dock.classList.remove('in-sheet');
            // (only the rail kept clear: a panel it opens lies over the map, which stays where it is)
            window.__openRight = Math.round(($('dndRail') ?? dock).getBoundingClientRect().width) + 24;
        }
        if (pv.globe) pv.globe._dirty = true;
        pv.onChange?.('view');
    };
    composer.onLayout = layout;
    narrow.addEventListener('change', layout);
    addEventListener('resize', layout);
    layout();
}

/** The view options trimmed, and the look a campaign map keeps. */
export function trimView(pv) {
    // (the degrees' numbers round the map: on or off, remembered)
    const deg = $('chkDegrees');
    if (deg) {
        let on = true; try { on = localStorage.getItem('dnd.degrees') !== '0'; } catch { /* */ }
        const set = (v) => { document.body.classList.toggle('dnd-no-degrees', !v); try { localStorage.setItem('dnd.degrees', v ? '1' : '0'); } catch { /* */ } };
        deg.checked = on; set(on);
        deg.addEventListener('change', () => set(deg.checked));
    }
    const hide = (el) => el?.classList.add('dnd-hidden');
    for (const id of ['chkRotate', 'chkSpace', 'chkShade', 'chkClouds', 'chkRegime']) hide($(id)?.closest('label'));
    for (const id of ['paletteGroup', 'riverDensityGroup', 'mapTabs', 'subBar', 'mobileViewSwitch', 'gridSpacingGroup', 'viewFold']) hide($(id));
    const v = pv.view;
    v.palette = 'antique'; v.shaded = true; v.clouds = false; v.byRegime = true; v.water = true;
    if ($('palette')) $('palette').value = 'antique';
    if ($('chkShade')) $('chkShade').checked = true;
    if ($('chkClouds')) $('chkClouds').checked = false;
    if ($('chkRegime')) $('chkRegime').checked = true;
    if ($('chkRotate')?.checked) $('chkRotate').click();
    if ($('chkSpace')?.checked) $('chkSpace').click();
}
