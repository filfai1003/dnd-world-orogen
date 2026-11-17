// D&D fork — the realm on Generate's page: the "Regni e città" section, the Politica view's drawing (kingdoms, borders,
// cities, routes), moving cities by hand, the kingdoms' summaries, the hover lines, the export's maps, and the realm kept
// in the browser per planet code. The work itself is realm-worker.js's; the grid it works on, realm-data.js's.

import { realmGrid, GW, GH, KOPPEN_CODES } from './realm-data.js';
import { colorMap, rollShift } from '../../v2/js/evolution/export.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const fmt = (n) => Math.round(n).toLocaleString('it-IT');

export const KINGDOM_RGB = [[181, 82, 59], [59, 111, 181], [78, 154, 74], [193, 154, 46], [122, 79, 160], [46, 154, 150], [181, 115, 154], [138, 106, 59],
    [90, 122, 46], [181, 138, 90], [59, 79, 138], [154, 46, 79], [106, 154, 181], [160, 160, 59], [96, 96, 96], [196, 122, 46]];
const kcol = (k, a = 1) => { const c = KINGDOM_RGB[k % KINGDOM_RGB.length]; return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };

const LIFE_IT = ['Disabitato', 'Agricoltura', 'Pastorizia', 'Caccia, pesca e raccolta'];
const STAPLE_IT = ['Niente', 'Cereali di risaia (riso)', 'Cereali da clima fresco (grano, orzo, segale)', 'Cereali da clima caldo (mais, miglio, sorgo)', 'Radici e tuberi', 'Bestiame (latte, carne, lana)', 'Pesce', 'Selvaggina e frutti selvatici'];
const CLIMATE_IT = { A: 'Tropicale', B: 'Arido', C: 'Temperato', D: 'Continentale', E: 'Polare' };
const rank = (p, capital) => (capital ? 'Capitale' : p >= 50000 ? 'Metropoli' : p >= 15000 ? 'Città' : p >= 4000 ? 'Borgo' : 'Villaggio');

