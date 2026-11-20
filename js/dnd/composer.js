// D&D fork — the map composer: one base (Terreno, Satellite, Temperatura, Fertilità) and the overlays laid over it, each
// on or off (Politica; the winds or the sea currents) — the map the DM builds the
// world with, and the maps a cartographer could sell the players. The overlays are drawn twice: on the planet's picture
// (areas and arrows, which belong to the ground) and on a screen layer over it (marks, names and lines, the same size at
// any zoom), and once more, at the export's width, for the map saved.

import { finishedClimateValue } from '../../v2/js/evolution/climate-view.js';
import { colorMap, satelliteMap, farmingMap, climateMap, paintAt, rollRows, rollShift } from '../../v2/js/evolution/export.js';
import { P as PROJ } from '../../v2/js/view/projections.js';
import { riverPaths, drawRivers } from '../../v2/js/evolution/finish-view.js';
import { DRAWN_LAYER, drawnColorAt, drawIcons, drawnLegend } from './drawn.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ── the Temperatura base: the land by its mean temperature (the year, January or July), the sea all one blue ──
export const TEMP_LAYER = 'dndTemp';
const TEMP_STOPS = [[-30, [38, 77, 178]], [-12, [51, 140, 160]], [2, [110, 180, 120]], [12, [200, 205, 70]], [22, [240, 140, 35]], [32, [160, 20, 30]]];
const SEA_RGB = [40, 72, 120];
function tempRgb(t, out) {
    if (!(t === t)) { out[0] = out[1] = out[2] = 128; return out; }
    if (t <= TEMP_STOPS[0][0]) { for (let i = 0; i < 3; i++) out[i] = TEMP_STOPS[0][1][i]; return out; }
    for (let s = 1; s < TEMP_STOPS.length; s++) {
        if (t > TEMP_STOPS[s][0] && s < TEMP_STOPS.length - 1) continue;
        const [a, ca] = TEMP_STOPS[s - 1], [b, cb] = TEMP_STOPS[s], k = Math.max(0, Math.min(1, (t - a) / (b - a)));
        for (let i = 0; i < 3; i++) out[i] = ca[i] + (cb[i] - ca[i]) * k;
        return out;
    }
    return out;
}
const SEASON_IT = { year: 'yearly mean', jan: 'January', jul: 'July' };
function tempColorAt(fin, W, season) {
    const T = finishedClimateValue('temperature', season, fin.climate, W), c = [0, 0, 0];
    return (out, o, x, y, wet, kk, k3, v, lake) => {
        // (opaque: the export's picture keeps the alpha — without it, a map all but black)
        if (wet || lake) { out[o] = SEA_RGB[0]; out[o + 1] = SEA_RGB[1]; out[o + 2] = SEA_RGB[2]; out[o + 3] = 255; return; }
        tempRgb(T(x, y, false), c);
        const k = 0.62 + 0.38 * kk;
        out[o] = Math.min(255, c[0] * k); out[o + 1] = Math.min(255, c[1] * k); out[o + 2] = Math.min(255, c[2] * k); out[o + 3] = 255;
    };
}
function tempLegend(season) {
    const g = TEMP_STOPS.map(([t, c]) => `${css(c)} ${Math.round(100 * (t + 30) / 62)}%`).join(', ');
    return `<div class="evo-legend-head">Temperature, ${SEASON_IT[season] ?? season}</div>
        <div class="dnd-ramp" style="background:linear-gradient(90deg, ${g})"></div>
        <div class="dnd-ramp-labels"><span>−30 °C</span><span>0</span><span>15</span><span>32 °C</span></div>`;
}
/**
 * The winds' or the currents' arrows (as the Wind and Currents views draw them), each coloured by how warm it runs for its
 * latitude: red warmer than the rest of its latitude's air or sea, blue colder — a warm current, a cold one; a warm wind,
 * a cold one. `C`: the 1° climate (360 × 180, rows from the north).
 */
