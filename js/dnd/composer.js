// D&D fork — the map composer: one base (Terreno, Satellite, Temperatura, Fertilità) and the overlays laid over it, each
// on or off (Politica; the winds or the sea currents; the geology's materials one by one) — the map the DM builds the
// world with, and the maps a cartographer could sell the players. The overlays are drawn twice: on the planet's picture
// (areas and arrows, which belong to the ground) and on a screen layer over it (marks, names and lines, the same size at
// any zoom), and once more, at the export's width, for the map saved.

import { finishedClimateValue, drawArrows } from '../../v2/js/evolution/climate-view.js';
import { colorMap, satelliteMap, farmingMap, climateMap, paintAt, rollRows, rollShift } from '../../v2/js/evolution/export.js';
import { DEPOSITS, METALS } from '../../v2/js/geology/deposits.js';
import { P as PROJ } from '../../v2/js/view/projections.js';

const $ = (id) => document.getElementById(id);
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

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
const SEASON_IT = { year: "media dell'anno", jan: 'gennaio', jul: 'luglio' };
function tempColorAt(fin, W, season) {
    const T = finishedClimateValue('temperature', season, fin.climate, W), c = [0, 0, 0];
    return (out, o, x, y, wet, kk, k3, v, lake) => {
        if (wet || lake) { out[o] = SEA_RGB[0]; out[o + 1] = SEA_RGB[1]; out[o + 2] = SEA_RGB[2]; return; }
        tempRgb(T(x, y, false), c);
        const k = 0.62 + 0.38 * kk;
        out[o] = Math.min(255, c[0] * k); out[o + 1] = Math.min(255, c[1] * k); out[o + 2] = Math.min(255, c[2] * k);
    };
}
function tempLegend(season) {
    const g = TEMP_STOPS.map(([t, c]) => `${css(c)} ${Math.round(100 * (t + 30) / 62)}%`).join(', ');
    return `<div class="evo-legend-head">Temperatura, ${SEASON_IT[season] ?? season}</div>
        <div class="dnd-ramp" style="background:linear-gradient(90deg, ${g})"></div>
        <div class="dnd-ramp-labels"><span>−30 °C</span><span>0</span><span>15</span><span>32 °C</span></div>`;
}
/** The planet view's own layers (planet-view.js ownLayers): the Temperatura base. */
export const ownLayers = {
    has: (l) => l === TEMP_LAYER,
    colorAt: (layer, fin, W, lut, view) => tempColorAt(fin, W, view.season),
    legend: (layer, view) => tempLegend(view.season),
};

// ── the geology, simplified: a few materials, each its likely areas (soft and approximate) and its richest deposits ──
export const MATERIALS = [
    { id: 'iron', name: 'Ferro', sym: 'Fe', rgb: [150, 62, 30], metals: ['iron'] },
    { id: 'copper', name: 'Rame', sym: 'Cu', rgb: [206, 112, 40], metals: ['copper'] },
    { id: 'tin', name: 'Stagno', sym: 'Sn', rgb: [36, 146, 160], metals: ['tin'] },
    { id: 'silver', name: 'Argento', sym: 'Ag', rgb: [112, 124, 146], metals: ['silver'] },
    { id: 'gold', name: 'Oro', sym: 'Au', rgb: [212, 160, 20], metals: ['gold'] },
    { id: 'gems', name: 'Gemme', sym: '◆', rgb: [180, 34, 108], metals: ['diamonds'], group: 'gem' },
    { id: 'salt', name: 'Sale', sym: 'Sa', rgb: [190, 100, 190], metals: ['salt'] },
    { id: 'coal', name: 'Carbone', sym: 'C', rgb: [44, 40, 40], metals: ['coal'] },
];
const ZONE_FROM = 0.33, ZONE_FULL = 0.75, RICH = 0.7;