export class Realm {
    /** `pv`: the planet view; `onChange()`: repaint; `getCode()`: the planet code (the realm kept per code). */
    constructor({ pv, onChange, getCode }) {
        this.pv = pv; this.onChange = onChange; this.getCode = getCode;
        this.world = null; this.data = null; this.version = 0; this.busy = false; this.ready = false; this.reqId = 0;
        this.names = { kingdoms: [], cities: [] };
        this.show = { fills: true, borders: true, routes: true, names: true };
        this.editing = false; this.drag = null;
        // (on or off over any base map: the composer's Politica switch — composer.js draws it on screen)
        this.enabled = true; this.screenPos = []; this.labelBoxes = [];
        this.openK = new Set();                        // (the kingdoms opened in the list: none at first)
        this.worker = new Worker(new URL('./realm-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }) => this.received(data);
        this.worker.onerror = (e) => this.status(`Errore nel calcolo dei regni: ${e.message}`);
        this.wire();
    }

    // ── the sidebar section ──
    wire() {
        const k = $('sRealmK'), n = $('sRealmN');
        const sync = () => {
            $('vRealmK').textContent = k.value;
            if (+n.value < +k.value) { n.value = k.value; n.dispatchEvent(new Event('input')); }
            $('vRealmN').textContent = n.value;
        };
        k.addEventListener('input', sync); n.addEventListener('input', sync); sync();
        $('realmBuild').addEventListener('click', () => this.auto());
        $('realmReset').addEventListener('click', () => { this.forget(); this.auto(); });
        for (const [id, key] of [['chkRealmFills', 'fills'], ['chkRealmBorders', 'borders'], ['chkRealmRoutes', 'routes'], ['chkRealmNames', 'names']]) {
            $(id).checked = this.show[key];
            $(id).addEventListener('change', (e) => { this.show[key] = e.target.checked; this.changed(false); });
        }
        $('realmEdit').addEventListener('click', () => this.setEditing(!this.editing));
        // (the lists: names typed, a capital chosen, a city removed)
        const list = $('realmList');
        list.addEventListener('change', (e) => {
            const t = e.target;
            if (t.dataset.kname !== undefined) { this.names.kingdoms[+t.dataset.kname] = t.value; this.changed(false); this.save(); }
            if (t.dataset.cname !== undefined) { this.names.cities[+t.dataset.cname] = t.value; this.changed(false); this.save(); }
        });
        list.addEventListener('click', (e) => {
            const f = e.target.closest('button[data-fold]');
            if (f) { const k = +f.dataset.fold; if (this.openK.has(k)) this.openK.delete(k); else this.openK.add(k); this.renderList(); return; }
            const b = e.target.closest('button[data-act]');
            if (!b || !this.data) return;
            const i = +b.dataset.i, cities = this.data.cities;
            if (b.dataset.act === 'capital') { cities[i].capital = !cities[i].capital; if (!cities.some(c => c.capital)) cities[i].capital = true; this.fixed(); }
            if (b.dataset.act === 'remove' && cities.length > 1) { this.removeCity(i); this.fixed(); }
        });
        // (moving cities by hand: the pointer caught before the globe sees it)
        document.addEventListener('pointerdown', (e) => this.pointerDown(e), { capture: true });
        addEventListener('pointermove', (e) => this.pointerMove(e), { capture: true });
        addEventListener('pointerup', (e) => this.pointerUp(e), { capture: true });
        addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.editing) this.setEditing(false); });
        // (a name changed on the map: a double click on a city or on a kingdom)
        document.addEventListener('dblclick', (e) => this.renameAt(e), { capture: true });
        list.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input.realm-name')) e.target.blur(); });
    }

    /** A box over the map to type a new name for the city or the kingdom under the pointer. */
    renameAt(e) {
        if (!this.enabled || !this.data || !this.onPlanet(e)) return;
        let hit = null;
        for (const b of this.labelBoxes) if (e.clientX >= b.box[0] && e.clientX <= b.box[2] && e.clientY >= b.box[1] && e.clientY <= b.box[3]) { hit = b; break; }
        if (!hit) {
            const p = this.pv.placeUnder(e);
            const i = p ? this.cityNear(p[0], p[1], e) : -1;
            if (i >= 0) hit = { kind: 'c', i };
            else if (p) {
                const x = Math.min(GW - 1, Math.floor(p[0] * GW)), y = Math.min(GH - 1, Math.max(0, Math.floor(p[1] * GH))), k = this.data.owner[y * GW + x];
                if (k >= 0) hit = { kind: 'k', i: k };
            }
        }
        if (!hit) return;
        e.preventDefault(); e.stopImmediatePropagation();
        const names = hit.kind === 'k' ? this.names.kingdoms : this.names.cities;
        document.querySelector('.realm-rename')?.remove();
        const box = document.createElement('div');
        box.className = 'realm-rename';
        box.innerHTML = `<label>${hit.kind === 'k' ? 'Nome del regno' : 'Nome della città'}</label><input type="text" value="${esc(names[hit.i] ?? '')}" spellcheck="false">`;
        box.style.left = `${Math.min(innerWidth - 230, Math.max(8, e.clientX - 100))}px`;
        box.style.top = `${Math.min(innerHeight - 80, e.clientY + 14)}px`;
        document.body.appendChild(box);
        const input = box.querySelector('input');
        let done = false;
        const close = (keep) => {
            if (done) return; done = true;
            const v = input.value.trim();
            box.remove();
            if (keep && v && v !== names[hit.i]) { names[hit.i] = v; this.changed(); this.save(); }
        };
        input.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Enter') close(true); if (k.key === 'Escape') close(false); });
        input.addEventListener('blur', () => close(true));
        input.focus(); input.select();
    }

    status(text) { const el = $('realmStatus'); if (el) { el.textContent = text || ''; el.hidden = !text; } }
    changed(recount = true) { this.version++; this.onChange(); if (recount) this.renderList(); }

    /** The key the overlay is drawn again for. */
    key(view) { return `${this.enabled}|${this.version}|${this.drag ? `${this.drag.u.toFixed(4)},${this.drag.v.toFixed(4)}` : ''}`; }

    // ── a world: its grid read, the realm worked out (or the one kept for its code) ──
    clear() { this.world = null; this.data = null; this.ready = false; this.changed(); this.status('I regni arrivano quando il pianeta è finito (clima, fiumi e cibo)…'); }
    setWorld(w) {
        if (!w?.fin) return;
        this.world = w; this.data = null; this.ready = false; this.landMask = null;
        this.status('Leggo il terreno, il clima e il cibo…');
        // (a moment for the status to show before the grid's work holds the page)
        setTimeout(() => {
            if (this.world !== w) return;
            let grid;
            try { grid = realmGrid(w.fin); } catch (err) { console.error(err); this.status(`Non riesco a leggere il pianeta: ${err.message}`); return; }
            this.worker.postMessage({ cmd: 'init', grid: { ...grid, codes: KOPPEN_CODES } });
            const kept = this.load();
            if (kept?.cities?.length) { this.names = kept.names ?? this.names; this.request({ cmd: 'fixed', cities: kept.cities }); }
            else this.auto();
        }, 30);
    }
    auto() {
        if (!this.world?.fin) return;
        this.names = { kingdoms: [], cities: [] };
        this.request({ cmd: 'auto', K: +$('sRealmK').value, N: +$('sRealmN').value });
    }
    /** The realm again from the cities as they stand (moved, added, removed, a capital changed). */
    fixed() {
        if (!this.data) return;
        this.request({ cmd: 'fixed', cities: this.data.cities.map(c => ({ u: c.u, v: c.v, capital: c.capital })) });
    }
    request(msg) {
        this.busy = true; msg.id = ++this.reqId;
        this.status(msg.cmd === 'auto' ? 'Piazzo regni e città, traccio i sentieri…' : 'Ricalcolo confini e sentieri…');
        this.worker.postMessage(msg);
    }
    received(m) {
        if (m.type === 'ready') return;
        if (m.id !== this.reqId) return;
        this.busy = false;
        if (m.type === 'error') { console.error(m.message); this.status(`Errore: ${m.message.split('\n')[0]}`); return; }
        this.data = m; this.ready = true;
        // (names: a kingdom by its index, a city by its place in the list — kept as they were where they still exist)
        this.names.kingdoms = Array.from({ length: m.K }, (_, k) => this.names.kingdoms[k] || `Regno ${k + 1}`);
        this.names.cities = m.cities.map((c, i) => this.names.cities[i] || (c.capital ? `Capitale ${this.romanOf(c.kingdom)}` : `Città ${i + 1}`));
        this.status(`${m.K} regni, ${m.cities.length} città, ${m.routes.length} collegamenti · ${(m.ms / 1000).toFixed(1)} s`);
        this.drawCache = null;
        this.changed();
        this.save();
    }
    romanOf(k) { const r = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI']; return r[k] ?? String(k + 1); }
    removeCity(i) { this.data.cities.splice(i, 1); this.names.cities.splice(i, 1); }

    // ── kept in the browser, per planet code ──
    storeKey() { const c = this.getCode(); return c ? `dnd-realm:${c}` : null; }
    save() {
        const k = this.storeKey(); if (!k || !this.data) return;
        try { localStorage.setItem(k, JSON.stringify({ cities: this.data.cities.map(c => ({ u: +c.u.toFixed(5), v: +c.v.toFixed(5), capital: c.capital })), names: this.names })); } catch { /* (kept only where the browser allows) */ }
    }
    load() { const k = this.storeKey(); if (!k) return null; try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
    forget() { const k = this.storeKey(); if (k) try { localStorage.removeItem(k); } catch { /* */ } }

    // ── the lists and the kingdoms' summaries ──
    renderList() {
        const el = $('realmList');
        if (!el) return;
        const d = this.data;
        if (!d) { el.innerHTML = ''; return; }
        const pct = (v, t) => (t > 0 ? Math.round(100 * v / t) : 0);
        el.innerHTML = d.kingdoms.map((K, k) => {
            const lifeT = K.byLife.reduce((s, v) => s + v, 0), stT = K.byStaple.reduce((s, v) => s + v, 0), clT = Object.values(K.climate).reduce((s, v) => s + v, 0);
            const lives = K.byLife.map((v, i) => [i, v]).filter(([i, v]) => i && pct(v, lifeT) >= 3).sort((a, b) => b[1] - a[1]).map(([i, v]) => `${LIFE_IT[i]} ${pct(v, lifeT)}%`).join(' · ');
            const staples = K.byStaple.map((v, i) => [i, v]).filter(([i, v]) => i && pct(v, stT) >= 5).sort((a, b) => b[1] - a[1]).map(([i, v]) => `${STAPLE_IT[i]} ${pct(v, stT)}%`).join(' · ');
            const climate = Object.entries(K.climate).filter(([, v]) => pct(v, clT) >= 5).sort((a, b) => b[1] - a[1]).map(([g, v]) => `${CLIMATE_IT[g]} ${pct(v, clT)}%`).join(' · ');
            const ss = K.selfSufficiency, ssWord = ss >= 1.3 ? 'autosufficiente, con eccedenze' : ss >= 1 ? 'autosufficiente, al limite' : 'non autosufficiente: dipende dai vicini';
            const ssNum = ss.toLocaleString('it-IT', { maximumFractionDigits: 1 });
            const towns = d.cities.map((c, i) => [c, i]).filter(([c]) => c.kingdom === k).sort((a, b) => (b[0].capital - a[0].capital) || (b[0].people - a[0].people));
            const links = (i) => d.routes.filter(r => r.a === i || r.b === i).map(r => { const o = r.a === i ? r.b : r.a; const by = r.modes.some(m => m === 2) ? 'per mare' : r.modes.some(m => m === 1) ? 'per fiume' : 'a piedi'; return `${esc(this.names.cities[o] ?? '')} ${r.days.toFixed(0)} g ${by}`; }).join(' · ');
            const open = this.openK.has(k);
            return `<div class="realm-k${open ? ' open' : ''}">
                <div class="realm-k-head"><button type="button" class="realm-fold" data-fold="${k}" aria-expanded="${open}" aria-label="${open ? 'Chiudi' : 'Apri'} il regno">${open ? '▾' : '▸'}</button><i class="realm-swatch" style="background:${kcol(k)}"></i><input class="realm-name" data-kname="${k}" value="${esc(this.names.kingdoms[k])}" aria-label="Nome del regno"><span class="realm-meta">${K.cities} città</span></div>
                ${open ? `<div class="realm-facts">
                    <div><b>Popolazione stimata</b> ${fmt(K.people)} · <b>Superficie</b> ${fmt(K.area)} km² · <b>Città</b> ${K.cities} (porti ${K.ports})</div>
                    <div><b>Cibo</b> ${ssWord}: la sua terra potrebbe sfamare ~${fmt(K.food)} persone, ${ssNum} volte la popolazione</div>
                    <div><b>Come si nutre</b> ${lives || '—'}</div>
                    <div><b>Alimenti principali</b> ${staples || '—'}</div>
                    <div><b>Clima</b> ${climate || '—'}</div>
                    <div><b>Territorio</b> montagne ${pct(K.mountains, K.area)}% · coste ~${fmt(K.coastKm)} km · fiumi navigabili ~${fmt(K.navigable)} km${K.wild > 0 ? ` · terre selvagge ${pct(K.wild, K.area)}%` : ''}</div>
                </div>
                <ul class="realm-cities">${towns.map(([c, i]) => `<li>
                    <button type="button" data-act="capital" data-i="${i}" class="realm-cap${c.capital ? ' on' : ''}" title="${c.capital ? 'Capitale (clic: non più capitale)' : 'Rendi capitale: nasce un nuovo regno'}">★</button>
                    <input class="realm-name" data-cname="${i}" value="${esc(this.names.cities[i] ?? '')}" aria-label="Nome della città">
                    <span class="realm-meta">${rank(c.people, c.capital)} · ${fmt(c.people)} ab.${c.port ? ' · porto' : ''}${c.river ? ' · fiume' : ''}</span>
                    <button type="button" data-act="remove" data-i="${i}" class="realm-del" title="Togli la città">×</button>
                    <div class="realm-links">${links(i)}</div></li>`).join('')}</ul>` : ''}
            </div>`;
        }).join('');
    }

    // ── moving cities by hand ──
    setEditing(on) {
        this.editing = on;
        $('realmEdit').classList.toggle('active', on);
        $('realmEdit').textContent = on ? 'Fine modifica' : 'Modifica città';
        $('realmEditHint').hidden = !on;
        if (on && !this.enabled) this.onEnable?.(true);
    }
    onPlanet(e) { return e.target === this.pv.ui.canvas || e.target === this.pv.ui.map; }
    uvOf(e) { const p = this.pv.placeUnder(e); return p ? { u: p[0], v: p[1] } : null; }
    cityNear(u, v, e = null) {
        if (!this.data) return -1;
        if (e && this.screenPos.length === this.data.cities.length) {
            let best = -1, bd = 14;
            this.screenPos.forEach((q, i) => { if (!q) return; const d = Math.hypot(q[0] - e.clientX, q[1] - e.clientY); if (d < bd) { bd = d; best = i; } });
            return best;
        }
        const zoom = this.pv.view.mode === 'map' ? (this.pv.globe.mapView?.zoom || 1) : 1, tol = 2.2 / Math.max(1, zoom);
        let best = -1, bd = tol;
        this.data.cities.forEach((c, i) => {
            let du = c.u - u; if (du > 0.5) du -= 1; if (du < -0.5) du += 1;
            const lat = (0.5 - v) * Math.PI, d = Math.hypot(du * 360 * Math.cos(lat), (c.v - v) * 180);
            if (d < bd) { bd = d; best = i; }
        });
        return best;
    }
    pointerDown(e) {
        if (!this.editing || !this.enabled || !this.data || this.busy || !this.onPlanet(e) || e.button !== 0) return;
        const at = this.uvOf(e); if (!at) return;
        const i = this.cityNear(at.u, at.v, e);
        e.stopImmediatePropagation(); e.preventDefault();
        if (i < 0) {
            // (a click on empty land: a new city there)
            this.data.cities.push({ u: at.u, v: at.v, capital: false, kingdom: -1, people: 0 });
            this.names.cities.push(`Città ${this.data.cities.length}`);
            this.fixed();
            return;
        }
        this.drag = { i, u: at.u, v: at.v, x: e.clientX, y: e.clientY, moved: false };
    }
    pointerMove(e) {
        if (!this.drag) return;
        e.stopImmediatePropagation();
        const at = this.uvOf(e); if (!at) return;
        if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 4) this.drag.moved = true;
        this.drag.u = at.u; this.drag.v = at.v;
        this.version++; this.onChange();
    }
    pointerUp(e) {
        if (!this.drag) return;
        e.stopImmediatePropagation();
        const d = this.drag; this.drag = null;
        if (!d.moved) { this.version++; this.onChange(); return; }
        const c = this.data.cities[d.i]; c.u = d.u; c.v = d.v;
        this.fixed();
    }

    // ── the hover card's lines on the Politica view ──
    hoverLines(p, e = null) {
        if (!this.enabled || !this.data || !p) return [];
        const out = [], x = Math.min(GW - 1, Math.floor(p[0] * GW)), y = Math.min(GH - 1, Math.max(0, Math.floor(p[1] * GH))), k = this.data.owner[y * GW + x];
        if (k >= 0) out.push(`<span style="color:${kcol(k)}">■</span> <b>${esc(this.names.kingdoms[k])}</b>`);
        const i = this.cityNear(p[0], p[1], e);
        if (i >= 0) {
            const c = this.data.cities[i];
            out.push(`<span class="hi-label">${rank(c.people, c.capital)}</span> <b>${esc(this.names.cities[i])}</b> · ${fmt(c.people)} abitanti${c.port ? ' · porto' : ''}${c.river ? ' · sul fiume' : ''}`);
        }
        if (out.length) out.push('<span class="hi-label">Doppio clic per cambiare il nome</span>');
        return out;
    }

    // ── drawing: on the planet's texture (W × W/2, equirectangular), and on the export's maps ──
    /**
     * Everything the realm draws, on `ctx` at width `W` (`o`: which parts; `shift`: the export's roll, in pixels).
     */
    paint(ctx, W, o = this.show, shift = 0) {
        const d = this.data; if (!d) return;
        const H = W >> 1, s = W / 1600;
        ctx.save();
        const passes = shift ? [-shift, W - shift] : [0];
        for (const tx of passes) {
            ctx.save(); ctx.translate(tx, 0);
            if (o.fills) this.paintFills(ctx, W, H);
            if (o.borders) this.paintBorders(ctx, W, H, s);
            if (o.routes) this.paintRoutes(ctx, W, H, s);
            if (o.cities !== false) this.paintCities(ctx, W, H, s, o.names);
            ctx.restore();
        }
        ctx.restore();
    }
    draw(ctx, W, view) {
        if (!this.enabled || !this.data) return;
        this.paint(ctx, W, { fills: this.show.fills, borders: false, routes: false, cities: false });
    }
    paintFills(ctx, W, H) {
        const d = this.data;
        if (!this.fillCanvas || this.fillFor !== d) {
            const cv = document.createElement('canvas'); cv.width = GW; cv.height = GH;
            const cx = cv.getContext('2d'), im = cx.createImageData(GW, GH), px = im.data;
            for (let c = 0; c < GW * GH; c++) {
                const k = d.owner[c]; if (k < 0) continue;
                const col = KINGDOM_RGB[k % KINGDOM_RGB.length];
                px[4 * c] = col[0]; px[4 * c + 1] = col[1]; px[4 * c + 2] = col[2]; px[4 * c + 3] = 115;
            }
            cx.putImageData(im, 0, 0);
            this.fillCanvas = cv; this.fillFor = d;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.fillCanvas, 0, 0, W, H);
    }
    /** The borders between kingdoms (and between a kingdom and the wild), traced along the cells' edges as chains,
     *  smoothed. */
    borderChains() {
        const d = this.data;
        if (this.chainsFor === d) return this.chains;
        const own = d.owner, segs = new Map(), add = (a, b) => { (segs.get(a) ?? segs.set(a, []).get(a)).push(b); (segs.get(b) ?? segs.set(b, []).get(b)).push(a); };
        const V = (x, y) => y * (GW + 1) + x, isLand = (c) => own[c] >= 0 || this.landOf(c);
        for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
            const c = y * GW + x, k = own[c];
            const r = y * GW + ((x + 1) % GW);
            if (k !== own[r] && isLand(c) && isLand(r)) add(V(x + 1, y), V(x + 1, y + 1));
            if (y + 1 < GH) { const b = (y + 1) * GW + x; if (k !== own[b] && isLand(c) && isLand(b)) add(V(x, y + 1), V(x + 1, y + 1)); }
        }
        const used = new Set(), chains = [], ek = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
        const walk = (start, next) => {
            const pts = [start, next]; used.add(ek(start, next));
            let prev = start, cur = next;
            for (;;) {
                const nb = segs.get(cur); if (!nb || nb.length !== 2) break;
                const nx = nb[0] === prev ? nb[1] : nb[0];
                if (used.has(ek(cur, nx))) break;
                used.add(ek(cur, nx)); pts.push(nx); prev = cur; cur = nx;
            }
            return pts;
        };
        for (const [a, nb] of segs) if (nb.length !== 2) for (const b of nb) if (!used.has(ek(a, b))) chains.push(walk(a, b));
        for (const [a, nb] of segs) for (const b of nb) if (!used.has(ek(a, b))) chains.push(walk(a, b));
        this.chains = chains.map(ch => smooth(ch.map(v => [(v % (GW + 1)) / GW, Math.floor(v / (GW + 1)) / GH]), 3));
        this.chainsFor = d;
        return this.chains;
    }
    landOf(c) { return !!this.landMask?.[c]; }
    paintBorders(ctx, W, H, s) {
        if (!this.landMask && this.world?.fin) this.landMask = maskOf(this.world.fin);
        const chains = this.borderChains();
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (const [width, style, dash] of [[3.2 * s, 'rgba(250,240,215,0.55)', []], [1.5 * s, 'rgba(70,40,25,0.85)', [5 * s, 2.5 * s]]]) {
            ctx.lineWidth = width; ctx.strokeStyle = style; ctx.setLineDash(dash);
            ctx.beginPath();
            for (const ch of chains) strokeWrapped(ctx, ch, W, H);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }
    paintRoutes(ctx, W, H, s) {
        const d = this.data;
        const kind = (r) => { const A = d.cities[r.a], B = d.cities[r.b]; return A?.capital && B?.capital ? 'major' : (A?.capital || B?.capital) && A?.kingdom === B?.kingdom ? 'road' : 'trail'; };
        const STY = {
            land: { major: [2.6 * s, 'rgba(110,55,25,0.95)', []], road: [1.8 * s, 'rgba(120,65,30,0.9)', []], trail: [1.2 * s, 'rgba(120,70,35,0.85)', [3 * s, 2 * s]] },
            river: [1.6 * s, 'rgba(20,60,120,0.9)', [1 * s, 2.2 * s]],
            sea: [1.4 * s, 'rgba(25,45,95,0.85)', [6 * s, 3.5 * s]],
        };
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        this.runs = this.routeRuns();
        // (a pale halo under the roads, so they read over any ground)
        ctx.strokeStyle = 'rgba(250,240,215,0.5)'; ctx.setLineDash([]);
        ctx.lineWidth = 3.4 * s; ctx.beginPath();
        for (const run of this.runs) if (run.mode === 0) strokeWrapped(ctx, run.pts, W, H);
        ctx.stroke();
        for (const run of this.runs) {
            const [w, col, dash] = run.mode === 0 ? STY.land[run.kind] : run.mode === 1 ? STY.river : STY.sea;
            ctx.lineWidth = w; ctx.strokeStyle = col; ctx.setLineDash(dash);
            ctx.beginPath(); strokeWrapped(ctx, run.pts, W, H); ctx.stroke();
        }
        ctx.setLineDash([]);
        // (the current's arrows along the sea routes, every few cells)
        ctx.strokeStyle = 'rgba(0,118,128,0.95)'; ctx.fillStyle = 'rgba(0,118,128,0.95)'; ctx.lineWidth = 1.4 * s;
        for (const run of this.runs) {
            if (run.mode !== 2 || !run.cur) continue;
            run.raw.forEach((p, k) => {
                const c = run.cur[k]; if (!c || k % 6 !== 3) return;
                const sp = Math.hypot(c[0], c[1]); if (!(sp > 0.02)) return;
                const ex = c[0] / sp, ey = -c[1] / sp;
                arrow(ctx, p[0] * W + ey * 5 * s, p[1] * H - ex * 5 * s, ex, ey, (5 + Math.min(9, 20 * sp)) * s);
            });
        }
    }
    paintCities(ctx, W, H, s, names) {
        const d = this.data, dr = this.drag;
        const order = d.cities.map((c, i) => i).sort((a, b) => d.cities[a].people - d.cities[b].people);
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        for (const i of order) {
            const c = d.cities[i], u = dr && dr.i === i ? dr.u : c.u, v = dr && dr.i === i ? dr.v : c.v;
            const x = u * W, y = v * H, big = c.capital, r = (big ? 5.5 : 2.4 + Math.min(2.6, Math.log10(Math.max(1000, c.people)) - 3)) * s;
            ctx.lineWidth = 1.2 * s; ctx.strokeStyle = 'rgba(40,25,15,0.95)'; ctx.fillStyle = big ? kcol(c.kingdom) : 'rgba(250,240,215,0.95)';
            if (big) { star(ctx, x, y, r); ctx.fill(); ctx.stroke(); }
            else { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); }
            if (c.port) { ctx.beginPath(); ctx.arc(x, y, r + 2 * s, 0.15 * Math.PI, 0.85 * Math.PI); ctx.strokeStyle = 'rgba(25,45,95,0.9)'; ctx.stroke(); }
            if (!names) continue;
            const name = this.names.cities[i] ?? '';
            ctx.font = `${big ? '600 ' : ''}${(big ? 13 : 10) * s}px Georgia, 'Times New Roman', serif`;
            ctx.lineWidth = 3 * s; ctx.strokeStyle = 'rgba(250,240,215,0.85)'; ctx.strokeText(name, x + r + 3 * s, y);
            ctx.fillStyle = 'rgba(40,25,15,1)'; ctx.fillText(name, x + r + 3 * s, y);
        }
        // (the kingdoms' names, large, over their capitals)
        if (names && this.show.fills) {
            for (const c of d.cities) {
                if (!c.capital) continue;
                const name = (this.names.kingdoms[c.kingdom] ?? '').toUpperCase(), x = c.u * W, y = c.v * H - 16 * s;
                ctx.font = `600 ${16 * s}px Georgia, 'Times New Roman', serif`; ctx.textAlign = 'center';
                ctx.lineWidth = 3.5 * s; ctx.strokeStyle = 'rgba(250,240,215,0.7)'; ctx.strokeText(name, x, y);
                ctx.fillStyle = kcol(c.kingdom, 0.95); ctx.fillText(name, x, y);
                ctx.textAlign = 'left';
            }
        }
    }

    // ── on screen: each city's mark and name, and each kingdom's name, at a constant size (composer.js's layer) ──
    /** The screen key's part for the realm (drawn again when it changes). */
    screenKey() { const sh = this.show; return `${this.enabled}|${!!this.data}|${this.version}|${sh.names}|${sh.fills}|${sh.borders}|${sh.routes}`; }
    /** Draw on the composer's screen layer: `pr.at(u, v)` → client px or null, `line(pts)` a broken polyline, `placed` the
     *  labels' boxes already taken. */
    drawOnScreen(ctx, pr, line, placed) {
        this.screenPos = [];
        this.labelBoxes = [];
        if (!this.enabled || !this.data) return;
        const sh = this.show;
        const d = this.data, dr = this.drag;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        // (the borders: a pale halo and a dark dashed line)
        if (sh.borders) {
            if (!this.landMask && this.world?.fin) this.landMask = maskOf(this.world.fin);
            const chains = this.borderChains();
            for (const [w, col, dash] of [[4, 'rgba(250,242,222,0.6)', []], [1.6, 'rgba(70,40,25,0.9)', [6, 3]]]) {
                ctx.lineWidth = w; ctx.strokeStyle = col; ctx.setLineDash(dash);
                ctx.beginPath(); for (const ch of chains) line(ch); ctx.stroke();
            }
            ctx.setLineDash([]);
        }
        // (the routes: roads by their rank, river ways dotted blue, sea routes dashed navy)
        if (sh.routes) {
            const runs = this.routeRuns();
            ctx.strokeStyle = 'rgba(250,242,222,0.6)'; ctx.lineWidth = 4.5;
            ctx.beginPath(); for (const r of runs) if (r.mode === 0) line(r.pts); ctx.stroke();
            const STY = { major: [2.6, 'rgba(110,55,25,0.95)', []], road: [2, 'rgba(120,65,30,0.92)', []], trail: [1.4, 'rgba(120,70,35,0.9)', [4, 3]] };
            for (const r of runs) {
                const [w, col, dash] = r.mode === 0 ? STY[r.kind] : r.mode === 1 ? [2, 'rgba(20,60,130,0.95)', [1, 3.5]] : [1.8, 'rgba(25,45,95,0.9)', [7, 4]];
                ctx.lineWidth = w; ctx.strokeStyle = col; ctx.setLineDash(dash);
                ctx.beginPath(); line(r.pts); ctx.stroke();
            }
            ctx.setLineDash([]);
            // (on the sea routes, the current's arrows: where it sets the ship, and how hard — one every ~50 px)
            ctx.strokeStyle = 'rgba(0,118,128,0.95)'; ctx.fillStyle = 'rgba(0,118,128,0.95)'; ctx.lineWidth = 1.6;
            for (const r of runs) {
                if (r.mode !== 2 || !r.cur) continue;
                let last = null;
                r.raw.forEach((p, k) => {
                    const c = r.cur[k]; if (!c) return;
                    const sp = Math.hypot(c[0], c[1]); if (!(sp > 0.02)) return;
                    const q = pr.at(((p[0] % 1) + 1) % 1, p[1]); if (!q) return;
                    if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 50) return;
                    const lat = (0.5 - p[1]) * Math.PI, step = 0.6 / 360, du = c[0] / sp * step / Math.max(0.2, Math.cos(lat)), dv = -c[1] / sp * step;
                    const q2 = pr.at((((p[0] + du) % 1) + 1) % 1, p[1] + dv); if (!q2) return;
                    let ex = q2[0] - q[0], ey = q2[1] - q[1]; const l = Math.hypot(ex, ey); if (!(l > 0) || l > 60) return;
                    ex /= l; ey /= l; last = q;
                    arrow(ctx, q[0] + ey * 6, q[1] - ex * 6, ex, ey, 6 + Math.min(10, 22 * sp));
                });
            }
        }
        // (the names: the kingdoms' first, over their capitals, then the towns' by importance, none over another)
        const fits = (b) => { for (const o of placed) if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return false; placed.push(b); return true; };
        const later = [];
        this.labelBoxes = [];
        const label = (text, x, y, font, fill, align = 'left', tag = null) => {
            ctx.font = font;
            const w = ctx.measureText(text).width, h = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)[1]);
            const x0 = align === 'center' ? x - w / 2 : x, b = [x0 - 2, y - h / 2 - 1, x0 + w + 2, y + h / 2 + 1];
            if (!fits(b)) return;
            if (tag) this.labelBoxes.push({ ...tag, box: b });
            later.push([text, x, y, font, fill, align]);
        };
        const pos = d.cities.map((c, i) => { const u = dr && dr.i === i ? dr.u : c.u, v = dr && dr.i === i ? dr.v : c.v; return pr.at(u, v); });
        this.screenPos = pos;
        if (sh.names && sh.fills) for (let i = 0; i < d.cities.length; i++) {
            const c = d.cities[i], q = pos[i]; if (!c.capital || !q) continue;
            label((this.names.kingdoms[c.kingdom] ?? '').toUpperCase(), q[0], q[1] - 22, "600 15px Georgia, 'Times New Roman', serif", kcol(c.kingdom, 1), 'center', { kind: 'k', i: c.kingdom });
        }
        const order = d.cities.map((_, i) => i).sort((a, b) => (d.cities[b].capital - d.cities[a].capital) || (d.cities[b].people - d.cities[a].people));
        for (const i of [...order].reverse()) {
            const c = d.cities[i], q = pos[i]; if (!q) continue;
            const [x, y] = q, r = c.capital ? 7 : 2.5 + Math.min(2.5, Math.max(0, Math.log10(Math.max(1, c.people)) - 3));
            ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(40,25,15,0.95)'; ctx.fillStyle = c.capital ? kcol(c.kingdom) : 'rgba(250,242,222,1)';
            if (c.capital) { star(ctx, x, y, r); ctx.fill(); ctx.stroke(); } else { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); }
            if (c.port) { ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.strokeStyle = 'rgba(25,45,95,0.95)'; ctx.stroke(); }
            if (dr && dr.i === i) { ctx.beginPath(); ctx.arc(x, y, r + 6, 0, 2 * Math.PI); ctx.strokeStyle = 'rgba(158,43,37,0.9)'; ctx.lineWidth = 2; ctx.stroke(); }
            placed.push([x - r, y - r, x + r, y + r]);
        }
        if (sh.names) for (const i of order) {
            const c = d.cities[i], q = pos[i]; if (!q) continue;
            label(this.names.cities[i] ?? '', q[0] + (c.capital ? 7 : 4) + 4, q[1], `${c.capital ? '600 13px' : c.people >= 15000 ? '12px' : '11px'} Georgia, 'Times New Roman', serif`, 'rgba(40,25,15,1)', 'left', { kind: 'c', i });
        }
        for (const [text, x, y, font, fill, align] of later) {
            ctx.font = font; ctx.textAlign = align; ctx.textBaseline = 'middle';
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(250,242,222,0.9)'; ctx.strokeText(text, x, y);
            ctx.fillStyle = fill; ctx.fillText(text, x, y);
        }
    }
    /** The routes as runs by land, by river, by water — each smoothed (cached per realm). */
    routeRuns() {
        const d = this.data;
        if (this.runsFor === d) return this.runs;
        const kind = (r) => { const A = d.cities[r.a], B = d.cities[r.b]; return A?.capital && B?.capital ? 'major' : (A?.capital || B?.capital) && A?.kingdom === B?.kingdom ? 'road' : 'trail'; };
        this.runs = [];
        for (const r of d.routes) {
            let start = 0;
            for (let i = 1; i <= r.modes.length; i++) {
                if (i === r.modes.length || r.modes[i] !== r.modes[start]) {
                    const pts = r.path.slice(start, i + 1);
                    if (pts.length >= 2) this.runs.push({ mode: r.modes[start], kind: kind(r), pts: smooth(unwrap(pts), 2), raw: pts, cur: r.cur ? r.cur.slice(start, i + 1) : null });
                    start = i;
                }
            }
        }
        this.runsFor = d;
        return this.runs;
    }

    // ── the export's maps ──
    static ROWS = [
        { id: 'dndPolitical', label: 'Mappa politica (per il DM)', colour: true, tip: 'La mappa a colori con regni, confini, città, sentieri e nomi' },
        { id: 'dndPlayers', label: 'Mappa per i giocatori', colour: true, tip: 'La mappa a colori con città, sentieri e nomi, senza regni né confini' },
        { id: 'dndBlank', label: 'Mappa per i giocatori, senza nomi', colour: true, tip: 'Città e sentieri senza nomi: da completare al tavolo, o per gli enigmi' },
        { id: 'dndOverlay', label: 'Regni, città e sentieri (trasparente)', colour: true, tip: 'Solo i regni, i confini, le città e i sentieri su fondo trasparente, da sovrapporre a un’altra mappa' },
    ];
    /** An export row of the realm's (or null: not one of them). */
    produce(rctx, job) {
        const id = job.row.id;
        if (!id.startsWith('dnd') || !this.data) return null;
        const W = rctx.W, H = W >> 1, shift = rollShift(W, rctx.look.centerLon);
        const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext('2d');
        if (id !== 'dndOverlay') { const base = colorMap(rctx.fin, W, rctx.look); ctx.putImageData(new ImageData(base.data, W, H), 0, 0); }
        const o = { dndPolitical: { fills: true, borders: true, routes: true, names: true }, dndPlayers: { fills: false, borders: false, routes: true, names: true },
            dndBlank: { fills: false, borders: false, routes: true, names: false }, dndOverlay: { fills: true, borders: true, routes: true, names: true } }[id];
        const keep = this.show; this.show = { ...this.show, fills: o.fills };
        this.paint(ctx, W, o, shift);
        this.show = keep;
        return { kind: 'rgba', W, H, data: ctx.getImageData(0, 0, W, H).data };
    }
}

