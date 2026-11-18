// D&D fork — the realm on Generate's page: the "Regni e città" section, the Politica view's drawing (kingdoms, borders,
// cities, routes), moving cities by hand, the kingdoms' summaries, the hover lines, the export's maps, and the realm kept
// in the browser per planet code. The work itself is realm-worker.js's; the grid it works on, realm-data.js's.

import { realmGrid, GW, GH, KOPPEN_CODES } from './realm-data.js';
import { colorMap, rollShift } from '../../v2/js/evolution/export.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
/** Great-circle km between two cities ({u, v}). */
const distKm = (a, b) => { if (!a || !b) return 0; const la1 = (0.5 - a.v) * Math.PI, la2 = (0.5 - b.v) * Math.PI, dl = (a.u - b.u) * 2 * Math.PI; return 6371 * Math.acos(Math.max(-1, Math.min(1, Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dl)))); };
const fmt = (n) => Math.round(n).toLocaleString('en-GB');

export const KINGDOM_RGB = [[181, 82, 59], [59, 111, 181], [78, 154, 74], [193, 154, 46], [122, 79, 160], [46, 154, 150], [181, 115, 154], [138, 106, 59],
    [90, 122, 46], [181, 138, 90], [59, 79, 138], [154, 46, 79], [106, 154, 181], [160, 160, 59], [96, 96, 96], [196, 122, 46]];