/** Each material's richness grid (0…1) from a finished world's deposits, blurred a little: zones, not exact bodies. */
function materialGrids(fin) {
    const Dp = fin?.raster?.geology?.deposits;
    if (!Dp?.data) return null;
    const K = Dp.cells.length, SYS = DEPOSITS.length, n = Dp.w * Dp.h, out = new Map();
    for (const m of MATERIALS) {
        const rows = [...m.metals.map(id => SYS + METALS.findIndex(x => x.id === id)).filter(r => r >= SYS), ...(m.group ? DEPOSITS.map((d, k) => (d.group === m.group ? k : -1)).filter(k => k >= 0) : [])];
        const v = new Float32Array(n);
        for (const r of rows) for (let j = 0; j < K; j++) { const x = Dp.data[r * K + j] / 255; if (x > v[Dp.cells[j]]) v[Dp.cells[j]] = x; }
        out.set(m.id, { raw: v, soft: blur(v, Dp.w, Dp.h, 2) });
    }
    return { w: Dp.w, h: Dp.h, grids: out };
}
function blur(f, W, H, r) {
    const a = new Float32Array(W * H), b = new Float32Array(W * H), n = 2 * r + 1;
    for (let y = 0; y < H; y++) { let s = 0; for (let k = -r; k <= r; k++) s += f[y * W + ((k + W) % W)]; for (let x = 0; x < W; x++) { a[y * W + x] = s / n; s += f[y * W + ((x + r + 1) % W)] - f[y * W + ((x - r + W) % W)]; } }
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { let s = 0, c = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += a[yy * W + x]; c++; } } b[y * W + x] = s / c; }
    // (the soft field keeps the cores' strength: the zone shows round the deposit, not a faded smear of it)
    for (let i = 0; i < W * H; i++) b[i] = Math.max(b[i] * 1.6, 0.85 * f[i]);
    return b;
}
/** A material's richest deposits: local peaks at least RICH (else its best few), kept ~6° apart, at most 6. */
function peaksOf(G, id) {
    const g = G.grids.get(id), W = G.w, H = G.h, v = g.raw, cand = [];
    for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
        const c = y * W + x, val = v[c]; if (val < 0.4) continue;
        let peak = true;
        for (let dy = -2; dy <= 2 && peak; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; if (v[yy * W + ((x + dx + W) % W)] > val) { peak = false; break; } }
        if (peak) cand.push([c, val]);
    }
    cand.sort((a, b) => b[1] - a[1]);
    const out = [], minDeg = 6;
    for (const [c, val] of cand) {
        if (out.length >= 6 || (out.length >= 3 && val < RICH)) break;
        const u = ((c % W) + 0.5) / W, vv = (Math.floor(c / W) + 0.5) / H;
        if (out.some(p => { let du = Math.abs(p.u - u); du = Math.min(du, 1 - du); return Math.hypot(du * 360 * Math.cos((0.5 - vv) * Math.PI), (p.v - vv) * 180) < minDeg; })) continue;
        out.push({ u, v: vv, rich: val });
    }
    return out;
}