// ── helpers ──
/** The world's land per realm cell (for the borders: none drawn along the coasts). */
function maskOf(fin) {
    const R = fin.raster, m = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        const i = Math.min(R.h - 1, Math.floor((y + 0.5) / GH * R.h)) * R.w + Math.min(R.w - 1, Math.floor((x + 0.5) / GW * R.w));
        m[y * GW + x] = !R.ocean[i] && !R.water?.[i] ? 1 : 0;
    }
    return m;
}
/** Points [u, v] made continuous across the map's edge (u may leave 0…1). */
function unwrap(pts) {
    const out = [pts[0].slice()];
    for (let i = 1; i < pts.length; i++) {
        let u = pts[i][0];
        const pu = out[i - 1][0];
        while (u - pu > 0.5) u -= 1;
        while (pu - u > 0.5) u += 1;
        out.push([u, pts[i][1]]);
    }
    return out;
}
/** Chaikin's corner cutting, `it` times (the ends kept). */
function smooth(pts, it) {
    let p = pts;
    for (let k = 0; k < it; k++) {
        if (p.length < 3) return p;
        const q = [p[0]];
        for (let i = 0; i < p.length - 1; i++) {
            const a = p[i], b = p[i + 1];
            q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
        }
        q.push(p[p.length - 1]);
        p = q;
    }
    return p;
}
/** A polyline of [u, v] on a W × H texture, drawn again one map-width over where it leaves the map. */
function strokeWrapped(ctx, pts, W, H) {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); }
    for (const off of [0, lo < 0 ? 1 : hi > 1 ? -1 : null]) {
        if (off === null) continue;
        pts.forEach((p, i) => { const x = (p[0] + off) * W, y = p[1] * H; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    }
}
/** A small arrow from (x, y) along the unit (ex, ey), `len` long. */
function arrow(ctx, x, y, ex, ey, len) {
    const x1 = x + ex * len, y1 = y + ey * len, h = Math.min(5, len * 0.45), a = Math.atan2(ey, ex);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - h * Math.cos(a - 0.5), y1 - h * Math.sin(a - 0.5)); ctx.lineTo(x1 - h * Math.cos(a + 0.5), y1 - h * Math.sin(a + 0.5)); ctx.closePath(); ctx.fill();
}
function star(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); }
    ctx.closePath();
}