// (each kingdom's colour: the one chosen for it, or the palette's)
let CHOSEN = [];
const hexRgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const krgb = (k) => (/^#[0-9a-f]{6}$/i.test(CHOSEN[k] ?? '') ? hexRgb(CHOSEN[k]) : KINGDOM_RGB[k % KINGDOM_RGB.length]);
const khex = (k) => '#' + krgb(k).map(v => v.toString(16).padStart(2, '0')).join('');
const kcol = (k, a = 1) => { const c = krgb(k); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
/** Where a kingdom's people like to live (realm-worker.js wishes): its capital stands where the most of these hold. */
const WISHES = [
    ['climate', 'Climate', [['', 'Any climate'], ['tropical', 'Tropical'], ['desert', 'Desert'], ['steppe', 'Steppe'], ['mediterranean', 'Mediterranean'],
        ['temperate', 'Temperate (humid)'], ['continental', 'Continental'], ['taiga', 'Taiga'], ['tundra', 'Tundra']]],
    ['temp', 'Temperature', [['', 'Any'], ['hot', 'Hot (over 20 °C)'], ['warm', 'Warm (13–22 °C)'], ['mild', 'Mild (7–15 °C)'], ['cool', 'Cool (0–9 °C)'], ['cold', 'Cold (under 2 °C)']]],
    ['rain', 'Humidity', [['', 'Any'], ['arid', 'Arid (under 250 mm)'], ['dry', 'Dry (250–600 mm)'], ['moderate', 'Moderate (600–1200 mm)'], ['wet', 'Wet (over 1200 mm)']]],
    ['sea', 'Sea', [['', 'Any'], ['coast', 'Maritime, on the coast'], ['inland', 'Inland']]],
    ['height', 'Height', [['', 'Any'], ['low', 'Lowlands (under 300 m)'], ['hills', 'Hills (250–1000 m)'], ['high', 'Highlands (over 900 m)']]],
    ['mountains', 'Mountains', [['', 'Any'], ['near', 'Near high mountains'], ['far', 'Far from mountains']]],
    ['river', 'River', [['', 'Any'], ['yes', 'On a big river']]],
    ['waters', 'Seas', [['', 'Any'], ['calm', 'Calm seas'], ['rough', 'Rough, stormy seas']]],
    ['currents', 'Currents', [['', 'Any'], ['strong', 'Strong sea currents'], ['weak', 'Weak sea currents']]],
    ['fertility', 'Fertility', [['', 'Any'], ['high', 'Very fertile land'], ['low', 'Poor land']]],
    ['hold', 'Holds the sources', [['', 'None'], ['gems', 'Gems'], ['iron', 'Iron'], ['copper', 'Copper'], ['tin', 'Tin'], ['silver', 'Silver'], ['gold', 'Gold'], ['salt', 'Salt'], ['coal', 'Coal']]],
    ['ore', 'Riches', [['', 'Any'], ['gems', 'Main gem mines'], ['iron', 'Main iron mines'], ['copper', 'Main copper mines'], ['tin', 'Main tin mines'], ['silver', 'Main silver mines'], ['gold', 'Main gold mines'], ['salt', 'Main salt'], ['coal', 'Main coal']]],
];
/** A kingdom's wishes in a line — its conditions marked "must". */
const HOLD_NAMES = { gems: 'Gems', iron: 'Iron', copper: 'Copper', tin: 'Tin', silver: 'Silver', gold: 'Gold', salt: 'Salt', coal: 'Coal' };
const wishText = (p, names = []) => [...WISHES.map(([key, , opts]) => (p?.[key] ? [key, opts.find(o => o[0] === p[key])?.[1].replace(/ \(.*\)$/, '')] : null)),
    p?.near !== undefined && p?.near !== '' && names[+p.near] ? ['near', `near ${names[+p.near]}`] : null]
    .filter(Boolean).map(([key, t]) => (key === 'hold' ? [key, `holds the ${t.toLowerCase()} sources`] : [key, t])).map(([key, t]) => (p.req?.[key] ? `must: ${t}` : t)).join(' · ');

const LIFE_IT = ['Uninhabited', 'Farming', 'Herding', 'Hunting, fishing and gathering'];
const STAPLE_IT = ['Nothing', 'Paddy grain (rice)', 'Cool-climate grain (wheat, barley, rye)', 'Warm-climate grain (maize, millet, sorghum)', 'Roots and tubers', 'Livestock (milk, meat, wool)', 'Fish', 'Game and wild fruit'];
const CLIMATE_IT = { A: 'Tropical', B: 'Arid', C: 'Temperate', D: 'Continental', E: 'Polar' };
const rank = (p, capital) => (capital ? 'Capital' : p >= 50000 ? 'Metropolis' : p >= 15000 ? 'City' : p >= 4000 ? 'Town' : 'Village');

export class Realm {
    /** `pv`: the planet view; `onChange()`: repaint; `getCode()`: the planet code (the realm kept per code). */
    constructor({ pv, onChange, getCode }) {
        this.pv = pv; this.onChange = onChange; this.getCode = getCode;
        this.world = null; this.data = null; this.version = 0; this.busy = false; this.ready = false; this.reqId = 0;
        this.names = { kingdoms: [], cities: [], colors: [], prefs: [] };
        // (the kingdoms only coloured: never a border line)
        this.show = { fills: true, borders: false, routes: true, names: true };
        this.editing = false; this.drag = null;
        // (on or off over any base map: the composer's Politica switch — composer.js draws it on screen)
        this.enabled = true; this.screenPos = []; this.labelBoxes = [];
        this.openK = new Set();                        // (the kingdoms opened in the list: none at first)
        this.worker = new Worker(new URL('./realm-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }) => this.received(data);
        this.worker.onerror = (e) => this.status(`Error working out the kingdoms: ${e.message}`);
        this.wire();
        // (a campaign's kingdoms from the address: ?realm=… — base64url JSON { cities, kingdoms: [{ name, color, climate, cities: [names] }] })
        try { const r = new URLSearchParams(location.search).get('realm'); if (r) this.preset = JSON.parse(decodeURIComponent(escape(atob(r.replace(/-/g, '+').replace(/_/g, '/'))))); } catch (err) { console.warn('[realm] unreadable preset', err); }
        if (this.preset?.world?.maxLat) { this.presetMaxLat = this.preset.world.maxLat; try { localStorage.setItem('dnd.maxLat', String(this.presetMaxLat)); } catch { /* */ } }
        // (else the campaign last set up: its peoples kept from world to world, and from visit to visit)
        if (!this.preset) {
            let c = null; try { c = JSON.parse(localStorage.getItem('dnd-campaign') || 'null'); } catch { /* */ }
            if (c?.kingdoms?.length) {
                this.names = { kingdoms: c.kingdoms, colors: c.colors || [], prefs: c.prefs || [], ncap: c.ncap || [], towns: c.towns || [], cities: [] };
                $('sRealmK').value = String(c.kingdoms.length); $('sRealmK').dispatchEvent(new Event('input'));
                if (c.N) { $('sRealmN').value = String(c.N); $('sRealmN').dispatchEvent(new Event('input')); }
            }
        }
    }
    /** The campaign's peoples — names, colours, wishes, towns' names, how many cities — kept for every world to come. */
    saveCampaign() {
        const n = this.names;
        try { localStorage.setItem('dnd-campaign', JSON.stringify({ kingdoms: n.kingdoms, colors: n.colors, prefs: n.prefs, ncap: n.ncap, towns: n.towns || [], N: +$('sRealmN').value })); } catch { /* */ }
    }
    /** The map's centre turned to the land (a new world's continents in the middle of the map). */
    centreOnLand() {
        const o = this.data?.owner; if (!o) return;
        let sx = 0, sy = 0;
        for (let c = 0; c < o.length; c++) if (o[c] >= 0) { const a = ((c % GW) + 0.5) / GW * 2 * Math.PI - Math.PI; sx += Math.cos(a); sy += Math.sin(a); }
        if (!sx && !sy) return;
        const sl = $('sMapCenterLon'); if (!sl) return;
        sl.value = String(Math.round(Math.atan2(sy, sx) * 180 / Math.PI));
        sl.dispatchEvent(new Event('input')); sl.dispatchEvent(new Event('change'));
    }
    /** The preset's kingdoms set (their names, colours, climates and towns' names), and the address cleared of it. */
    applyPreset(p) {
        const K = Math.min(16, Math.max(1, p.kingdoms?.length || 1));
        $('sRealmK').value = String(K); $('sRealmK').dispatchEvent(new Event('input'));
        if (p.cities) { $('sRealmN').value = String(Math.max(K, p.cities)); $('sRealmN').dispatchEvent(new Event('input')); }
        const ks = p.kingdoms.slice(0, K);
        this.names = { kingdoms: ks.map(k => k.name || ''), colors: ks.map(k => k.color || ''), prefs: ks.map(k => ({ ...(k.climate ? { climate: k.climate } : {}), ...(k.prefs || {}) })), ncap: ks.map(k => k.capitals || 1), towns: ks.map(k => k.cities || []), cities: [] };
        this.preset = null;
        const q = new URLSearchParams(location.search); q.delete('realm');
        history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
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
        for (const [id, key] of [['chkRealmRoutes', 'routes'], ['chkRealmNames', 'names']]) {
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
            if (t.dataset.kcol !== undefined) { this.setColor(+t.dataset.kcol, t.value); this.save(); this.renderList(); }
            // (a climate chosen: the kingdoms placed again, each in its own)
            if (t.dataset.kcap !== undefined) { this.names.ncap[+t.dataset.kcap] = +t.value; this.seatsFromCounts(); this.markSeats(); this.changed(); this.save(); }
            if (t.dataset.kreq !== undefined) { const p = this.names.prefs[+t.dataset.kreq]; p.req ||= {}; if (t.checked) p.req[t.dataset.key] = true; else delete p.req[t.dataset.key]; this.save(); this.auto(); }
            if (t.dataset.kpref !== undefined) { const p = this.names.prefs[+t.dataset.kpref]; if (t.value) p[t.dataset.key] = t.value; else delete p[t.dataset.key]; this.save(); this.auto(); }
        });
        list.addEventListener('input', (e) => { if (e.target.dataset.kcol !== undefined) this.setColor(+e.target.dataset.kcol, e.target.value); });
        list.addEventListener('click', (e) => {
            const f = e.target.closest('button[data-fold]');
            if (f) { const k = +f.dataset.fold; if (this.openK.has(k)) this.openK.delete(k); else this.openK.add(k); this.renderList(); return; }
            const b = e.target.closest('button[data-act]');
            if (!b || !this.data) return;
            const i = +b.dataset.i, cities = this.data.cities;
            // (★: one more capital for its kingdom, or one less — the kingdom's first capital stays)
            if (b.dataset.act === 'capital' && !cities[i].capital) { const s = this.names.seats ||= []; s[i] = !s[i]; this.names.ncap[cities[i].kingdom] = 1 + cities.filter((c, j) => c.kingdom === cities[i].kingdom && !c.capital && s[j]).length; this.markSeats(); this.changed(); this.save(); }
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
        box.innerHTML = `<label>${hit.kind === 'k' ? 'Kingdom name' : 'City name'}</label><input type="text" value="${esc(names[hit.i] ?? '')}" spellcheck="false">`;
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

    setColor(k, hex) { this.names.colors[k] = hex; CHOSEN = this.names.colors; this.fillFor = null; this.changed(false); }
    /** The kingdoms' own choices (name, colour, climate), as many as there are kingdoms. */
    fitNames(K) {
        const n = this.names;
        n.colors = Array.from({ length: K }, (_, k) => n.colors?.[k] || '');
        // (older saves kept a climate alone)
        n.prefs = Array.from({ length: K }, (_, k) => n.prefs?.[k] || (n.climates?.[k] ? { climate: n.climates[k] === 'highlands' ? '' : n.climates[k], ...(n.climates[k] === 'highlands' ? { height: 'high' } : {}) } : {}));
        delete n.climates;
        n.kingdoms = Array.from({ length: K }, (_, k) => n.kingdoms?.[k] || `Kingdom ${k + 1}`);
        n.ncap = Array.from({ length: K }, (_, k) => n.ncap?.[k] || 1);
        CHOSEN = n.colors; this.fillFor = null;
    }
    status(text) { const el = $('realmStatus'); if (el) { el.textContent = text || ''; el.hidden = !text; } }
    changed(recount = true) { this.version++; this.onChange(); if (recount) this.renderList(); }

    /** The key the overlay is drawn again for. */
    key(view) { return `${this.enabled}|${this.version}|${this.drag ? `${this.drag.u.toFixed(4)},${this.drag.v.toFixed(4)}` : ''}`; }

    // ── a world: its grid read, the realm worked out (or the one kept for its code) ──
    clear() { this.world = null; this.data = null; this.ready = false; this.changed(); this.status('The kingdoms come once the planet is finished (climate, rivers and food)…'); }
    setWorld(w) {
        if (!w?.fin) return;
        this.world = w; this.data = null; this.ready = false; this.landMask = null; this.recentre = true;
        this.status('Reading the land, the climate and the food…');
        // (a moment for the status to show before the grid's work holds the page)
        setTimeout(() => {
            if (this.world !== w) return;
            let grid;
            try { grid = realmGrid(w.fin); } catch (err) { console.error(err); this.status(`Could not read the planet: ${err.message}`); return; }
            this.worker.postMessage({ cmd: 'init', grid: { ...grid, codes: KOPPEN_CODES } });
            const kept = this.load();
            if (this.preset) { this.applyPreset(this.preset); this.auto(); }
            else if (kept?.cities?.length) { this.names = kept.names ?? this.names; this.fitNames(kept.names?.kingdoms?.length || 1); this.request({ cmd: 'fixed', prefs: this.names.prefs, cities: kept.cities }); }
            else this.auto();
        }, 30);
    }
    auto() {
        if (!this.world?.fin) return;
        // (the kingdoms keep their names, colours and climates; the cities are placed anew)
        const K = +$('sRealmK').value;
        this.names.cities = [];
        this.fitNames(K);
        this.request({ cmd: 'auto', K, N: +$('sRealmN').value, prefs: this.names.prefs, mins: this.names.kingdoms.map((_, k) => Math.max(0, (this.names.towns?.[k]?.length || 0) - 1, (this.names.ncap?.[k] || 1) - 1)),
            ports: this.names.kingdoms.map((_, k) => (this.names.towns?.[k] || []).filter(t => t && typeof t === 'object' && t.port).length) });
        this.named = false;                            // (the towns' names, if any, given to the new cities)
    }
    /** The realm again from the cities as they stand (moved, added, removed, a capital changed). */
    fixed() {
        if (!this.data) return;
        this.request({ cmd: 'fixed', prefs: this.names.prefs, cities: this.data.cities.map(c => ({ u: c.u, v: c.v, capital: c.capital })) });
    }
    request(msg) {
        this.busy = true; msg.id = ++this.reqId;
        this.status(msg.cmd === 'auto' ? 'Placing kingdoms and cities, tracing the routes…' : 'Working out the borders and routes again…');
        this.worker.postMessage(msg);
    }
    received(m) {
        if (m.type === 'ready') return;
        if (m.id !== this.reqId) return;
        this.busy = false;
        if (m.type === 'error') { console.error(m.message); this.status(`Error: ${m.message.split('\n')[0]}`); return; }
        this.data = m; this.ready = true;
        // (names: a kingdom by its index, a city by its place in the list — kept as they were where they still exist)
        this.fitNames(m.K);
        if (this.named === false) this.seatsFromCounts(m);
        if (this.named === false && this.names.towns?.length) {
            // (the towns' names: the capital's first, then the other capitals', then by size — save for a town described,
            // { name, port, small }, given the town that fits it best, the nearest the capital)
            this.names.cities = [];
            const seats = this.names.seats || [];
            for (let k = 0; k < m.K; k++) {
                const own = m.cities.map((c, i) => [c, i]).filter(([c]) => c.kingdom === k).sort((a, b) => (b[0].capital - a[0].capital) || (!!seats[b[1]] - !!seats[a[1]]) || (b[0].people - a[0].people));
                const cap = own[0]?.[0], used = new Set(), list = this.names.towns[k] || [];
                list.forEach((t) => {
                    if (!t || typeof t !== 'object') return;
                    const fit = own.filter(([c, i]) => !c.capital && !seats[i] && !used.has(i) && (!t.port || c.port));
                    const pool = fit.length ? fit : own.filter(([c, i]) => !c.capital && !seats[i] && !used.has(i));
                    pool.sort((a, b) => (t.small ? (a[0].people - b[0].people) / 20000 : 0) + (distKm(a[0], cap) - distKm(b[0], cap)) / 300);
                    if (pool[0]) { used.add(pool[0][1]); this.names.cities[pool[0][1]] = t.name; }
                });
                let j = 0;
                list.forEach((t) => {
                    if (!t || typeof t === 'object') return;
                    while (j < own.length && used.has(own[j][1])) j++;
                    if (own[j]) { used.add(own[j][1]); this.names.cities[own[j][1]] = t; }
                });
            }
        }
        if (!Array.isArray(this.names.seats)) this.seatsFromCounts(m);
        this.markSeats();
        this.named = true;
        if (this.recentre) { this.recentre = false; this.centreOnLand(); }
        this.names.cities = m.cities.map((c, i) => this.names.cities[i] || (c.capital ? `Capital ${this.romanOf(c.kingdom)}` : `City ${i + 1}`));
        const unmet = (m.unmet || []).map(k => this.names.kingdoms[k]).filter(Boolean);
        this.status(`${m.K} kingdoms, ${m.cities.length} cities, ${m.routes.length} links · ${(m.ms / 1000).toFixed(1)} s${unmet.length ? ` · No place on this world meets every condition of ${unmet.join(', ')}` : ''}`);
        this.drawCache = null;
        this.changed();
        this.save();
    }
    /** Each kingdom's other capitals: its biggest towns after the capital, as many as it has capitals. */
    seatsFromCounts(m = this.data) {
        const seats = [];
        for (let k = 0; k < m.K; k++) {
            // (its other capitals: big towns, and near the first — allied seats, not the far ends of the kingdom)
            const cap = m.cities.find(c => c.capital && c.kingdom === k);
            const own = m.cities.map((c, i) => [c, i]).filter(([c]) => c.kingdom === k && !c.capital).sort((a, b) => b[0].people / (1 + distKm(b[0], cap) / 400) - a[0].people / (1 + distKm(a[0], cap) / 400));
            // (a kingdom with a port town described keeps its ports for it, where it has other towns to crown)
            const keepPorts = (this.names.towns?.[k] || []).some(t => t && typeof t === 'object' && t.port);
            const pick = keepPorts && own.filter(([c]) => !c.port).length >= (this.names.ncap?.[k] || 1) - 1 ? own.filter(([c]) => !c.port) : own;
            for (let j = 0; j < (this.names.ncap?.[k] || 1) - 1 && j < pick.length; j++) seats[pick[j][1]] = true;
        }
        this.names.seats = seats;
    }
    /** A kingdom's colour, as CSS. */
    colorOf(k) { return kcol(k); }
    /** A city crowned: the kingdom's capital, or one of its other capitals. */
    markSeats() { this.data?.cities.forEach((c, i) => { c.seat = !c.capital && !!this.names.seats?.[i]; c.crown = c.capital || c.seat; }); this.runsFor = null; }
    romanOf(k) { const r = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI']; return r[k] ?? String(k + 1); }
    removeCity(i) { this.data.cities.splice(i, 1); this.names.cities.splice(i, 1); }

    // ── kept in the browser, per planet code ──
    storeKey() { const c = this.getCode(); return c ? `dnd-realm:${c}` : null; }
    save() {
        this.saveCampaign();
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
            const ss = K.selfSufficiency, ssWord = ss >= 1.3 ? 'self-sufficient, with a surplus' : ss >= 1 ? 'self-sufficient, only just' : 'not self-sufficient: relies on its neighbours';
            const ssNum = ss.toLocaleString('en-GB', { maximumFractionDigits: 1 });
            const towns = d.cities.map((c, i) => [c, i]).filter(([c]) => c.kingdom === k).sort((a, b) => (b[0].capital - a[0].capital) || (b[0].people - a[0].people));
            const links = (i) => d.routes.filter(r => r.a === i || r.b === i).map(r => { const o = r.a === i ? r.b : r.a; const by = r.modes.some(m => m === 2) ? 'by sea' : r.modes.some(m => m === 1) ? 'by river' : 'on foot'; return `${esc(this.names.cities[o] ?? '')} ${r.days.toFixed(0)} d ${by}`; }).join(' · ');
            const open = this.openK.has(k);
            return `<div class="realm-k${open ? ' open' : ''}">
                <div class="realm-k-head"><button type="button" class="realm-fold" data-fold="${k}" aria-expanded="${open}" aria-label="${open ? 'Close' : 'Open'} the kingdom">${open ? '▾' : '▸'}</button><input type="color" class="realm-color" data-kcol="${k}" value="${khex(k)}" title="The kingdom's colour" aria-label="Kingdom colour"><input class="realm-name" data-kname="${k}" value="${esc(this.names.kingdoms[k])}" aria-label="Kingdom name"></div>
                <div class="realm-wish-sum">${esc(wishText(this.names.prefs[k], this.names.kingdoms)) || 'Anywhere'}</div>
                ${open ? `<div class="realm-wishes" title="Where its people like to live: the capital stands where the most of these hold, and the kingdoms are placed again on each change"><label>Capitals<select class="realm-clim" data-kcap="${k}" title="How many capitals: the first, then its biggest towns">${[1, 2, 3, 4].map(v => `<option value="${v}"${(this.names.ncap?.[k] || 1) === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label><span></span><span></span><span></span><span class="realm-must-head" title="Ticked: a condition, which must hold. Unticked: a preference, met where it can be">Must</span>${[...WISHES, ['near', 'Near', [['', 'Any'], ...this.names.kingdoms.map((n, j) => [String(j), n]).filter(([j]) => +j !== k)]]].map(([key, label, opts]) => `<label>${label}<select class="realm-clim" data-kpref="${k}" data-key="${key}">${opts.map(([v, l]) => `<option value="${v}"${String(this.names.prefs[k]?.[key] ?? '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label><input type="checkbox" class="realm-must" data-kreq="${k}" data-key="${key}" title="A condition: it must hold"${this.names.prefs[k]?.req?.[key] ? ' checked' : ''}>`).join('')}</div>
                <div class="realm-facts">
                    <div><b>Cities</b> ${K.cities} · <b>Estimated population</b> ${fmt(K.people)} · <b>Area</b> ${fmt(K.area)} km² · <b>Ports</b> ${K.ports}</div>
                    <div><b>Food</b> ${ssWord}: its land could feed ~${fmt(K.food)} people, ${ssNum} times its population</div>
                    <div><b>How it eats</b> ${lives || '—'}</div>
                    ${Object.keys(K.holds || {}).length ? `<div><b>Sources held</b> ${Object.entries(K.holds).sort((a, b) => b[1] - a[1]).map(([id, v]) => `${HOLD_NAMES[id] ?? id} ${pct(v, 1)}%`).join(' · ')}</div>` : ''}
                    <div><b>Staple foods</b> ${staples || '—'}</div>
                    <div><b>Climate</b> ${climate || '—'}</div>
                    <div><b>Land</b> mountains ${pct(K.mountains, K.area)}% · coast ~${fmt(K.coastKm)} km · navigable rivers ~${fmt(K.navigable)} km${K.wild > 0 ? ` · barren ${pct(K.wild, K.area)}%` : ''}</div>
                </div>
                <ul class="realm-cities">${towns.map(([c, i]) => `<li>
                    <button type="button" data-act="capital" data-i="${i}" class="realm-cap${c.crown ? ' on' : ''}" title="${c.capital ? 'The kingdom’s first capital' : c.seat ? 'A capital (click: no longer one)' : 'Make it one of the kingdom’s capitals'}">★</button>
                    <input class="realm-name" data-cname="${i}" value="${esc(this.names.cities[i] ?? '')}" aria-label="City name">
                    <span class="realm-meta">${rank(c.people, c.crown)} · ${fmt(c.people)} people${c.port ? ' · port' : ''}${c.river ? ' · river' : ''}</span>
                    <button type="button" data-act="remove" data-i="${i}" class="realm-del" title="Remove the city">×</button>
                    <div class="realm-links">${links(i)}</div></li>`).join('')}</ul>` : ''}
            </div>`;
        }).join('');
    }

    // ── moving cities by hand ──
    setEditing(on) {
        this.editing = on;
        $('realmEdit').classList.toggle('active', on);
        $('realmEdit').textContent = on ? 'Done editing' : 'Edit cities';
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
            this.names.cities.push(`City ${this.data.cities.length}`);
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
            out.push(`<span class="hi-label">${rank(c.people, c.crown)}</span> <b>${esc(this.names.cities[i])}</b> · ${fmt(c.people)} people${c.port ? ' · port' : ''}${c.river ? ' · on a river' : ''}`);
        }
        if (out.length) out.push('<span class="hi-label">Double-click to rename</span>');
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
                const col = krgb(k);
                px[4 * c] = col[0]; px[4 * c + 1] = col[1]; px[4 * c + 2] = col[2]; px[4 * c + 3] = 135;
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
        const kind = (r) => { const A = d.cities[r.a], B = d.cities[r.b]; return A?.crown && B?.crown ? 'major' : (A?.crown || B?.crown) && A?.kingdom === B?.kingdom ? 'road' : 'trail'; };
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        this.runs = this.routeRuns();
        // (as on screen: roads black, ways by water blue; main ones solid, the rest dashed; no halo, no arrows)
        for (const run of this.runs) {
            const main = run.kind === 'major', col = run.mode === 0 ? 'rgba(20,18,16,0.9)' : 'rgba(25,75,175,0.9)';
            ctx.lineWidth = (main ? 1.8 : 1.3) * s; ctx.strokeStyle = col; ctx.setLineDash(main ? [] : run.mode === 0 ? [5 * s, 3.5 * s] : [7 * s, 4 * s]);
            ctx.beginPath(); strokeWrapped(ctx, run.pts, W, H); ctx.stroke();
        }
        ctx.setLineDash([]);
    }
    paintCities(ctx, W, H, s, names) {
        const d = this.data, dr = this.drag;
        const order = d.cities.map((c, i) => i).sort((a, b) => d.cities[a].people - d.cities[b].people);
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        for (const i of order) {
            const c = d.cities[i], u = dr && dr.i === i ? dr.u : c.u, v = dr && dr.i === i ? dr.v : c.v;
            const x = u * W, y = v * H, big = c.crown, r = (big ? 5.5 : 2.4 + Math.min(2.6, Math.log10(Math.max(1000, c.people)) - 3)) * s;
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
        // (the routes, minimal: roads black — main ones solid, the rest dashed — and the ways by water blue, the same)
        if (sh.routes) {
            for (const r of this.routeRuns()) {
                const main = r.kind === 'major', col = r.mode === 0 ? 'rgba(20,18,16,0.9)' : 'rgba(25,75,175,0.9)';
                ctx.lineWidth = main ? 1.8 : 1.3; ctx.strokeStyle = col; ctx.setLineDash(main ? [] : r.mode === 0 ? [5, 3.5] : [7, 4]);
                ctx.beginPath(); line(r.pts); ctx.stroke();
            }
            ctx.setLineDash([]);
        }
        // (the names: the kingdoms' first, over their capitals, then the towns' by importance, none over another)
        const fits = (b) => { for (const o of placed) if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return false; placed.push(b); return true; };
        const later = [];
        this.labelBoxes = [];
        const boxOf = (text, x, y, font, align) => {
            ctx.font = font;
            const w = ctx.measureText(text).width, h = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)[1]);
            const x0 = align === 'center' ? x - w / 2 : x;
            return [x0 - 2, y - h / 2 - 1, x0 + w + 2, y + h / 2 + 1];
        };
        // (a tier of names, all or none: if one of those in view cannot be written clear of the rest, none of them is)
        const tier = (items) => {
            const mark = placed.length, boxes = [];
            for (const it of items) {
                const b = boxOf(it.text, it.x, it.y, it.font, it.align);
                if (!fits(b)) { placed.length = mark; return false; }
                boxes.push(b);
            }
            items.forEach((it, j) => { if (it.tag) this.labelBoxes.push({ ...it.tag, box: boxes[j] }); later.push([it.text, it.x, it.y, it.font, it.fill, it.align]); });
            return true;
        };
        const clip = pr.clip, inView = (q) => q && (!clip || (q[0] >= clip.left && q[0] <= clip.left + clip.width && q[1] >= clip.top && q[1] <= clip.top + clip.height));
        const pos = d.cities.map((c, i) => { const u = dr && dr.i === i ? dr.u : c.u, v = dr && dr.i === i ? dr.v : c.v; return pr.at(u, v); });
        this.screenPos = pos;
        // (the kingdoms' names over their capitals — or, where they do not all fit, in the legend)
        let inLegend = false;
        if (sh.names && sh.fills) {
            const ks = [];
            for (let i = 0; i < d.cities.length; i++) {
                const c = d.cities[i], q = pos[i]; if (!c.capital || !inView(q)) continue;
                ks.push({ text: (this.names.kingdoms[c.kingdom] ?? '').toUpperCase(), x: q[0], y: q[1] - 22, font: "600 15px Georgia, 'Times New Roman', serif", fill: kcol(c.kingdom, 1), align: 'center', tag: { kind: 'k', i: c.kingdom } });
            }
            inLegend = !tier(ks);
        }
        if (inLegend !== this.kingdomsInLegend) { this.kingdomsInLegend = inLegend; queueMicrotask(() => this.onLegend?.()); }
        const order = d.cities.map((_, i) => i).sort((a, b) => (d.cities[b].crown - d.cities[a].crown) || (d.cities[b].people - d.cities[a].people));
        for (const i of [...order].reverse()) {
            const c = d.cities[i], q = pos[i]; if (!q) continue;
            const [x, y] = q, r = c.crown ? (c.capital ? 7 : 6) : 2.5 + Math.min(2.5, Math.max(0, Math.log10(Math.max(1, c.people)) - 3));
            ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(40,25,15,0.95)'; ctx.fillStyle = c.crown ? kcol(c.kingdom) : 'rgba(250,242,222,1)';
            if (c.crown) { star(ctx, x, y, r); ctx.fill(); ctx.stroke(); } else { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); }
            if (c.port) { ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.strokeStyle = 'rgba(25,45,95,0.95)'; ctx.stroke(); }
            if (dr && dr.i === i) { ctx.beginPath(); ctx.arc(x, y, r + 6, 0, 2 * Math.PI); ctx.strokeStyle = 'rgba(158,43,37,0.9)'; ctx.lineWidth = 2; ctx.stroke(); }
            placed.push([x - r, y - r, x + r, y + r]);
        }
        // (then the capitals' names, all or none; and only if they all fit, the towns', all or none)
        if (sh.names) {
            const item = (i) => { const c = d.cities[i], q = pos[i]; return { text: this.names.cities[i] ?? '', x: q[0] + (c.crown ? 7 : 4) + 4, y: q[1], font: `${c.crown ? '600 13px' : c.people >= 15000 ? '12px' : '11px'} Georgia, 'Times New Roman', serif`, fill: 'rgba(40,25,15,1)', align: 'left', tag: { kind: 'c', i } }; };
            const seen = order.filter(i => inView(pos[i]));
            if (tier(seen.filter(i => d.cities[i].crown).map(item))) tier(seen.filter(i => !d.cities[i].crown).map(item));
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
        const kind = (r) => { const A = d.cities[r.a], B = d.cities[r.b]; return A?.crown && B?.crown ? 'major' : (A?.crown || B?.crown) && A?.kingdom === B?.kingdom ? 'road' : 'trail'; };
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
        { id: 'dndPolitical', label: 'Political map (for the DM)', colour: true, tip: 'The colour map with kingdoms, borders, cities, routes and names' },
        { id: 'dndPlayers', label: 'Players’ map', colour: true, tip: 'The colour map with cities, routes and names, without kingdoms or borders' },
        { id: 'dndBlank', label: 'Players’ map, unnamed', colour: true, tip: 'Cities and routes without names: to fill in at the table, or for puzzles' },
        { id: 'dndOverlay', label: 'Kingdoms, cities and routes (transparent)', colour: true, tip: 'Only the kingdoms, borders, cities and routes on a transparent background, to lay over another map' },
    ];
    /** An export row of the realm's (or null: not one of them). */
    produce(rctx, job) {
        const id = job.row.id;
        if (!id.startsWith('dnd') || !this.data) return null;
        const W = rctx.W, H = W >> 1, shift = rollShift(W, rctx.look.centerLon);
        const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext('2d');
        if (id !== 'dndOverlay') { const base = colorMap(rctx.fin, W, rctx.look); ctx.putImageData(new ImageData(base.data, W, H), 0, 0); }
        const o = { dndPolitical: { fills: true, borders: false, routes: true, names: true }, dndPlayers: { fills: false, borders: false, routes: true, names: true },
            dndBlank: { fills: false, borders: false, routes: true, names: false }, dndOverlay: { fills: true, borders: false, routes: true, names: true } }[id];
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