function warmColdArrows(ctx, width, wind, season, C) {
    const H = width / 2, px = width / 360;
    const U = wind ? C.u?.[season] : C.currentU?.[season], V = wind ? C.v?.[season] : C.currentV?.[season];
    const T = wind ? C.T?.[season] : (C.Tsea ?? C.T)?.[season], only = wind ? null : C.sea;
    if (!U || !V) return;
    // (each latitude's mean, over the sea alone for the currents)
    const mean = new Float32Array(180);
    if (T) for (let j = 0; j < 180; j++) { let s = 0, n = 0; for (let i = 0; i < 360; i++) { const c = j * 360 + i; if (only && !only[c]) continue; if (Number.isFinite(T[c])) { s += T[c]; n++; } } mean[j] = n ? s / n : 0; }
    const speeds = [];
    for (let c = 0; c < U.length; c += 7) if (!only || only[c]) speeds.push(Math.hypot(U[c], V[c]));
    speeds.sort((a, b) => a - b);
    const strong = speeds[Math.floor(0.95 * (speeds.length - 1))] || 1;
    const step = wind ? 7.5 : 6, full = step * px * 0.9, NB = 9, paths = Array.from({ length: NB }, () => new Path2D());
    for (let lat = 90 - step / 2; lat > -90; lat -= step) {
        const cl = Math.cos(lat * Math.PI / 180), lonStep = step / Math.max(0.2, cl);
        for (let lon = -180 + lonStep / 2; lon < 180; lon += lonStep) {
            const i = Math.min(359, Math.floor(lon + 180)), j = Math.min(179, Math.floor(90 - lat)), c = j * 360 + i;
            if (only && !only[c]) continue;
            const u = U[c], v = V[c], sp = Math.hypot(u, v);
            if (!(sp > strong * 0.04)) continue;
            const a = T && Number.isFinite(T[c]) ? T[c] - mean[j] : 0, b = Math.max(0, Math.min(NB - 1, Math.round((Math.max(-1, Math.min(1, a / 4)) + 1) / 2 * (NB - 1))));
            const len = full * Math.min(1, sp / strong), dx = u / sp * len / Math.max(0.2, cl), dy = -v / sp * len;
            const x0 = (lon + 180) * px - dx / 2, y0 = (90 - lat) / 180 * H - dy / 2, x1 = x0 + dx, y1 = y0 + dy, P = paths[b];
            P.moveTo(x0, y0); P.lineTo(x1, y1);
            const an = Math.atan2(dy, dx), hl = Math.min(len * 0.4, 5 * width / 2048);
            P.moveTo(x1, y1); P.lineTo(x1 - hl * Math.cos(an - 0.45), y1 - hl * Math.sin(an - 0.45));
            P.moveTo(x1, y1); P.lineTo(x1 - hl * Math.cos(an + 0.45), y1 - hl * Math.sin(an + 0.45));
        }
    }
    ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = Math.min(3.2, Math.max(1.2, width / 1300));
    const COLD = [35, 85, 205], MID = [125, 105, 140], WARM = [205, 45, 35];
    paths.forEach((P, b) => {
        const t = b / (NB - 1) * 2 - 1, from = t < 0 ? MID : MID, to = t < 0 ? COLD : WARM, k = Math.abs(t);
        ctx.strokeStyle = css([0, 1, 2].map(q => Math.round(from[q] + (to[q] - from[q]) * k)), 0.92);
        ctx.stroke(P);
    });
    ctx.restore();
}

/** The planet view's own layers (planet-view.js ownLayers): the Temperatura base. */
export const ownLayers = {
    has: (l) => l === TEMP_LAYER || l === DRAWN_LAYER,
    colorAt: (layer, fin, W, lut, view) => (layer === DRAWN_LAYER ? drawnColorAt(fin, W) : tempColorAt(fin, W, view.season)),
    legend: (layer, view) => (layer === DRAWN_LAYER ? drawnLegend() : tempLegend(view.season)),
};