// ── the composer ──
export class Composer {
    constructor({ pv, realm, world, onChange }) {
        this.pv = pv; this.realm = realm; this.world = world; this.onChange = onChange;
        this.base = 'terrain'; this.tempSeason = 'year'; this.fertMode = 'farmLand';
        this.flow = 'none'; this.geo = new Set(); this.version = 0;
        this.geoFor = null; this.geoData = null; this.peaks = new Map(); this.zoneCanvas = null; this.zoneKey = '';
        // (the screen layer: over the map, under the panels)
        this.screen = document.createElement('canvas');
        Object.assign(this.screen.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none' });
        ($('mapCanvas') ?? $('canvas')).after(this.screen);
        this.screenKey = ''; this.geoPos = [];
        realm.onEnable = (on) => this.setPolitics(on);
        this.mountBar();
        this.wireRotate();
        this.applyBase();
    }

    changed() { this.version++; this.onChange(); this.legend(); }
    key() { return `${this.flow}|${[...this.geo].join(',')}|${this.base === 'temp' ? this.tempSeason : 'year'}|${this.version}`; }

    // ── the dock on the right: a rail of icons (the bases, the overlays, the export) and the panel each opens ──
    mountBar() {
        const I = {
            terrain: '<path d="M3 19 9 9l4 6 3-4 5 8z"/>',
            satellite: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>',
            temp: '<path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z"/><path d="M12 10v6"/>',
            fert: '<path d="M12 20v-8"/><path d="M12 12C12 7 8 5 4 5c0 5 3 7 8 7z"/><path d="M12 14c0-4 3-6 8-6 0 4-3 6-8 6z"/>',
            politics: '<path d="M4 18 5 7l4 4 3-6 3 6 4-4 1 11z"/>',
            flow: '<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 14h15a3 3 0 1 1-3 3"/>',
            geo: '<path d="M7 4h10l4 6-9 10L3 10z"/><path d="M3 10h18M9 4l3 16 3-16"/>',
            export: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
        };
        const icon = (k) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;
        const btn = (k, label, extra = '') => `<button type="button" class="dnd-rail-btn" data-rail="${k}" title="${label}" aria-label="${label}"${extra}>${icon(k)}</button>`;
        const dock = document.createElement('div');
        dock.id = 'dndDock'; dock.className = 'dnd-dock';
        dock.innerHTML = `
            <div id="dndFly" class="dnd-fly" hidden>
                <section class="dnd-fly-part" data-part="temp" hidden>
                    <div class="dnd-fly-head"><h3>Temperatura</h3><button type="button" class="dnd-fly-x" aria-label="Chiudi">×</button></div>
                    <div class="dnd-choice" id="dndTempSeason">
                        <label><input type="radio" name="dndSeason" value="year" checked>Media dell'anno</label>
                        <label><input type="radio" name="dndSeason" value="jan">Gennaio</label>
                        <label><input type="radio" name="dndSeason" value="jul">Luglio</label>
                    </div>
                </section>
                <section class="dnd-fly-part" data-part="fert" hidden>
                    <div class="dnd-fly-head"><h3>Fertilità</h3><button type="button" class="dnd-fly-x" aria-label="Chiudi">×</button></div>
                    <div class="dnd-choice" id="dndFertMode">
                        <label><input type="radio" name="dndFert" value="farmLand" checked>Terre coltivabili</label>
                        <label><input type="radio" name="dndFert" value="aridity">Aridità</label>
                        <label><input type="radio" name="dndFert" value="growing">Stagione di crescita</label>
                    </div>
                </section>
                <section class="dnd-fly-part" data-part="flow" hidden>
                    <div class="dnd-fly-head"><h3>Venti e correnti</h3><button type="button" class="dnd-fly-x" aria-label="Chiudi">×</button></div>
                    <div class="dnd-choice" id="dndFlow">
                        <label><input type="radio" name="dndFlowR" value="none" checked>Niente</label>
                        <label><input type="radio" name="dndFlowR" value="wind">Venti <span class="dnd-hint">per le rotte volanti</span></label>
                        <label><input type="radio" name="dndFlowR" value="currents">Correnti marine</label>
                    </div>
                </section>
                <section class="dnd-fly-part" data-part="geo" hidden>
                    <div class="dnd-fly-head"><h3>Geologia</h3><button type="button" class="dnd-fly-x" aria-label="Chiudi">×</button></div>
                    <div id="dndGeoPop" class="dnd-choice">
                        ${MATERIALS.map(m => `<label class="dnd-mat"><input type="checkbox" value="${m.id}"><i class="dnd-dot" style="background:${css(m.rgb)}">${m.sym}</i>${m.name}</label>`).join('')}
                        <div class="dnd-pop-row"><button type="button" data-geo="all">Tutti</button><button type="button" data-geo="none">Nessuno</button></div>
                    </div>
                </section>
                <section class="dnd-fly-part" data-part="politics" hidden></section>
            </div>
            <nav id="dndRail" class="dnd-rail" aria-label="Mappa">
                ${btn('terrain', 'Terreno: la mappa disegnata, in stile antico')}
                ${btn('satellite', 'Satellite: il pianeta visto dallo spazio')}
                ${btn('temp', 'Temperatura: media dell’anno, di gennaio o di luglio')}
                ${btn('fert', 'Fertilità: terre coltivabili, aridità, stagione di crescita')}
                <span class="dnd-rail-sep" aria-hidden="true"></span>
                ${btn('politics', 'Politica: regni, città e sentieri')}
                ${btn('flow', 'Venti o correnti marine')}
                ${btn('geo', 'Geologia: zone e giacimenti dei materiali')}
                <span class="dnd-rail-sep" aria-hidden="true"></span>
                ${btn('export', 'Esporta la mappa come la vedi')}
            </nav>`;
        document.body.appendChild(dock);
        // (the Politica panel: the realm's controls, moved into the dock's panel)
        const pol = dock.querySelector('[data-part="politics"]');
        pol.innerHTML = `<div class="dnd-fly-head"><h3>Politica</h3><button type="button" class="dnd-fly-x" aria-label="Chiudi">×</button></div>
            <label class="toggle-label dnd-show"><input type="checkbox" id="dndPolitics" checked><span class="toggle-track"><span class="toggle-thumb"></span></span>Mostra sulla mappa</label>`;
        const section = $('realmSection');
        if (section) pol.appendChild(section);
        $('dndRight')?.remove();
        this.open = null;
        dock.querySelectorAll('.dnd-fly-x').forEach(x => x.addEventListener('click', () => this.openPart(null)));
        dock.querySelectorAll('[data-rail]').forEach(b => b.addEventListener('click', () => {
            const k = b.dataset.rail;
            if (['terrain', 'satellite', 'temp', 'fert'].includes(k)) {
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
        const pop = $('dndGeoPop');
        pop.addEventListener('change', (e) => { const id = e.target.value; if (e.target.checked) this.geo.add(id); else this.geo.delete(id); this.geoChanged(); });
        pop.addEventListener('click', (e) => {
            const b = e.target.closest('[data-geo]'); if (!b) return;
            for (const box of pop.querySelectorAll('input')) { box.checked = b.dataset.geo === 'all'; if (box.checked) this.geo.add(box.value); else this.geo.delete(box.value); }
            this.geoChanged();
        });
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
        const on = { terrain: this.base === 'terrain', satellite: this.base === 'satellite', temp: this.base === 'temp', fert: this.base === 'fert',
            politics: this.realm.enabled, flow: this.flow !== 'none', geo: this.geo.size > 0 };
        document.querySelectorAll('#dndRail [data-rail]').forEach(b => {
            const k = b.dataset.rail;
            b.classList.toggle('on', !!on[k]); b.classList.toggle('open', this.open === k);
            b.setAttribute('aria-pressed', String(!!on[k]));
        });
        const g = document.querySelector('#dndRail [data-rail="geo"]');
        if (g) g.dataset.count = this.geo.size ? String(this.geo.size) : '';
    }
    geoChanged() { this.zoneKey = ''; this.changed(); this.railState(); }
    setPolitics(on) { this.realm.enabled = on; if ($('dndPolitics')) $('dndPolitics').checked = on; if (!on && this.realm.editing) this.realm.setEditing(false); this.realm.version++; this.changed(); this.railState?.(); }
    applyBase() {
        const layer = { terrain: 'terrain', satellite: 'satellite', temp: TEMP_LAYER, fert: this.fertMode }[this.base];
        this.pv.view.season = this.base === 'temp' ? this.tempSeason : 'year';
        this.pv.setLayer(layer);
        this.changed();
        if ($('dndRail')) this.railState();
    }

    // ── the overlays on the planet's picture: the winds' or currents' arrows, the materials' zones ──
    draw(ctx, W, view) {
        const fin = this.world()?.fin;
        if (!fin) return;
        if (this.flow !== 'none' && fin.climate) drawArrows(ctx, W, this.flow === 'wind' ? 'wind' : 'currents', this.base === 'temp' ? this.tempSeason : 'year', fin.climate);
        if (this.geo.size) { const z = this.zones(fin); if (z) { ctx.imageSmoothingEnabled = true; ctx.drawImage(z, 0, 0, W, W >> 1); } }
    }
    geology(fin) {
        if (this.geoFor !== fin) { this.geoFor = fin; this.geoData = materialGrids(fin); this.peaks = new Map(); this.zoneKey = ''; }
        return this.geoData;
    }
    peaksFor(fin, id) { const G = this.geology(fin); if (!G) return []; if (!this.peaks.has(id)) this.peaks.set(id, peaksOf(G, id)); return this.peaks.get(id); }
    /** The zones of the materials chosen, on a canvas of the deposits' grid (drawn enlarged, smoothly: approximate). */
    zones(fin) {
        const G = this.geology(fin);
        if (!G) return null;
        const key = [...this.geo].join(',');
        if (this.zoneKey === key && this.zoneCanvas) return this.zoneCanvas;
        const cv = this.zoneCanvas ?? document.createElement('canvas');
        cv.width = G.w; cv.height = G.h;
        const cx = cv.getContext('2d'), im = cx.createImageData(G.w, G.h), px = im.data;
        const list = MATERIALS.filter(m => this.geo.has(m.id));
        for (let i = 0; i < G.w * G.h; i++) {
            let best = null, bv = 0;
            for (const m of list) { const v = G.grids.get(m.id).soft[i]; if (v > bv) { bv = v; best = m; } }
            if (!best) continue;
            const a = smooth(ZONE_FROM, ZONE_FULL, bv);
            if (a <= 0) continue;
            px[4 * i] = best.rgb[0]; px[4 * i + 1] = best.rgb[1]; px[4 * i + 2] = best.rgb[2]; px[4 * i + 3] = Math.round(150 * a);
        }
        cx.putImageData(im, 0, 0);
        this.zoneCanvas = cv; this.zoneKey = key;
        return cv;
    }

    // ── the screen layer: the realm's marks and names, the richest deposits ──
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
        const P = PROJ[fv.id], box = this.pv.globe.mapBox?.();
        return { key: `m|${fv.key}`, clip: box, at: (u, v) => {
            let lon = u * 2 * Math.PI - Math.PI - fv.centre;
            lon = ((lon + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
            const xy = P.fwd(lon, (0.5 - v) * Math.PI, fv.opts);
            return xy ? fv.toClient(xy[0], xy[1]) : null;
        } };
    }
    drawScreen() {
        const cv = this.screen, fin = this.world()?.fin, pr = fin ? this.projector() : null;
        const dpr = Math.min(2, devicePixelRatio || 1), Wc = Math.round(innerWidth * dpr), Hc = Math.round(innerHeight * dpr);
        const key = pr ? `${pr.key}|${this.realm.screenKey()}|${[...this.geo].join(',')}|${this.version}|${Wc}x${Hc}` : 'off';
        if (key === this.screenKey) return;
        this.screenKey = key;
        if (cv.width !== Wc || cv.height !== Hc) { cv.width = Wc; cv.height = Hc; }
        const ctx = cv.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, Wc, Hc);
        this.geoPos = [];
        if (!pr) { this.realm.screenPos = []; return; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.save();
        const clip = pr.clip;
        if (clip) { ctx.beginPath(); ctx.rect(clip.left, clip.top, clip.width, clip.height); ctx.clip(); }
        const jump = clip ? clip.width / 4 : innerWidth / 4;
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
        // (the richest deposits first, under the towns: a disc in the material's colour with its symbol)
        for (const m of MATERIALS) {
            if (!this.geo.has(m.id)) continue;
            for (const p of this.peaksFor(fin, m.id)) {
                const q = pr.at(p.u, p.v); if (!q) continue;
                const r = p.rich >= RICH ? 9 : 7.5;
                ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 2 * Math.PI); ctx.fillStyle = css(m.rgb); ctx.fill();
                ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(250,242,222,0.95)'; ctx.stroke();
                ctx.fillStyle = 'rgba(255,255,255,1)'; ctx.font = `600 ${m.sym.length > 1 ? 9 : 10}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(m.sym, q[0], q[1] + 0.5);
                placed.push([q[0] - r, q[1] - r, q[0] + r, q[1] + r]);
                this.geoPos.push({ x: q[0], y: q[1], m, rich: p.rich });
            }
        }
        this.realm.drawOnScreen(ctx, pr, line, placed);
        ctx.restore();
    }
    /** The hover card's lines for a deposit's mark under the pointer. */
    hoverLines(e) {
        const hit = e ? this.geoPos.find(g => Math.hypot(g.x - e.clientX, g.y - e.clientY) < 11) : null;
        return hit ? [`<span class="hi-label">Giacimento</span> <b>${hit.m.name}</b> · ${hit.rich >= RICH ? 'ricco' : 'discreto'}`] : [];
    }

    /** The overlays' legend, under the base's. */
    legend() {
        const el = $('dndLegend'); if (!el) return;
        const parts = [];
        if (this.flow === 'wind') parts.push('<div class="dnd-leg-row">➝ <b>Venti</b>: la direzione in cui soffiano, più lunghe dove sono forti</div>');
        if (this.flow === 'currents') parts.push('<div class="dnd-leg-row">➝ <b>Correnti marine</b>: dove spingono le navi</div>');
        if (this.geo.size) parts.push(`<div class="dnd-leg-row">${MATERIALS.filter(m => this.geo.has(m.id)).map(m => `<span class="dnd-leg-mat"><i class="dnd-dot" style="background:${css(m.rgb)}">${m.sym}</i>${m.name}</span>`).join('')}</div><div class="dnd-leg-note">Zone: dove il materiale è probabile · Cerchi: i giacimenti più ricchi</div>`);
        if (this.realm.enabled && this.realm.data) parts.push('<div class="dnd-leg-note">Sentieri: strade (marrone), vie fluviali (blu a puntini), rotte per mare (blu a tratti), con le frecce della corrente</div>');
        el.innerHTML = parts.join('');
        el.hidden = !parts.length;
        if (parts.length) $('legendCard').hidden = false;
    }

    // ── turning the map: drag it east or west (when not zoomed in), or type the degrees ──
    wireRotate() {
        const slider = $('sMapCenterLon');
        slider.step = '1';
        const setLon = (lon) => { lon = ((Math.round(lon) + 180) % 360 + 360) % 360 - 180; slider.value = String(lon); slider.dispatchEvent(new Event('input')); if ($('dndCenterNum')) $('dndCenterNum').value = String(lon); };
        // (the degrees as a number beside the slider)
        const num = document.createElement('input');
        num.type = 'number'; num.id = 'dndCenterNum'; num.className = 'dnd-num'; num.min = '-180'; num.max = '180'; num.step = '1'; num.value = slider.value;
        num.setAttribute('aria-label', 'Centro della mappa, gradi');
        $('vMapCenterLon')?.after(num);
        $('vMapCenterLon')?.classList.add('dnd-hidden');
        num.addEventListener('change', () => setLon(+num.value || 0));
        slider.addEventListener('input', () => { num.value = slider.value; });
        let drag = null;
        document.addEventListener('pointerdown', (e) => {
            const view = this.pv.view, mv = this.pv.globe.mapView;
            if (view.mode !== 'map' || e.target !== this.pv.ui.map || e.button !== 0 || e.ctrlKey || e.metaKey || this.realm.editing) return;
            // (a mouse's left button always turns the map; a finger turns it only zoomed out — zoomed in, it pans)
            if (e.pointerType !== 'mouse' && mv && mv.zoom > 1.02) return;
            drag = { x: e.clientX, lon: +slider.value, w: this.pv.globe.mapBox().width };
            e.stopImmediatePropagation(); e.preventDefault();
        }, { capture: true });
        addEventListener('pointermove', (e) => { if (!drag) return; e.stopImmediatePropagation(); setLon(drag.lon - (e.clientX - drag.x) / drag.w * 360); }, { capture: true });
        addEventListener('pointerup', () => { drag = null; }, { capture: true });
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
        } else if (this.base === 'fert') base = this.fertMode === 'farmLand' ? farmingMap(fin, W, 'farmLand', look) : climateMap(fin, W, this.fertMode, 'year', look);
        else base = colorMap(fin, W, look);
        const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext('2d');
        ctx.putImageData(new ImageData(new Uint8ClampedArray(base.data), W, H), 0, 0);
        // (the overlays, rolled as the base is: drawn once shifted, and again a map-width over where they cross the edge)
        for (const tx of shift ? [-shift, W - shift] : [0]) {
            ctx.save(); ctx.translate(tx, 0);
            if (this.geo.size) { const z = this.zones(fin); if (z) { ctx.imageSmoothingEnabled = true; ctx.drawImage(z, 0, 0, W, H); } }
            if (this.flow !== 'none' && fin.climate) drawArrows(ctx, W, this.flow === 'wind' ? 'wind' : 'currents', season, fin.climate);
            ctx.restore();
        }
        if (this.realm.enabled && this.realm.data) this.realm.paint(ctx, W, { ...this.realm.show, cities: true }, shift);
        // (the richest deposits over everything, so a kingdom's colour never hides them)
        if (this.geo.size) for (const tx of shift ? [-shift, W - shift] : [0]) { ctx.save(); ctx.translate(tx, 0); this.paintPeaks(ctx, W, H, fin); ctx.restore(); }
        return { kind: 'rgba', W, H, data: ctx.getImageData(0, 0, W, H).data };
    }
    paintPeaks(ctx, W, H, fin) {
        const s = W / 1600;
        for (const m of MATERIALS) {
            if (!this.geo.has(m.id)) continue;
            for (const p of this.peaksFor(fin, m.id)) {
                const x = p.u * W, y = p.v * H, r = (p.rich >= RICH ? 9 : 7.5) * s;
                ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fillStyle = css(m.rgb); ctx.fill();
                ctx.lineWidth = 1.6 * s; ctx.strokeStyle = 'rgba(250,242,222,0.95)'; ctx.stroke();
                ctx.fillStyle = 'rgba(255,255,255,1)'; ctx.font = `600 ${(m.sym.length > 1 ? 9 : 10) * s}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(m.sym, x, y + 0.5 * s);
            }
        }
    }
}