// ── the composer ──
export class Composer {
    constructor({ pv, realm, world, onChange }) {
        this.pv = pv; this.realm = realm; this.world = world; this.onChange = onChange;
        this.base = 'terrain'; this.tempSeason = 'year'; this.fertMode = 'farmLand';
        this.flow = 'none'; this.version = 0;
        // (the screen layer: over the map, under the panels)
        this.screen = document.createElement('canvas');
        Object.assign(this.screen.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none' });
        ($('mapCanvas') ?? $('canvas')).after(this.screen);
        this.screenKey = '';
        realm.onEnable = (on) => this.setPolitics(on);
        realm.onLegend = () => this.legend();
        this.mountBar();
        this.wireRotate();
        this.wireFocus();
        this.applyBase();
    }

    changed() { this.version++; this.onChange(); this.legend(); }
    key() { return `${this.flow}|${this.base === 'temp' ? this.tempSeason : 'year'}|${this.version}`; }

    // ── the dock on the right: a rail of icons (the bases, the overlays, the export) and the panel each opens ──
    mountBar() {
        const I = {
            terrain: '<path d="M3 19 9 9l4 6 3-4 5 8z"/>',
            drawn: '<path d="M2 20 8 8l4 7 2-3 4 8z"/><path d="M17 11V6M17 6l-2.5 3M17 6l2.5 3"/>',
            satellite: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>',
            temp: '<path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z"/><path d="M12 10v6"/>',
            fert: '<path d="M12 20v-8"/><path d="M12 12C12 7 8 5 4 5c0 5 3 7 8 7z"/><path d="M12 14c0-4 3-6 8-6 0 4-3 6-8 6z"/>',
            politics: '<path d="M4 18 5 7l4 4 3-6 3 6 4-4 1 11z"/>',
            flow: '<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 14h15a3 3 0 1 1-3 3"/>',
            export: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
        };
        const icon = (k) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;
        const btn = (k, label, extra = '') => `<button type="button" class="dnd-rail-btn" data-rail="${k}" title="${label}" aria-label="${label}"${extra}>${icon(k)}</button>`;
        const dock = document.createElement('div');
        dock.id = 'dndDock'; dock.className = 'dnd-dock';
        dock.innerHTML = `
            <div id="dndFly" class="dnd-fly" hidden>
                <section class="dnd-fly-part" data-part="temp" hidden>
                    <div class="dnd-fly-head"><h3>Temperature</h3><button type="button" class="dnd-fly-x" aria-label="Close">×</button></div>
                    <div class="dnd-choice" id="dndTempSeason">
                        <label><input type="radio" name="dndSeason" value="year" checked>Yearly mean</label>
                        <label><input type="radio" name="dndSeason" value="jan">January</label>
                        <label><input type="radio" name="dndSeason" value="jul">July</label>
                    </div>
                </section>
                <section class="dnd-fly-part" data-part="fert" hidden>
                    <div class="dnd-fly-head"><h3>Fertility</h3><button type="button" class="dnd-fly-x" aria-label="Close">×</button></div>
                    <div class="dnd-choice" id="dndFertMode">
                        <label><input type="radio" name="dndFert" value="farmLand" checked>Farmland</label>
                        <label><input type="radio" name="dndFert" value="aridity">Aridity</label>
                        <label><input type="radio" name="dndFert" value="growing">Growing season</label>
                    </div>
                </section>
                <section class="dnd-fly-part" data-part="flow" hidden>
                    <div class="dnd-fly-head"><h3>Winds and currents</h3><button type="button" class="dnd-fly-x" aria-label="Close">×</button></div>
                    <div class="dnd-choice" id="dndFlow">
                        <label><input type="radio" name="dndFlowR" value="none" checked>None</label>
                        <label><input type="radio" name="dndFlowR" value="wind">Winds <span class="dnd-hint">for flying routes</span></label>
                        <label><input type="radio" name="dndFlowR" value="currents">Sea currents</label>
                    </div>
                </section>
                <section class="dnd-fly-part" data-part="politics" hidden></section>
            </div>
            <nav id="dndRail" class="dnd-rail" aria-label="Map">
                ${btn('terrain', 'Terrain: the relief shaded, antique palette')}
                ${btn('drawn', 'Illustrated: a hand-drawn map, with mountains, hills and forests')}
                ${btn('satellite', 'Satellite: the planet seen from space')}
                ${btn('temp', 'Temperature: yearly mean, January or July')}
                ${btn('fert', 'Fertility: farmland, aridity, growing season')}
                <span class="dnd-rail-sep" aria-hidden="true"></span>
                ${btn('politics', 'Politics: kingdoms, cities and routes')}
                ${btn('flow', 'Winds or sea currents')}
                <span class="dnd-rail-sep" aria-hidden="true"></span>
                ${btn('export', 'Export the map as you see it')}
            </nav>`;
        document.body.appendChild(dock);
        // (the Politica panel: the realm's controls, moved into the dock's panel)
        const pol = dock.querySelector('[data-part="politics"]');
        pol.innerHTML = `<div class="dnd-fly-head"><h3>Politics</h3><button type="button" class="dnd-fly-x" aria-label="Close">×</button></div>
            <label class="toggle-label dnd-show"><input type="checkbox" id="dndPolitics" checked><span class="toggle-track"><span class="toggle-thumb"></span></span>Show on the map</label>`;
        const section = $('realmSection');
        if (section) pol.appendChild(section);
        $('dndRight')?.remove();
        this.open = null;
        dock.querySelectorAll('.dnd-fly-x').forEach(x => x.addEventListener('click', () => this.openPart(null)));
        dock.querySelectorAll('[data-rail]').forEach(b => b.addEventListener('click', () => {
            const k = b.dataset.rail;
            if (['terrain', 'drawn', 'satellite', 'temp', 'fert'].includes(k)) {
                const same = this.base === k;
                this.base = k; this.applyBase();
                // (a base with a choice of its own opens it; a second click closes it)
                this.openPart((k === 'temp' || k === 'fert') && !(same && this.open === k) ? k : null);
                return;
            }
            if (k === 'export') { $('exportBtn').click(); return; }
            this.openPart(this.open === k ? null : k);
        }));
        dock.querySelector('#dndTempSeason').addEventListener('change', e => { this.tempSeason = e.target.value; this.applyBase(); });
        dock.querySelector('#dndFertMode').addEventListener('change', e => { this.fertMode = e.target.value; this.applyBase(); });
        $('dndPolitics').addEventListener('change', e => this.setPolitics(e.target.checked));
        dock.querySelector('#dndFlow').addEventListener('change', e => { this.flow = e.target.value; this.changed(); this.railState(); });
        addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open && !this.realm.editing) this.openPart(null); });
        // (the legend of the overlays: under the base's own)
        const lg = document.createElement('div'); lg.id = 'dndLegend'; lg.className = 'dnd-legend';
        $('legendCard').appendChild(lg);
        this.railState();
    }
    /** Open one of the dock's panels (or none). */
    openPart(k) {
        this.open = k;
        const fly = $('dndFly');
        fly.hidden = !k;
        fly.querySelectorAll('.dnd-fly-part').forEach(p => { p.hidden = p.dataset.part !== k; });
        fly.classList.toggle('wide', k === 'politics');
        this.railState();
        this.onLayout?.();
    }
    /** The rail's icons lit: the base chosen, the overlays on, the panel open. */
    railState() {
        const on = { terrain: this.base === 'terrain', drawn: this.base === 'drawn', satellite: this.base === 'satellite', temp: this.base === 'temp', fert: this.base === 'fert',
            politics: this.realm.enabled, flow: this.flow !== 'none' };
        document.querySelectorAll('#dndRail [data-rail]').forEach(b => {
            const k = b.dataset.rail;
            b.classList.toggle('on', !!on[k]); b.classList.toggle('open', this.open === k);
            b.setAttribute('aria-pressed', String(!!on[k]));
        });
    }
    setPolitics(on) { this.realm.enabled = on; if ($('dndPolitics')) $('dndPolitics').checked = on; if (!on && this.realm.editing) this.realm.setEditing(false); this.realm.version++; this.changed(); this.railState?.(); }
    applyBase() {
        const layer = { terrain: 'terrain', drawn: DRAWN_LAYER, satellite: 'satellite', temp: TEMP_LAYER, fert: this.fertMode }[this.base];
        this.pv.view.season = this.base === 'temp' ? this.tempSeason : 'year';
        this.pv.setLayer(layer);
        this.changed();
        if ($('dndRail')) this.railState();
    }

    // ── the overlays on the planet's picture: the winds' or currents' arrows ──
    draw(ctx, W, view) {
        const fin = this.world()?.fin;
        if (!fin) return;
        if (this.base === 'drawn' && fin.climate) this.drawnOver(ctx, W, fin, view?.riverQ, view?.water !== false, 0);
        if (this.flow !== 'none' && fin.climate) warmColdArrows(ctx, W, this.flow === 'wind', this.base === 'temp' ? this.tempSeason : 'year', fin.climate);
    }
    /** The Illustrated base's lines over its picture: the rivers inked in blue, then the relief's icons. */
    drawnOver(ctx, W, fin, riverQ, rivers, shift) {
        for (const tx of shift ? [-shift, W - shift] : [0]) {
            ctx.save(); ctx.translate(tx, 0);
            if (rivers && fin.rivers) { ctx.save(); ctx.scale(W / 2048, W / 2048); drawRivers(ctx, riverPaths(fin, riverQ), false); ctx.restore(); }
            drawIcons(ctx, W, fin);
            ctx.restore();
        }
    }
    // ── the screen layer: the realm's marks and names ──
    projector() {
        const fv = this.pv.globe.frameView?.();
        if (!fv) return null;
        if (fv.kind === 'globe') {
            const cam = fv.cam;
            return { key: `g|${cam.map(v => v.toFixed(4)).join(',')}|${fv.r.toFixed(1)}`, clip: null, at: (u, v) => {
                const p = fv.local(u * 2 * Math.PI - Math.PI, (0.5 - v) * Math.PI);
                return p[0] * cam[0] + p[1] * cam[1] + p[2] * cam[2] <= 1.02 ? null : fv.toScreen(p);
            } };
        }
        // (the clip: the map as zoomed and panned, within the frame it shows in — not the unzoomed box, which cut the
        // overlays off part-way across a zoomed map)
        const P = PROJ[fv.id], gl = this.pv.globe, box = gl.mapBox?.(), mv = gl.mapView ?? { zoom: 1, panX: 0, panY: 0 };
        let clip = box;
        if (box) {
            const zl = box.left + box.width / 2 + (-0.5 - mv.panX) * box.width * mv.zoom, zt = box.top + box.height / 2 + (-0.5 - mv.panY) * box.height * mv.zoom;
            // (the map as it shows: its frame less the room kept round it — the degrees' margin, the panel on the left)
            const r0 = gl.map?.frame?.getBoundingClientRect?.() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }, pad = gl.mapPad ?? { top: 0, bottom: 0, side: 0 };
            const fr = { left: r0.left + (gl.openLeft || 0) + pad.side, top: r0.top + pad.top, right: r0.right - pad.side + ((typeof window !== 'undefined' && window.__openRight) || 0), bottom: r0.bottom - pad.bottom };
            // (the equirectangular map wraps east–west as it pans: its width across stays the box's, zoomed about its middle)
            const eqL = box.left + box.width / 2 - box.width * mv.zoom / 2, xl = fv.xRange ? eqL : zl;
            const L = Math.max(xl, fr.left), T = Math.max(zt, fr.top), Rr = Math.min(xl + box.width * mv.zoom, fr.right - ((typeof window !== 'undefined' && window.__openRight) || 0)), B = Math.min(zt + box.height * mv.zoom, fr.bottom);
            clip = { left: L, top: T, width: Math.max(0, Rr - L), height: Math.max(0, B - T) };
        }
        const wrapW = box ? box.width * mv.zoom : 0;
        return { key: `m|${fv.key}`, clip, jump: box ? box.width * mv.zoom / 4 : innerWidth / 4, at: (u, v) => {
            let lon = u * 2 * Math.PI - Math.PI - fv.centre;
            lon = ((lon + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
            const xy = P.fwd(lon, (0.5 - v) * Math.PI, fv.opts);
            if (!xy) return null;
            const q = fv.toClient(xy[0], xy[1]);
            return q;
        } };
    }
    drawScreen() {
        const cv = this.screen, fin = this.world()?.fin, pr = fin ? this.projector() : null;
        const dpr = Math.min(2, devicePixelRatio || 1), Wc = Math.round(innerWidth * dpr), Hc = Math.round(innerHeight * dpr);
        const key = pr ? `${pr.key}|${this.realm.screenKey()}|${this.version}|${Wc}x${Hc}` : 'off';
        if (key === this.screenKey) return;
        this.screenKey = key;
        if (cv.width !== Wc || cv.height !== Hc) { cv.width = Wc; cv.height = Hc; }
        const ctx = cv.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, Wc, Hc);
        if (!pr) { this.realm.screenPos = []; return; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.save();
        const clip = pr.clip;
        if (clip) { ctx.beginPath(); ctx.rect(clip.left, clip.top, clip.width, clip.height); ctx.clip(); }
        const jump = pr.jump ?? innerWidth / 4;
        const line = (pts) => {
            let prev = null;
            for (const p of pts) {
                const q = pr.at(((p[0] % 1) + 1) % 1, p[1]);
                if (!q) { prev = null; continue; }
                if (prev && Math.abs(q[0] - prev[0]) + Math.abs(q[1] - prev[1]) < jump) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
                prev = q;
            }
        };
        const placed = [];
        this.realm.drawOnScreen(ctx, pr, line, placed);
        ctx.restore();
    }
    /** The overlays' legend, under the base's. */
    legend() {
        const el = $('dndLegend'); if (!el) return;
        const parts = [];
        if (this.flow === 'wind') parts.push('<div class="dnd-leg-row">➝ <b>Winds</b>: where they blow, longer where they are strong; <span class="dnd-warm">red</span> warmer, <span class="dnd-cold">blue</span> colder than their latitude</div>');
        if (this.flow === 'currents') parts.push('<div class="dnd-leg-row">➝ <b>Sea currents</b>: where they carry ships; <span class="dnd-warm">red</span> warm, <span class="dnd-cold">blue</span> cold</div>');
        // (the kingdoms, when their names do not all fit on the map)
        if (this.realm.enabled && this.realm.data && this.realm.kingdomsInLegend) parts.push(`<div class="dnd-leg-row dnd-leg-kingdoms">${this.realm.names.kingdoms.map((n, k) => `<span class="dnd-leg-mat"><i class="dnd-dot" style="background:${this.realm.colorOf(k)}"></i>${esc(n)}</span>`).join('')}</div>`);
        if (this.realm.enabled && this.realm.data) { const ml = this.realm.markLegend(); if (ml) parts.push(ml); }
        if (this.realm.enabled && this.realm.data) parts.push('<div class="dnd-leg-note">Roads and river ways: main ones solid, the rest dashed (the sea routes are not drawn)</div>');
        el.innerHTML = parts.join('');
        el.hidden = !parts.length;
        if (parts.length) $('legendCard').hidden = false;
    }

    // ── Alt + click: the map centred on that place, true round it (the 'Centred on a point' projection) ──
    wireFocus() {
        document.addEventListener('click', (e) => {
            if (!e.altKey || (e.target !== this.pv.ui.map && e.target !== this.pv.ui.canvas)) return;
            const p = this.pv.placeUnder(e); if (!p) return;
            e.preventDefault(); e.stopImmediatePropagation();
            const lon = Math.round(p[0] * 360 - 180), lat = Math.round(90 - p[1] * 180);
            const mode = $('viewMode'); if (mode && mode.value !== 'map') { mode.value = 'map'; mode.dispatchEvent(new Event('change', { bubbles: true })); }
            const sel = $('mapProjection'); if (sel && sel.value !== 'focus') { sel.value = 'focus'; sel.dispatchEvent(new Event('change')); }
            const latIn = document.querySelector('#mapProjOpts [data-opt="lat0"]'); if (latIn) { latIn.value = String(lat); latIn.dispatchEvent(new Event('input')); }
            const slider = $('sMapCenterLon'); slider.value = String(lon); slider.dispatchEvent(new Event('input')); if ($('dndCenterNum')) $('dndCenterNum').value = String(lon);
        }, { capture: true });
    }

    // ── turning the map: drag it east or west (when not zoomed in), or type the degrees ──
    wireRotate() {
        const slider = $('sMapCenterLon');
        slider.step = '1';
        const setLon = (lon) => { lon = ((Math.round(lon) + 180) % 360 + 360) % 360 - 180; slider.value = String(lon); slider.dispatchEvent(new Event('input')); if ($('dndCenterNum')) $('dndCenterNum').value = String(lon); };
        // (the degrees as a number beside the slider)
        const num = document.createElement('input');
        num.type = 'number'; num.id = 'dndCenterNum'; num.className = 'dnd-num'; num.min = '-180'; num.max = '180'; num.step = '1'; num.value = slider.value;
        num.setAttribute('aria-label', 'Map centre, degrees');
        $('vMapCenterLon')?.after(num);
        $('vMapCenterLon')?.classList.add('dnd-hidden');
        num.addEventListener('change', () => setLon(+num.value || 0));
        slider.addEventListener('input', () => { num.value = slider.value; });
        let drag = null;
        document.addEventListener('pointerdown', (e) => {
            const view = this.pv.view, mv = this.pv.globe.mapView;
            if (view.mode !== 'map' || e.target !== this.pv.ui.map || e.ctrlKey || e.metaKey || this.realm.editing || document.body.classList.contains('flat-world')) return;
            // (a mouse's right button turns the map — its left pans and picks cities; a finger turns it only zoomed out)
            if (e.pointerType === 'mouse' ? e.button !== 2 : (e.button !== 0 || (mv && mv.zoom > 1.02))) return;
            drag = { x: e.clientX, lon: +slider.value, w: this.pv.globe.mapBox().width };
            e.stopImmediatePropagation(); e.preventDefault();
        }, { capture: true });
        addEventListener('pointermove', (e) => { if (!drag) return; e.stopImmediatePropagation(); setLon(drag.lon - (e.clientX - drag.x) / drag.w * 360); }, { capture: true });
        addEventListener('pointerup', () => { drag = null; }, { capture: true });
        document.addEventListener('contextmenu', (e) => { if (e.target === this.pv.ui.map || e.target === this.pv.ui.canvas) e.preventDefault(); }, { capture: true });
    }

    // ── the export: the map as composed, at the export's width ──
    produce(rctx, job) {
        if (job.row.id !== 'dndMap') return null;
        const fin = rctx.fin, W = rctx.W, H = W >> 1, look = rctx.look, shift = rollShift(W, look.centerLon), season = this.base === 'temp' ? this.tempSeason : 'year';
        let base;
        if (this.base === 'satellite') base = satelliteMap(fin, W, 'year', look);
        else if (this.base === 'temp') {
            const image = new ImageData(W, H);
            paintAt(fin, W, image, look.lut, { exaggeration: look.exaggeration, lakes: true, shaded: true, colorAt: tempColorAt(fin, W, season) });
            base = { data: rollRows(image.data, W, H, 4, shift) };
        } else if (this.base === 'drawn') {
            const image = new ImageData(W, H);
            paintAt(fin, W, image, look.lut, { exaggeration: look.exaggeration, lakes: true, shaded: true, colorAt: drawnColorAt(fin, W) });
            base = { data: rollRows(image.data, W, H, 4, shift) };
        } else if (this.base === 'fert') base = this.fertMode === 'farmLand' ? farmingMap(fin, W, 'farmLand', look) : climateMap(fin, W, this.fertMode, 'year', look);
        else base = colorMap(fin, W, look);
        const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext('2d');
        ctx.putImageData(new ImageData(new Uint8ClampedArray(base.data), W, H), 0, 0);
        // (the overlays, rolled as the base is: drawn once shifted, and again a map-width over where they cross the edge)
        if (this.base === 'drawn' && fin.climate) this.drawnOver(ctx, W, fin, look.riverQ, look.water !== false, shift);
        for (const tx of shift ? [-shift, W - shift] : [0]) {
            ctx.save(); ctx.translate(tx, 0);
            if (this.flow !== 'none' && fin.climate) warmColdArrows(ctx, W, this.flow === 'wind', season, fin.climate);
            ctx.restore();
        }
        if (this.realm.enabled && this.realm.data) this.realm.paint(ctx, W, { ...this.realm.show, cities: true }, shift);
        return { kind: 'rgba', W, H, data: ctx.getImageData(0, 0, W, H).data };
    }
}
