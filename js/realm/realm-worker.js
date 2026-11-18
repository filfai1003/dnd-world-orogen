// D&D fork — kingdoms, cities and routes on a finished world, in a worker (realm.js asks, realm-data.js reads the grid).
//
// What the land allows, not what its peoples are: the cities go where food, fresh water and a harbour meet; the kingdoms
// grow out from their capitals across the land as far as travel allows, their borders falling on mountains, deserts and
// straits, each balanced to feed itself; the routes run where a traveller would go — roads round the ranges, boats down
// the great rivers and ships across the sea, with the winds and currents for or against them, and never through pack ice.
// Travel is reckoned in days: about 30 km a day on foot over open ground, 70 by river boat, 120 under sail.

let G = null;                 // the grid and what the worker works out from it once

const R_KM = 6371;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const WALK_KM_DAY = 30, RIVER_KM_DAY = 70, SAIL_KM_DAY = 120, LAKE_KM_DAY = 60;
const NAV_Q = 400;           // a river this big (m³/s) carries boats
const CROSS_Q = 150;         // a river this big must be bridged or forded
const EMBARK_DAYS = 0.5;     // a port: boarding or landing
const BEACH_DAYS = 3;        // boarding or landing on a shore with no port (D&D fork: no city cut off from the sea)
/** The ports (D&D fork): each port city's cell, and the shore within ~80 km of it — a city near the sea has its harbour
 *  on the coast nearest it. */
function portMap(cells) {
    const g = G, { GW, GH } = g, port = new Uint8Array(g.n);
    for (const c of cells) {
        port[c] = 1;
        const y = (c / GW) | 0, x = c - y * GW;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const yy = y + dy; if (yy < 0 || yy >= GH) continue;
            const d = yy * GW + ((x + dx + GW) % GW);
            if (g.coast[d] || g.lakeside[d]) port[d] = 1;
        }
    }
    return port;
}
// (D&D fork: a river boat — got where a navigable river is (built, bought), then carried along: downstream the current
// helps, upstream it holds back; on land between rivers the boat is carried, and the going is slower; left anywhere)
const BOAT_DAYS = 2;         // getting a boat at the river
const BOAT_KM_DAY = 75;      // on still water; × (1 + 0.5 × the current along) — about 110 downstream, 40 upstream
const PORTAGE = 2.2;         // walking with the boat: this many times slower

self.onmessage = ({ data: msg }) => {
    try {
        if (msg.cmd === 'init') { G = prepare(msg.grid); self.postMessage({ type: 'ready' }); return; }
        if (!G) throw new Error('no world');
        const t0 = performance.now();
        G.reqId = msg.id; G.ncap = msg.ncap || []; G.keepPorts = msg.keepPorts || []; G.seatsIn = msg.seats || null; G.edits = msg.edits || null;
        if (msg.cmd === 'link') { self.postMessage({ type: 'link', id: msg.id, route: linkRoute(msg.a, msg.b, msg.from, msg.to, msg.ports || []) }); return; }
        if (msg.cmd === 'trip') { self.postMessage({ type: 'trip', id: msg.id, a: msg.a, b: msg.b, options: tripOptions(msg.from, msg.to, msg.ports || []) }); return; }
        if (msg.cmd === 'fixed') { say(1); G.adapt = adaptOf(msg.prefs); G.prefs = msg.prefs || []; }
        const res = msg.cmd === 'auto' ? autoRealm(msg.K, msg.N, msg.prefs || [], msg.mins || [], msg.ports || []) : fixedRealm(msg.cities);
        res.ms = Math.round(performance.now() - t0);
        self.postMessage({ type: 'realm', id: msg.id, ...res }, [res.owner.buffer]);
    } catch (err) {
        self.postMessage({ type: 'error', id: msg.id, message: String(err?.stack || err) });
    }
};

// ── the grid, prepared: positions, cell sizes, costs per km, coasts, the open sea's distance from land ──
/** The realm's steps, said to the page as they go (D&D fork): `step` of `steps`, its label, and how far (0…1). */
const STEPS = ['Placing the capitals', 'Growing the kingdoms', 'Placing the cities', 'Counting the people and the food', 'Growing the main roads (slime network)', 'Growing the other roads (slime network)', 'Tracing the routes'];
let lastSaid = 0;
function say(step, frac = 0) {
    const now = performance.now();
    if (frac > 0 && frac < 1 && now - lastSaid < 120) return;
    lastSaid = now;
    self.postMessage({ type: 'progress', id: G?.reqId, step: step + 1, steps: STEPS.length, label: STEPS[step], frac });
}
function prepare(g) {
    const { GW, GH } = g, n = GW * GH, codes = g.codes;
    const xyz = new Float32Array(3 * n), dxKm = new Float32Array(GH), area = new Float32Array(n), dyKm = Math.PI * R_KM / GH;
    for (let y = 0; y < GH; y++) {
        const lat = (90 - (y + 0.5) / GH * 180) * Math.PI / 180, cl = Math.cos(lat), sl = Math.sin(lat);
        dxKm[y] = 2 * Math.PI * R_KM * cl / GW;
        for (let x = 0; x < GW; x++) {
            const lon = ((x + 0.5) / GW * 360 - 180) * Math.PI / 180, c = y * GW + x;
            xyz[3 * c] = cl * Math.cos(lon); xyz[3 * c + 1] = cl * Math.sin(lon); xyz[3 * c + 2] = sl;
            area[c] = dxKm[y] * dyKm;
        }
    }
    // (days a km over each land cell: the climate's ground, wetlands and height)
    const walk = new Float32Array(n), food = new Float32Array(n), ice = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
        if (!g.land[c]) continue;
        const code = codes[g.koppen[c]] || '';
        let f = 1;
        if (code === 'EF') { f = 15; ice[c] = 1; }
        else if (code === 'ET') f = 1.8;
        else if (code.startsWith('BW')) f = 2.2;
        else if (code.startsWith('BS')) f = 1.25;
        else if (code === 'Af') f = 2.4;
        else if (code === 'Am') f = 1.9;
        else if (/^D.[cd]$/.test(code)) f = 1.5;
        f *= 1 + 2 * g.wetland[c];
        const h = g.heightM[c];
        if (h > 2000) f *= 1 + (h - 2000) / 1200;
        if (g.peakM[c] > 4500) f *= 1.5;
        walk[c] = f / WALK_KM_DAY;
        food[c] = ice[c] ? 0 : g.people[c] * area[c];
    }
    // (the coasts: land beside the sea or a lake)
    const coast = new Uint8Array(n), lakeside = new Uint8Array(n);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        const c = y * GW + x;
        if (!g.land[c]) continue;
        for (const [dx, dy] of DIRS) {
            const yy = y + dy; if (yy < 0 || yy >= GH) continue;
            const d = yy * GW + ((x + dx + GW) % GW);
            if (!g.land[d]) { if (g.lake[d]) lakeside[c] = 1; else coast[c] = 1; }
        }
    }
    // (how far each water cell is from land, km — the open sea's risk)
    const landDist = new Float32Array(n).fill(Infinity), queue = new Int32Array(n);
    let qh = 0, qt = 0;
    for (let c = 0; c < n; c++) if (g.land[c]) { landDist[c] = 0; queue[qt++] = c; }
    while (qh < qt) {
        const c = queue[qh++], y = (c / GW) | 0, x = c - y * GW;
        for (let k = 0; k < 4; k++) {
            const yy = y + DIRS[k][1]; if (yy < 0 || yy >= GH) continue;
            const d = yy * GW + ((x + DIRS[k][0] + GW) % GW);
            if (landDist[d] !== Infinity) continue;
            landDist[d] = landDist[c] + (k < 2 ? dxKm[y] : dyKm); queue[qt++] = d;
        }
    }
    // (each cell's site score: the food within ~120 km, with a bonus for fresh water and a harbour)
    const hinter = blur(food, GW, GH, 3), site = new Float32Array(n);
    for (let c = 0; c < n; c++) {
        if (!g.land[c] || ice[c] || g.heightM[c] > 3500) continue;
        let s = hinter[c];
        if (!(s > 0) || !(food[c] > 0)) continue;
        if (g.riverQ[c] >= 100) s *= 1 + 0.5 * Math.min(1, 0.5 + Math.log10(g.riverQ[c] / 100));
        if (coast[c]) s *= 1.35;
        if (lakeside[c]) s *= 1.2;
        if (g.peakM[c] > 2500) s *= 0.5;
        site[c] = s;
    }
    // (each landmass and its area, km²: a kingdom's capital stands on one big enough to hold a kingdom)
    const comp = new Int32Array(n).fill(-1), compArea = [];
    for (let s0 = 0; s0 < n; s0++) {
        if (!g.land[s0] || comp[s0] >= 0) continue;
        const id = compArea.length; let a = 0; qh = 0; qt = 0; queue[qt++] = s0; comp[s0] = id;
        while (qh < qt) {
            const c = queue[qh++], y = (c / GW) | 0, x = c - y * GW; a += area[c];
            for (const [dx, dy] of DIRS) {
                const yy = y + dy; if (yy < 0 || yy >= GH) continue;
                const d = yy * GW + ((x + dx + GW) % GW);
                if (g.land[d] && comp[d] < 0) { comp[d] = id; queue[qt++] = d; }
            }
        }
        compArea.push(a);
    }
    // (D&D fork: what holds a kingdom back as it spreads — the natural frontiers its borders settle on: high ranges, deserts,
    // ice, and barren land that feeds no one; each multiplies the days a kingdom's reach takes to cross it)
    // (each by its kind, so that a people at home in it crosses it easily and holds it whole: the mountains, the desert, the
    // cold; the barren land that is none of these holds everyone back)
    const bMt = new Float32Array(n).fill(1), bDes = new Float32Array(n).fill(1), bCold = new Float32Array(n).fill(1), bBare = new Float32Array(n).fill(1);
    for (let c = 0; c < n; c++) {
        if (!g.land[c]) continue;
        const code = codes[g.koppen[c]] || '';
        if (g.peakM[c] >= 3000) bMt[c] = 6; else if (g.peakM[c] >= 2000) bMt[c] = 3.5; else if (g.heightM[c] >= 1500) bMt[c] = 2;
        if (code.startsWith('BW')) bDes[c] = 4; else if (code.startsWith('BS')) bDes[c] = 1.4;
        if (code === 'EF') bCold[c] = 8; else if (code === 'ET') bCold[c] = 2.5; else if (/^D.[cd]$/.test(code)) bCold[c] = 1.3;
        if (bMt[c] === 1 && bDes[c] <= 1.4 && bCold[c] <= 1.3) { if (g.people[c] < 0.05) bBare[c] = 3; else if (g.people[c] < 0.5) bBare[c] = 1.6; }
    }
    return { ...g, n, xyz, dxKm, dyKm, area, walk, food, ice, coast, bMt, bDes, bCold, bBare, adapt: [], lakeside, landDist, site, comp, compArea, heap: new Heap(n), dist: new Float32Array(n), from: new Int32Array(n), lab: new Int16Array(n) };
}

/** A box blur of `f` over `r` cells each way (wrapping east–west). */
function blur(f, W, H, r) {
    const a = new Float32Array(W * H), b = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += f[y * W + ((k + W) % W)];
        for (let x = 0; x < W; x++) { a[y * W + x] = s; s += f[y * W + ((x + r + 1) % W)] - f[y * W + ((x - r + W) % W)]; }
    }
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
        let s = 0;
        for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H) s += a[yy * W + x]; }
        b[y * W + x] = s;
    }
    return b;
}

// ── a binary heap of cells by cost ──
class Heap {
    constructor(n) { this.ids = new Int32Array(Math.max(16, n)); this.keys = new Float32Array(Math.max(16, n)); this.size = 0; }
    clear() { this.size = 0; }
    push(id, key) {
        if (this.size >= this.ids.length) { const ids = new Int32Array(this.ids.length * 2), keys = new Float32Array(this.ids.length * 2); ids.set(this.ids); keys.set(this.keys); this.ids = ids; this.keys = keys; }
        let i = this.size++;
        const I = this.ids, K = this.keys;
        while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= key) break; I[i] = I[p]; K[i] = K[p]; i = p; }
        I[i] = id; K[i] = key;
    }
    pop() {
        const I = this.ids, K = this.keys, top = I[0], last = I[--this.size], lk = K[this.size];
        let i = 0;
        for (;;) {
            let l = 2 * i + 1; if (l >= this.size) break;
            if (l + 1 < this.size && K[l + 1] < K[l]) l++;
            if (K[l] >= lk) break;
            I[i] = I[l]; K[i] = K[l]; i = l;
        }
        I[i] = last; K[i] = lk;
        this.topKey = K[0];
        return top;
    }
}

const angKm = (a, b) => { const X = G.xyz, d = X[3 * a] * X[3 * b] + X[3 * a + 1] * X[3 * b + 1] + X[3 * a + 2] * X[3 * b + 2]; return R_KM * Math.acos(Math.max(-1, Math.min(1, d))); };

/**
 * The cost (days) of a step from cell a to its neighbour b, `d` km apart in direction (ex, ny) (east, north components of
 * the unit step). mode 'travel': the traveller's — roads, rivers, the sea from ports only (`port`), winds and currents for
 * or against. mode 'reach': a kingdom's reach — the land, and the narrow seas near the coast at a steep cost.
 * Returns -1 where the step can't be made, and sets G.stepMode (0 land, 1 river, 2 sea or lake).
 */
/** How hard a cell holds back the kingdom now spreading (G.curLab): its frontiers, less those its people are at home in —
 *  where they are, they move faster than over open land, and take the whole of it. */
function barrierFor(c) {
    const g = G, A = g.useAdapt ? g.adapt[g.curLab] : null;
    if (!A) return Math.max(g.bMt[c], g.bDes[c], g.bCold[c], g.bBare[c]);
    const home = (A.mt && g.bMt[c] > 1) || (A.des && g.bDes[c] > 1) || (A.cold && g.bCold[c] > 1);
    const b = Math.max(A.mt ? 1 : g.bMt[c], A.des ? 1 : g.bDes[c], A.cold ? 1 : g.bCold[c], g.bBare[c]);
    return home && b === 1 ? 0.8 : b;
}
/** What each kingdom's people are at home in, from its wishes. */
function adaptOf(prefs) {
    return (prefs || []).map(p => {
        p = typeof p === 'string' ? { climate: p } : (p || {});
        return { mt: p.mountains === 'near' || p.height === 'high' || p.height === 'hills' && p.mountains !== 'far' || p.climate === 'highlands',
            des: p.climate === 'desert' || p.climate === 'steppe' || p.rain === 'arid',
            cold: p.climate === 'taiga' || p.climate === 'tundra' || p.temp === 'cold' || p.temp === 'cool',
            sea: p.sea === 'coast' || p.waters === 'rough' || p.currents === 'strong' };
    });
}
function stepCost(a, b, d, ex, ny, mode, port) {
    const g = G, la = g.land[a], lb = g.land[b];
    if (la && lb) {
        let cost = d * 0.5 * (g.walk[a] + g.walk[b]) * (1 + 25 * Math.abs(g.heightM[b] - g.heightM[a]) / (d * 1000));
        if (mode === 'travel' && g.roadF) cost *= 0.5 * (g.roadF[a] + g.roadF[b]);
        g.stepMode = 0;
        // (a kingdom's reach: slowed by the natural frontiers — borders settle on them; rivers cost nothing to cross)
        if (mode === 'reach') {
            cost *= 0.5 * (barrierFor(a) + barrierFor(b));
        }
        return cost;
    }
    if (mode === 'reach') {
        if (g.ice[a] || g.ice[b]) return -1;
        if (!lb && g.landDist[b] > 200) return -1;
        g.stepMode = 2;
        // (the sea a frontier too — a kingdom keeps mostly to its own shores — save for a seafaring people)
        return d / (g.useAdapt && g.adapt[g.curLab]?.sea ? 9 : 5);
    }
    // (the traveller: on and off the water at ports alone)
    if (la !== lb) {
        const shore = la ? a : b;
        // (a port: half a day; anywhere else on the shore, a fishing boat found and hired — three days)
        if (!port[shore]) return BEACH_DAYS;
        g.stepMode = 2;
        return EMBARK_DAYS * (g.lake[la ? b : a] ? 0.6 : 1);
    }
    // (on the water: a lake by boat; the sea under sail, with the wind and the current for or against, round the ice)
    g.stepMode = 2;
    if (g.lake[b] && g.lake[a]) return d / LAKE_KM_DAY;
    const ice = g.seaIce[b];
    if (ice > 0.6) return -1;
    const wAlong = g.windU[b] * ex + g.windV[b] * ny, cAlong = g.curU[b] * ex + g.curV[b] * ny;
    const clamp = v => Math.max(-1, Math.min(1, v));
    const speed = Math.max(0.35, 1 + 0.35 * clamp(wAlong / 7) + 0.3 * clamp(cAlong / 0.4));
    let risk = 1;
    const far = g.landDist[b];
    if (far > 1500) risk *= 1.6; else if (far > 400) risk *= 1.25;
    const ws = Math.hypot(g.windU[b], g.windV[b]);
    if (ws > 10) risk *= 1 + (ws - 10) / 8;
    if (ice > 0.15) risk *= 1 + 6 * (ice - 0.15);
    return d / (SAIL_KM_DAY * speed) * risk;
}

/**
 * Dijkstra from many sources at once (each `[cell, startCost, label]`), over steps of `mode`, as far as `maxCost` days:
 * each cell's cost (G.dist) and its source's label (G.lab, −1 unreached), its predecessor (G.from). `onSettle(c)` may
 * return true to stop.
 */
/**
 * The travellers' search (D&D fork): on foot (layer 0) or with a river boat (layer 1), node = cell + layer × n. G.dist,
 * G.lab hold each cell's first-settled cost and source; G.node its node, G.tfrom the nodes' predecessors (for the trace).
 */
function searchTravel(sources, maxCost, port, onSettle) {
    const g = G, { GW, GH, n } = g;
    if (!g.tdist) { g.tdist = new Float32Array(2 * n); g.tfrom = new Int32Array(2 * n); g.tlab = new Int16Array(2 * n); g.theap = new Heap(2 * n); g.node = new Int32Array(n); }
    const { tdist, tfrom, tlab, theap, dist, lab, node } = g;
    tdist.fill(Infinity); tfrom.fill(-1); tlab.fill(-1); theap.clear(); dist.fill(Infinity); lab.fill(-1); node.fill(-1);
    for (const [c, k0, l] of sources) if (k0 < tdist[c]) { tdist[c] = k0; tlab[c] = l; theap.push(c, k0); }
    const relax = (v, u, nk) => { if (nk < tdist[u]) { tdist[u] = nk; tlab[u] = tlab[v]; tfrom[u] = v; theap.push(u, nk); } };
    while (theap.size) {
        const k = theap.keys[0], v = theap.pop();
        if (k > tdist[v]) continue;
        if (k > maxCost) break;
        const boat = v >= n, c = boat ? v - n : v;
        if (node[c] < 0) { node[c] = v; dist[c] = k; lab[c] = tlab[v]; if (onSettle && onSettle(c)) break; }
        // (getting a boat, at a navigable river; leaving it, anywhere)
        if (!boat && !g.noBoat && g.land[c] && g.riverQ[c] >= NAV_Q) relax(v, c + n, k + BOAT_DAYS);
        if (boat) relax(v, c, k);
        const y = (c / GW) | 0, x = c - y * GW;
        for (const [dx, dy] of DIRS) {
            const yy = y + dy; if (yy < 0 || yy >= GH) continue;
            const b = yy * GW + ((x + dx + GW) % GW);
            const ddx = dx * 0.5 * (g.dxKm[y] + g.dxKm[yy]), ddy = dy * g.dyKm, d = Math.hypot(ddx, ddy), ex = ddx / d, ny = -ddy / d;
            if (boat) {
                if (!g.land[c] || !g.land[b]) continue;                     // (the boat keeps to the land's rivers)
                let s;
                if (g.riverQ[c] >= NAV_Q && g.riverQ[b] >= NAV_Q) {
                    const fu = g.flowU[c] + g.flowU[b], fv = g.flowV[c] + g.flowV[b], fl = Math.hypot(fu, fv);
                    const along = fl > 0 ? (fu * ex + fv * ny) / fl : 0;
                    s = d / (BOAT_KM_DAY * Math.max(0.5, 1 + 0.5 * along));
                } else s = stepCost(c, b, d, ex, ny, 'travel', port) * PORTAGE;
                if (s >= 0) relax(v, b + n, k + s);
            } else {
                if (g.landOnly && !g.land[b]) continue;                     // (by land alone)
                const s = stepCost(c, b, d, ex, ny, 'travel', port);
                if (s >= 0) relax(v, b, k + s);
            }
        }
    }
}
/** Between two cities (cells `a`, `b`): the best journey with a river boat allowed, and the best without one — each its
 *  days, how they are spent, and its way. */
function tripOptions(a, b, ports) {
    const g = G, port = portMap(ports);
    const one = (noBoat) => {
        g.noBoat = noBoat;
        searchTravel([[a, 0, 0]], Infinity, port, (c) => c === b);
        g.noBoat = false;
        if (!(g.dist[b] < Infinity)) return null;
        const n = g.n, nodes = [];
        for (let v = g.node[b]; v >= 0; v = g.tfrom[v]) nodes.push(v);
        nodes.reverse();
        const by = { foot: 0, carry: 0, river: 0, sea: 0, boat: 0 }, path = [], modes = [];
        for (let i = 0; i < nodes.length; i++) {
            const v = nodes[i], c = v % n, dt = i ? g.tdist[v] - g.tdist[nodes[i - 1]] : 0;
            const pc = i ? nodes[i - 1] % n : -1;
            if (i && pc === c) { if (v >= n) by.boat += dt; continue; }
            if (i) {
                const boat = v >= n, m = !g.land[pc] || !g.land[c] ? 2 : boat && g.riverQ[pc] >= NAV_Q && g.riverQ[c] >= NAV_Q ? 1 : 0;
                if (m === 2) by.sea += dt; else if (m === 1) by.river += dt; else if (boat) by.carry += dt; else by.foot += dt;
                modes.push(m);
            }
            path.push([((c % g.GW) + 0.5) / g.GW, (((c / g.GW) | 0) + 0.5) / g.GH]);
        }
        return { days: g.dist[b], by, path, modes, usesBoat: by.boat > 0 };
    };
    return { boat: one(false), noBoat: one(true) };
}
/** The trace of a traveller's way to cell `end` (after searchTravel): its cells and each step's way — 0 on foot (or carrying
 *  the boat), 1 by river boat, 2 by sea or lake. */
function traceTravel(end) {
    const g = G, n = g.n, nodes = [];
    for (let v = g.node[end]; v >= 0; v = g.tfrom[v]) nodes.push(v);
    nodes.reverse();
    const cells = [], modes = [];
    for (let i = 0; i < nodes.length; i++) {
        const v = nodes[i], c = v % n;
        if (cells.length && cells[cells.length - 1] === c) continue;          // (a boat got or left: no step)
        if (cells.length) {
            const a = cells[cells.length - 1], boat = v >= n;
            modes.push(!g.land[a] || !g.land[c] ? 2 : boat && g.riverQ[a] >= NAV_Q && g.riverQ[c] >= NAV_Q ? 1 : 0);
        }
        cells.push(c);
    }
    return { cells, modes };
}
function search(sources, mode, maxCost, port = null, onSettle = null) {
    if (mode === 'travel') return searchTravel(sources, maxCost, port, onSettle);
    const g = G, { GW, GH, dist, lab, from, heap } = g;
    dist.fill(Infinity); lab.fill(-1); from.fill(-1); heap.clear();
    for (const [c, k0, l] of sources) { if (k0 < dist[c]) { dist[c] = k0; lab[c] = l; heap.push(c, k0); } }
    while (heap.size) {
        const k = heap.keys[0], c = heap.pop();
        if (k > dist[c]) continue;
        g.curLab = lab[c];
        if (k > maxCost) break;
        if (onSettle && onSettle(c)) break;
        const y = (c / GW) | 0, x = c - y * GW;
        for (const [dx, dy] of DIRS) {
            const yy = y + dy; if (yy < 0 || yy >= GH) continue;
            const b = yy * GW + ((x + dx + GW) % GW);
            const ddx = dx * 0.5 * (g.dxKm[y] + g.dxKm[yy]), ddy = dy * g.dyKm, d = Math.hypot(ddx, ddy);
            const s = stepCost(c, b, d, ddx / d, -ddy / d, mode, port);
            if (s < 0) continue;
            const nk = k + s;
            if (nk < dist[b]) { dist[b] = nk; lab[b] = lab[c]; from[b] = c; heap.push(b, nk); }
        }
    }
}

// ── the kingdoms: capitals spread over the food, then grown and balanced (a few rounds of Lloyd's, by travel) ──
const REACH_DAYS = 120, WILD_DAYS = 25, WILD_PEOPLE = 0.05;

function partition(capitals, bias) {
    // (D&D fork: no limit — all the land goes to the kingdom it is fewest days from, however far: no wild, no gaps)
    G.useAdapt = true;                             // (the labels are kingdoms: each crosses the land as its people can)
    const lo = Math.min(...bias), sources = capitals.map((c, k) => [c, Math.max(0, bias[k] - lo), k]);
    search(sources, 'reach', Infinity);
    G.useAdapt = false;
    const owner = new Int16Array(G.n).fill(-1);
    for (let c = 0; c < G.n; c++) if (G.land[c] && G.lab[c] >= 0) owner[c] = G.lab[c];
    claimAll(owner);
    // (a kingdom that holds a material's sources: each source its own, with the ground round it (~80 km) — mines held as
    // outposts, not a road to them. As a condition, every source; as a preference, those within a kingdom's breadth of its
    // capital — the far ones left to whoever holds the land)
    const g = G, { GW, GH } = g;
    (g.prefs || []).forEach((p, k) => {
        if (!p || typeof p !== 'object' || !p.hold || k >= capitals.length) return;
        const must = !!p.req?.hold, reach = 1.2 * (g.D0 || 3000);
        for (const c of richCells(p.hold)) {
            if (!must && angKm(c, capitals[k]) > reach) continue;
            const y = (c / GW) | 0, x = c - y * GW;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
                const yy = y + dy; if (yy < 0 || yy >= GH) continue;
                const d = yy * GW + ((x + dx + GW) % GW);
                if (g.land[d]) owner[d] = k;
            }
        }
    });
    return owner;
}

/** Every piece of land some kingdom's (D&D fork: no wild, no unclaimed island): the land beyond every capital's reach goes to
 *  the kingdom nearest it, spreading out over land and sea alike. */
function claimAll(owner) {
    const g = G, { GW, GH } = g, lab = new Int16Array(g.n).fill(-1), queue = new Int32Array(g.n);
    let qh = 0, qt = 0;
    for (let c = 0; c < g.n; c++) if (owner[c] >= 0) { lab[c] = owner[c]; queue[qt++] = c; }
    if (!qt) return owner;
    while (qh < qt) {
        const c = queue[qh++], y = (c / GW) | 0, x = c - y * GW;
        for (const [dx, dy] of DIRS) {
            const yy = y + dy; if (yy < 0 || yy >= GH) continue;
            const d = yy * GW + ((x + dx + GW) % GW);
            if (lab[d] < 0) { lab[d] = lab[c]; queue[qt++] = d; }
        }
    }
    for (let c = 0; c < g.n; c++) if (g.land[c] && owner[c] < 0) owner[c] = lab[c];
    return owner;
}

// ── where a kingdom's people like to live (D&D fork): its climate, temperature, rain, the sea, height, mountains, rivers.
// Each cell scored by how many of the kingdom's wishes it meets (the climate and the weather counting more); its capital
// stands where the score is highest, and stays there as the kingdom grows. ──
const CLIMATE_RE = { tropical: /^A/, desert: /^BW/, steppe: /^BS/, mediterranean: /^Cs/, temperate: /^C[fw]/, continental: /^D.[ab]$/, taiga: /^D.[cd]$/, tundra: /^ET$/ };
const TEMP = { hot: [20, 99], warm: [13, 22], mild: [7, 15], cool: [0, 9], cold: [-99, 2] };
const RAIN = { arid: [0, 250], dry: [250, 600], moderate: [600, 1200], wet: [1200, 99999] };
const HEIGHT = { low: [-999, 300], hills: [250, 1000], high: [900, 99999] };
/** The wishes as tests: [key, weight, test]. */
function wishes(p) {
    if (typeof p === 'string') p = { climate: p };
    const g = G, out = [];
    if (!p) return out;
    if (p.climate === 'highlands') out.push(['climate', 2, c => g.heightM[c] >= 1000]);
    else if (CLIMATE_RE[p.climate]) { const re = CLIMATE_RE[p.climate]; out.push(['climate', 2, c => re.test(g.codes[g.koppen[c]] || '')]); }
    if (TEMP[p.temp]) { const [a, b] = TEMP[p.temp]; out.push(['temp', 1.5, c => g.tempC[c] >= a && g.tempC[c] <= b]); }
    if (RAIN[p.rain]) { const [a, b] = RAIN[p.rain]; out.push(['rain', 1.5, c => g.rainMm[c] >= a && g.rainMm[c] <= b]); }
    if (p.sea === 'coast') out.push(['sea', 1, c => !!g.coast[c]]);
    if (p.sea === 'inland') out.push(['sea', 1, c => !g.coast[c] && g.seaHops[c] >= 4]);
    if (HEIGHT[p.height]) { const [a, b] = HEIGHT[p.height]; out.push(['height', 1, c => g.heightM[c] >= a && g.heightM[c] <= b]); }
    if (p.mountains === 'near') out.push(['mountains', 1, c => g.mtHops[c] <= 5]);
    if (p.mountains === 'far') out.push(['mountains', 1, c => g.mtHops[c] >= 9]);
    if (p.river === 'yes') out.push(['river', 1, c => g.riverNear[c] === 1]);
    if (p.waters === 'rough') out.push(['waters', 1, c => g.coast[c] && g.coastWind[c] >= g.windHi]);
    if (p.waters === 'calm') out.push(['waters', 1, c => g.coast[c] && g.coastWind[c] <= g.windLo]);
    if (p.currents === 'strong') out.push(['currents', 1, c => g.coast[c] && g.coastCur[c] >= g.curHi]);
    if (p.currents === 'weak') out.push(['currents', 1, c => g.coast[c] && g.coastCur[c] <= g.curLo]);
    if (p.fertility === 'high') out.push(['fertility', 1.5, c => g.people[c] >= g.fertHi]);
    if (p.fertility === 'low') out.push(['fertility', 1, c => g.people[c] > 0 && g.people[c] <= g.fertLo]);
    if (p.ore && g.ores?.[p.ore]) { const N = oreNear(p.ore); out.push(['ore', 2, c => N[c] === 1]); }
    return out;
}
/** A material's sources: the land cells of its richest deposits (its best few per cent, as oreNear reads them). */
function richCells(id) {
    const g = G;
    g.rich ??= {};
    if (!g.rich[id]) {
        const o = g.ores?.[id];
        if (!o) return (g.rich[id] = []);
        const vals = [];
        for (let c = 0; c < g.n; c++) if (o[c] > 0 && g.land[c] && !g.ice[c]) vals.push(o[c]);
        vals.sort((a, b) => b - a);
        const thr = Math.max(100, vals[Math.floor(vals.length * 0.03)] ?? 255), out = [];
        for (let c = 0; c < g.n; c++) if (o[c] >= thr && g.land[c] && !g.ice[c]) out.push(c);
        g.rich[id] = out;
    }
    return g.rich[id];
}
/** Within ~120 km of one of a material's richest deposits (its best few per cent). */
function oreNear(id) {
    const g = G;
    g.oreNear ??= {};
    if (!g.oreNear[id]) {
        const o = g.ores[id], vals = [];
        for (let c = 0; c < g.n; c++) if (o[c] > 0 && g.land[c]) vals.push(o[c]);
        vals.sort((a, b) => b - a);
        const thr = Math.max(100, vals[Math.floor(vals.length * 0.03)] ?? 255);
        const M = new Uint8Array(g.n), { GW, GH } = g;
        for (let c = 0; c < g.n; c++) {
            if (!(o[c] >= thr)) continue;
            const y = (c / GW) | 0, x = c - y * GW;
            for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const yy = y + dy; if (yy < 0 || yy >= GH) continue; M[yy * GW + ((x + dx + GW) % GW)] = 1; }
        }
        g.oreNear[id] = M;
    }
    return g.oreNear[id];
}
/** A kingdom's wishes per cell: S, the weight of its preferences met; R, where every one of its conditions holds (null:
 *  none); `none` when it has no wishes at all. */
function scoreOf(p) {
    const g = G;
    if (!g.scores) { g.scores = new Map(); hopsFields(); }
    const key = JSON.stringify(p ?? '');
    if (!g.scores.has(key)) {
        const W = wishes(p), req = (typeof p === 'object' && p?.req) || {};
        const pref = W.filter(([k]) => !req[k]), cond = W.filter(([k]) => req[k]);
        const S = new Float32Array(g.n), R = cond.length ? new Uint8Array(g.n) : null;
        for (let c = 0; c < g.n; c++) {
            if (!g.land[c] || g.ice[c]) continue;
            let v = 0; for (const [, w, f] of pref) if (f(c)) v += w; S[c] = v;
            if (R) { let ok = 1; for (const [, , f] of cond) if (!f(c)) { ok = 0; break; } R[c] = ok; }
        }
        g.scores.set(key, W.length ? { S, R, nPref: pref.length } : null);
    }
    return g.scores.get(key);
}
const nearOf = (p) => (p && typeof p === 'object' && p.near !== undefined && p.near !== '' ? +p.near : -1);
const nearReq = (p) => !!(p && typeof p === 'object' && p.req?.near);
/** Hops to the nearest high mountain (a peak over 2000 m), to the sea; and a big river within a cell. */
function hopsFields() {
    const g = G, { GW, GH } = g;
    const bfs = (seed) => {
        const h = new Uint16Array(g.n).fill(65535), q = new Int32Array(g.n); let qh = 0, qt = 0;
        for (let c = 0; c < g.n; c++) if (seed(c)) { h[c] = 0; q[qt++] = c; }
        while (qh < qt) {
            const c = q[qh++], y = (c / GW) | 0, x = c - y * GW;
            for (const [dx, dy] of DIRS) { const yy = y + dy; if (yy < 0 || yy >= GH) continue; const d = yy * GW + ((x + dx + GW) % GW); if (h[d] === 65535) { h[d] = h[c] + 1; q[qt++] = d; } }
        }
        return h;
    };
    g.mtHops = bfs(c => g.land[c] && g.peakM[c] >= 2000);
    g.seaHops = bfs(c => !g.land[c] && !g.lake[c]);
    // (how rough the sea off each coast is: the strongest mean wind over the water within two cells; rough is the windiest
    // third of the world's coasts, calm the stillest third)
    g.coastWind = new Float32Array(g.n);
    const ws = [];
    for (let c = 0; c < g.n; c++) {
        if (!g.coast[c]) continue;
        const y = (c / GW) | 0, x = c - y * GW;
        let m = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const yy = y + dy; if (yy < 0 || yy >= GH) continue;
            const d = yy * GW + ((x + dx + GW) % GW);
            if (!g.land[d] && !g.lake[d]) m = Math.max(m, Math.hypot(g.windU[d], g.windV[d]) * (1 + 2 * g.seaIce[d]));
        }
        g.coastWind[c] = m; ws.push(m);
    }
    ws.sort((a, b) => a - b);
    g.windLo = ws[Math.floor(ws.length / 3)] ?? 0; g.windHi = ws[Math.floor(2 * ws.length / 3)] ?? 99;
    // (the current off each coast, and how fertile each place is — strong and weak the top and bottom thirds, fertile the
    // best quarter of the land that feeds anyone)
    g.coastCur = new Float32Array(g.n);
    const cs = [];
    for (let c = 0; c < g.n; c++) {
        if (!g.coast[c]) continue;
        const y = (c / GW) | 0, x = c - y * GW;
        let m = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const yy = y + dy; if (yy < 0 || yy >= GH) continue;
            const d = yy * GW + ((x + dx + GW) % GW);
            if (!g.land[d] && !g.lake[d]) m = Math.max(m, Math.hypot(g.curU[d], g.curV[d]));
        }
        g.coastCur[c] = m; cs.push(m);
    }
    cs.sort((a, b) => a - b);
    g.curLo = cs[Math.floor(cs.length / 3)] ?? 0; g.curHi = cs[Math.floor(2 * cs.length / 3)] ?? 99;
    const ps = []; for (let c = 0; c < g.n; c++) if (g.land[c] && g.people[c] > 0) ps.push(g.people[c]);
    ps.sort((a, b) => a - b);
    g.fertLo = ps[Math.floor(ps.length / 4)] ?? 0; g.fertHi = ps[Math.floor(3 * ps.length / 4)] ?? 1e9;
    g.riverNear = new Uint8Array(g.n);
    for (let c = 0; c < g.n; c++) {
        if (!g.land[c]) continue;
        const y = (c / GW) | 0, x = c - y * GW;
        if (g.riverQ[c] >= CROSS_Q) { g.riverNear[c] = 1; continue; }
        for (const [dx, dy] of DIRS) { const yy = y + dy; if (yy < 0 || yy >= GH) continue; if (g.riverQ[yy * GW + ((x + dx + GW) % GW)] >= CROSS_Q) { g.riverNear[c] = 1; break; } }
    }
}

function seedCapitals(K, prefs = []) {
    const g = G, MIN_KM2 = 150000;
    let cands = [];
    for (let c = 0; c < g.n; c++) if (g.site[c] > 0 && g.compArea[g.comp[c]] >= MIN_KM2) cands.push(c);
    // (an archipelago world: any land will do)
    if (cands.length < K * 20) { cands = []; for (let c = 0; c < g.n; c++) if (g.site[c] > 0) cands.push(c); }
    if (!cands.length) return [];
    let landArea = 0; for (let c = 0; c < g.n; c++) if (g.food[c] > 0) landArea += g.area[c];
    const D0 = Math.sqrt(landArea / K), out = new Array(K).fill(-1), dmin = new Float32Array(g.n).fill(Infinity);
    // (the kingdoms with wishes first, the most particular first — one that wants to be near another after it — each on the
    // best site for it; then the rest, spread among them)
    const nW = (k) => wishes(prefs[k]).reduce((t, [, w]) => t + w, 0) + (nearOf(prefs[k]) >= 0 ? -100 : 0);
    const order = [...Array(K).keys()].sort((a, b) => nW(b) - nW(a));
    const Dnear = 0.9 * D0; g.D0 = D0; g.unmet = [];
    let placed = 0;
    for (const k of order) {
        let list = cands;
        const W = scoreOf(prefs[k]), j = nearOf(prefs[k]);
        // (its conditions: only where they all hold — on a good site, else on any land of some size; else noted, unmet)
        if (W?.R) {
            let l = cands.filter(c => W.R[c]);
            if (l.length < 3) { l = []; for (let c = 0; c < g.n; c++) if (W.R[c] && g.compArea[g.comp[c]] >= 20000) l.push(c); }
            if (l.length) list = l; else g.unmet.push(k);
        }
        // (near another kingdom: within a kingdom's breadth of its capital — a condition, or a preference)
        if (j >= 0 && j < K && out[j] >= 0) {
            const l = list.filter(c => angKm(c, out[j]) <= Dnear);
            if (l.length) list = l; else if (nearReq(prefs[k])) g.unmet.push(k);
        }
        // (its preferences: the sites meeting the most of them)
        if (W && W.nPref) {
            let best = 0; for (const c of list) if (W.S[c] > best) best = W.S[c];
            const l = list.filter(c => W.S[c] >= best);
            if (l.length) list = l;
        }
        let pick = -1, pv = -1;
        for (const c of list) {
            const v = (g.site[c] + 0.01) ** 0.25 * (placed ? 1 - Math.exp(-((dmin[c] / (j >= 0 ? 0.5 * D0 : D0)) ** 2)) : 1);
            if (v > pv) { pv = v; pick = c; }
        }
        if (pick < 0) continue;
        out[k] = pick; placed++;
        for (let c = 0; c < g.n; c++) if (g.land[c]) { const d = angKm(c, pick); if (d < dmin[c]) dmin[c] = d; }
    }
    // (a kingdom with nowhere to stand: the best site left)
    for (let k = 0; k < K; k++) if (out[k] < 0) {
        let pick = cands[0], pv = -1;
        for (const c of cands) { const v = (dmin[c] === Infinity ? 1 : dmin[c]) * g.site[c]; if (v > pv && !out.includes(c)) { pv = v; pick = c; } }
        out[k] = pick;
    }
    return out;
}

function grow(K, prefs = []) {
    const g = G;
    g.adapt = adaptOf(prefs); g.prefs = prefs;
    say(0);
    let caps = seedCapitals(K, prefs);
    say(1);
    K = caps.length;
    const bias = new Array(K).fill(0);
    let owner = null;
    for (let it = 0; it < 7; it++) {
        say(1, it / 7);
        owner = partition(caps, bias);
        const F = new Float64Array(K), A = new Float64Array(K), cx = new Float64Array(3 * K);
        for (let c = 0; c < g.n; c++) {
            const k = owner[c]; if (k < 0) continue;
            const f = g.food[c]; F[k] += f; A[k] += g.area[c];
            cx[3 * k] += f * g.xyz[3 * c]; cx[3 * k + 1] += f * g.xyz[3 * c + 1]; cx[3 * k + 2] += f * g.xyz[3 * c + 2];
        }
        if (it === 6) break;
        const total = F.reduce((s, v) => s + v, 0), T = total / K;
        // (each capital moves to the best site near its kingdom's centre of food)
        const bestV = new Float64Array(K), bestC = caps.slice();
        // (a kingdom whose capital stands in its climate keeps it there)
        // (a capital moves only where its conditions still hold, its preferences are as well met, and the kingdom it wants
        // to be near is still near)
        const keep = caps.map((c, k) => { const W = scoreOf(prefs[k]), j = nearOf(prefs[k]); return { W, at: W ? W.S[c] : 0, R: W?.R && W.R[c] ? W.R : null, j: j >= 0 && j < K && angKm(c, caps[j]) <= 0.9 * g.D0 ? j : -1 }; });
        for (let c = 0; c < g.n; c++) {
            const k = owner[c]; if (k < 0 || !(g.site[c] > 0) || g.comp[c] !== g.comp[caps[k]] || (keep[k].W && keep[k].W.S[c] < keep[k].at) || (keep[k].R && !keep[k].R[c]) || (keep[k].j >= 0 && angKm(c, caps[keep[k].j]) > 0.9 * g.D0)) continue;
            const l = Math.hypot(cx[3 * k], cx[3 * k + 1], cx[3 * k + 2]) || 1;
            const dot = (g.xyz[3 * c] * cx[3 * k] + g.xyz[3 * c + 1] * cx[3 * k + 1] + g.xyz[3 * c + 2] * cx[3 * k + 2]) / l;
            const dk = R_KM * Math.acos(Math.max(-1, Math.min(1, dot))), Dk = 0.35 * Math.sqrt(A[k]) + 50;
            const v = g.site[c] ** 0.5 * Math.exp(-dk / Dk);
            if (v > bestV[k]) { bestV[k] = v; bestC[k] = c; }
        }
        caps = bestC;
        // (and the kingdoms balanced: one too poor to feed itself grows, one far richer than the rest shrinks)
        for (let k = 0; k < K; k++) {
            if (F[k] < 0.5 * T) bias[k] = Math.max(-12, bias[k] - 2);
            else if (F[k] > 2 * T) bias[k] = Math.min(12, bias[k] + 2);
        }
    }
    return { caps, owner, bias };
}

// ── the cities: the capitals, then the best sites in each kingdom by its food, kept apart ──
function placeCities(caps, owner, N, mins = [], prefs = [], ports = []) {
    const g = G, K = caps.length, F = new Float64Array(K), A = new Float64Array(K);
    for (let c = 0; c < g.n; c++) { const k = owner[c]; if (k >= 0) { F[k] += g.food[c]; if (g.food[c] > 0) A[k] += g.area[c]; } }
    const extra = Math.max(0, N - K), total = F.reduce((s, v) => s + v, 0) || 1;
    const share = [...F].map(f => extra * f / total), counts = share.map(Math.floor);
    let left = extra - counts.reduce((s, v) => s + v, 0);
    const order = share.map((s, k) => [s - counts[k], k]).sort((a, b) => b[0] - a[0]);
    for (let i = 0; left > 0 && i < order.length; i++, left--) counts[order[i][1]]++;
    // (a kingdom with towns already named gets at least that many, taken from the kingdom with the most)
    for (let k = 0; k < K; k++) while (counts[k] < (mins[k] || 0)) { let r = -1; for (let j = 0; j < K; j++) if (j !== k && counts[j] > (mins[j] || 0) && (r < 0 || counts[j] > counts[r])) r = j; if (r < 0) break; counts[r]--; counts[k]++; }
    const cities = caps.map((c, k) => ({ c, capital: true, kingdom: k }));
    // (D&D fork: the towns on the kingdom's best ground, spread over the whole of it — each its site (food round it, fresh
    // water, a harbour), more where its people like to live, less on the border; picked one by one, each as good a site as
    // lies far enough from the towns already there, as the capitals were)
    const { GW, GH } = g, edge = new Uint16Array(g.n).fill(65535), q = new Int32Array(g.n);
    let qh = 0, qt = 0;
    for (let c = 0; c < g.n; c++) {
        const k = owner[c]; if (k < 0) continue;
        const y = (c / GW) | 0, x = c - y * GW;
        for (const [dx, dy] of DIRS) { const yy = y + dy; if (yy < 0 || yy >= GH) continue; const d = yy * GW + ((x + dx + GW) % GW); if (g.land[d] && owner[d] !== k) { edge[c] = 0; q[qt++] = c; break; } }
    }
    while (qh < qt) {
        const c = q[qh++], y = (c / GW) | 0, x = c - y * GW;
        for (const [dx, dy] of DIRS) { const yy = y + dy; if (yy < 0 || yy >= GH) continue; const d = yy * GW + ((x + dx + GW) % GW); if (owner[d] >= 0 && edge[d] === 65535) { edge[d] = edge[c] + 1; q[qt++] = d; } }
    }
    const byKingdom = Array.from({ length: K }, () => []);
    for (let c = 0; c < g.n; c++) { const k = owner[c]; if (k >= 0 && g.site[c] > 0) byKingdom[k].push(c); }
    for (let k = 0; k < K; k++) {
        if (!counts[k]) continue;
        const list = byKingdom[k], S = scoreOf(prefs[k])?.S ?? null, top = S ? list.reduce((m, c) => Math.max(m, S[c]), 1e-6) : 1;
        const base = new Float32Array(list.length);
        list.forEach((c, i) => { base[i] = g.site[c] ** 0.6 * (S ? 0.6 + 0.8 * S[c] / top : 1) * (edge[c] <= 1 ? 0.35 : edge[c] <= 3 ? 0.7 : 1); });
        const D = Math.max(80, 0.6 * Math.sqrt(A[k] / (counts[k] + 1))), dmin = new Float32Array(list.length).fill(Infinity);
        const near = (c, t) => { const d = angKm(c, t.c); return t.kingdom === k ? d : d / 0.6; };
        list.forEach((c, i) => { for (const t of cities) { const d = near(c, t); if (d < dmin[i]) dmin[i] = d; } });
        for (let got = 0; got < counts[k]; got++) {
            let pick = -1, pv = 0;
            // (the first towns on the coast, as many as the kingdom's towns described with a port)
            const coastOnly = got < (ports[k] || 0);
            for (let i = 0; i < list.length; i++) {
                if (dmin[i] < 45 || (coastOnly && !g.coast[list[i]])) continue;
                const v = base[i] * (1 - Math.exp(-((dmin[i] / D) ** 2)));
                if (v > pv) { pv = v; pick = i; }
            }
            if (pick < 0) break;
            const t = { c: list[pick], capital: false, kingdom: k };
            cities.push(t);
            list.forEach((c, i) => { const d = near(c, t); if (d < dmin[i]) dmin[i] = d; });
        }
    }
    return cities;
}

// ── each city's hinterland, its people and the kingdom's food ──
const SUSTAIN = [0, 0.18, 0.14, 0.12];     // (medieval: well under what the land could feed at its best)     // (the share of what the land could feed that lives on it: farming, herding, gathering)

function describe(cities, owner, K) {
    const g = G;
    // (the hinterland: each cell to its nearest city by travel, within the city's kingdom)
    search(cities.map((t, i) => [t.c, 0, i]), 'reach', 30);
    const cityFood = new Float64Array(cities.length), cityPop = new Float64Array(cities.length);
    const kingdoms = Array.from({ length: K }, () => ({ food: 0, people: 0, area: 0, byLife: [0, 0, 0, 0], byStaple: new Array(8).fill(0), climate: { A: 0, B: 0, C: 0, D: 0, E: 0 }, mountains: 0, coastKm: 0, navigable: 0, ports: 0, cities: 0, wild: 0 }));
    for (let c = 0; c < g.n; c++) {
        if (!g.land[c]) continue;
        const k = owner[c];
        if (k < 0) continue;
        const K0 = kingdoms[k], f = g.food[c], life = g.lifestyle[c];
        K0.food += f; K0.area += g.area[c];
        K0.people += f * SUSTAIN[life];
        K0.byLife[life] += f; K0.byStaple[g.staple[c]] += f;
        const code = g.codes[g.koppen[c]] || ''; if (K0.climate[code[0]] !== undefined) K0.climate[code[0]] += g.area[c];
        if (g.peakM[c] > 2000) K0.mountains += g.area[c];
        if (g.coast[c]) K0.coastKm += Math.sqrt(g.area[c]);
        if (g.riverQ[c] >= NAV_Q) K0.navigable += Math.sqrt(g.area[c]);
        const i = g.lab[c];
        if (i >= 0 && cities[i].kingdom === k) cityFood[i] += f * SUSTAIN[life];
        else K0.wild += g.area[c];
    }
    // (the towns' people: a share of the kingdom's, by their hinterland, the capital most)
    for (let k = 0; k < K; k++) {
        const list = cities.map((t, i) => [t, i]).filter(([t]) => t.kingdom === k);
        kingdoms[k].cities = list.length;
        const w = list.map(([t, i]) => (cityFood[i] ** 1.15) * (t.capital ? 2 : 1)), W = w.reduce((s, v) => s + v, 0) || 1;
        list.forEach(([t, i], j) => { cityPop[i] = 0.05 * kingdoms[k].people * w[j] / W; });
    }
    for (const t of cities) {
        const y = (t.c / G.GW) | 0, x = t.c - y * G.GW;
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) { const yy = y + dy; if (yy < 0 || yy >= G.GH) continue; const d = yy * G.GW + ((x + dx + G.GW) % G.GW); if (G.coast[d] || G.lakeside[d]) near = true; }
        if (near && kingdoms[t.kingdom]) t.port = true;
    }
    for (const t of cities) if (t.port && kingdoms[t.kingdom]) kingdoms[t.kingdom].ports++;
    return { kingdoms, cityPop, cityFood };
}

// ── the routes: each city to its neighbours by travel, the redundant links dropped, then each route traced ──
const NEAR = 8, ROUTE_DAYS = 90;

/** Each kingdom's other capitals (D&D fork): its biggest towns near the first, as many as it has capitals — kept as the
 *  page sent them for a realm placed by hand. */
function pickSeats(cities, pop, K) {
    if (G.seatsIn) return;
    for (let k = 0; k < K; k++) {
        const n = (G.ncap[k] || 1) - 1; if (n <= 0) continue;
        const cap = cities.find(t => t.capital && t.kingdom === k); if (!cap) continue;
        let own = cities.map((t, i) => [t, i]).filter(([t]) => t.kingdom === k && !t.capital);
        if (G.keepPorts[k]) { const dry = own.filter(([t]) => !t.port); if (dry.length >= n) own = dry; }
        own.sort((a, b) => pop[b[1]] / (1 + angKm(b[0].c, cap.c) / 400) - pop[a[1]] / (1 + angKm(a[0].c, cap.c) / 400));
        for (let j = 0; j < n && j < own.length; j++) own[j][0].seat = true;
    }
}

/**
 * The roads grown as a slime mould grows its network (D&D fork; Physarum polycephalum, as Tero et al., Science 2010,
 * modelled it): the land a grid of tubes, each as long as its ground takes to cross; the cities the food. Step by step one
 * city drives a flow to the others (Kirchhoff's law: a Laplacian solved by conjugate gradients), the tubes that carry much
 * of it thicken, the rest wither (dD/dt = |Q|^μ / (1 + |Q|^μ) − D). What stays thick is the network: trunks, junctions,
 * a few loops. On a grid four times coarser than the realm's; per landmass. Returns each realm cell's road strength 0…1.
 */
const SLIME_F = 4, SLIME_ITERS = 160, SLIME_MU = 1.6, SLIME_DT = 0.6, OPP = [1, 0, 3, 2, 7, 6, 5, 4];   // (OPP: each of DIRS's opposite)
function slimeRoads(food, weight, stepIndex) {
    const g = G, { GW, GH } = g, F = SLIME_F, W = GW / F, H = GH / F, N = W * H;
    // (the coarse cells: land where most of the fine cells are; each one's days a km — the walk, without the boat)
    if (!g.slime) {
        const land = new Uint8Array(N), wk = new Float32Array(N), xyz = new Float32Array(3 * N);
        for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
            let nl = 0, sw = 0;
            for (let y = Y * F; y < Y * F + F; y++) for (let x = X * F; x < X * F + F; x++) { const c = y * GW + x; if (g.land[c] && !g.ice[c]) { nl++; sw += g.walk[c]; } }
            const C = Y * W + X; land[C] = nl * 2 >= F * F ? 1 : 0; wk[C] = nl ? sw / nl : 0;
            const c0 = (Y * F + (F >> 1)) * GW + X * F + (F >> 1); xyz[3 * C] = g.xyz[3 * c0]; xyz[3 * C + 1] = g.xyz[3 * c0 + 1]; xyz[3 * C + 2] = g.xyz[3 * c0 + 2];
        }
        // (the tubes: each land cell to its 8 neighbours, as long as the days between them)
        const nb = new Int32Array(8 * N).fill(-1), len = new Float32Array(8 * N);
        for (let C = 0; C < N; C++) {
            if (!land[C]) continue;
            const Y = (C / W) | 0, X = C - Y * W;
            DIRS.forEach(([dx, dy], k) => {
                const YY = Y + dy; if (YY < 0 || YY >= H) return;
                const D = YY * W + ((X + dx + W) % W); if (!land[D]) return;
                const d = R_KM * Math.acos(Math.max(-1, Math.min(1, xyz[3 * C] * xyz[3 * D] + xyz[3 * C + 1] * xyz[3 * D + 1] + xyz[3 * C + 2] * xyz[3 * D + 2])));
                nb[8 * C + k] = D; len[8 * C + k] = Math.max(1e-3, d * 0.5 * (wk[C] + wk[D]));
            });
        }
        // (the landmasses, each solved on its own)
        const comp = new Int32Array(N).fill(-1), q = new Int32Array(N);
        let nc = 0;
        for (let s0 = 0; s0 < N; s0++) {
            if (!land[s0] || comp[s0] >= 0) continue;
            let qh = 0, qt = 0; q[qt++] = s0; comp[s0] = nc;
            while (qh < qt) { const C = q[qh++]; for (let k = 0; k < 8; k++) { const D = nb[8 * C + k]; if (D >= 0 && comp[D] < 0) { comp[D] = nc; q[qt++] = D; } } }
            nc++;
        }
        g.slime = { W, H, N, land, nb, len, comp };
    }
    const S = g.slime, { nb, len, comp } = S;
    const coarse = (c) => (((c / GW) | 0) / F | 0) * W + (((c % GW) / F) | 0);
    // (the food: each city's coarse cell, on land; by landmass)
    const nodes = [], wts = [];
    food.forEach((c, i) => { const C = coarse(c); if (S.land[C]) { nodes.push(C); wts.push(weight[i]); } });
    const D = new Float32Array(8 * S.N).fill(1), p = new Float64Array(S.N), b = new Float64Array(S.N), r = new Float64Array(S.N), dir = new Float64Array(S.N), Ap = new Float64Array(S.N);
    const byComp = new Map();
    nodes.forEach((C, i) => { const k = comp[C]; if (!byComp.has(k)) byComp.set(k, []); byComp.get(k).push(i); });
    const groups = [...byComp.values()].filter(gr => gr.length >= 2);
    if (!groups.length) return null;
    // (each landmass's cells, once)
    const cellsOf = new Map();
    for (const gr of groups) { const k = comp[nodes[gr[0]]], list = []; for (let C = 0; C < S.N; C++) if (comp[C] === k) list.push(C); cellsOf.set(k, list); }
    let seed = 12345 + nodes.length * 7919; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    const mul = (cells, x, out) => { for (const C of cells) { let s2 = 0; for (let k = 0; k < 8; k++) { const E = nb[8 * C + k]; if (E < 0) continue; const w = (D[8 * C + k] + D[8 * E + OPP[k]]) * 0.5 / len[8 * C + k]; s2 += w * (x[C] - x[E]); } out[C] = s2; } };
    for (let it = 0; it < SLIME_ITERS; it++) {
        say(stepIndex, it / SLIME_ITERS);
        // (one city, by its weight, drives the flow; the others of its landmass take it in, by theirs)
        const gr = groups[Math.floor(rnd() * groups.length)];
        let tot = 0; for (const i of gr) tot += wts[i];
        let pick = rnd() * tot, src = gr[0]; for (const i of gr) { pick -= wts[i]; if (pick <= 0) { src = i; break; } }
        const cells = cellsOf.get(comp[nodes[src]]), I0 = 1.5;
        for (const C of cells) b[C] = 0;
        const rest = tot - wts[src];
        for (const i of gr) if (i !== src) b[nodes[i]] -= I0 * wts[i] / rest;
        b[nodes[src]] += I0;
        // (Kirchhoff: the pressures by conjugate gradients, from the last ones)
        mul(cells, p, Ap);
        let rr = 0; for (const C of cells) { r[C] = b[C] - Ap[C]; dir[C] = r[C]; rr += r[C] * r[C]; }
        for (let k = 0; k < 60 && rr > 1e-10; k++) {
            mul(cells, dir, Ap);
            let pAp = 0; for (const C of cells) pAp += dir[C] * Ap[C];
            if (!(pAp > 0)) break;
            const a = rr / pAp; let rr2 = 0;
            for (const C of cells) { p[C] += a * dir[C]; r[C] -= a * Ap[C]; rr2 += r[C] * r[C]; }
            const bet = rr2 / rr; rr = rr2;
            for (const C of cells) dir[C] = r[C] + bet * dir[C];
        }
        // (the tubes thicken with their flow, and wither without it)
        for (const C of cells) for (let k = 0; k < 8; k++) {
            const E = nb[8 * C + k]; if (E < 0) continue;
            const Q = Math.abs((D[8 * C + k] + D[8 * E + OPP[k]]) * 0.5 / len[8 * C + k] * (p[C] - p[E])), fq = Q ** SLIME_MU / (1 + Q ** SLIME_MU);
            D[8 * C + k] += SLIME_DT * (fq - D[8 * C + k]);
        }
    }
    // (each fine cell's road strength: its coarse cell's thickest tube, against the network's thickest)
    const best = new Float32Array(S.N); let top = 0;
    for (let C = 0; C < S.N; C++) { let m = 0; for (let k = 0; k < 8; k++) if (nb[8 * C + k] >= 0) m = Math.max(m, D[8 * C + k]); best[C] = m; top = Math.max(top, m); }
    const out = new Float32Array(g.n);
    if (top > 0) for (let c = 0; c < g.n; c++) if (g.land[c]) { const v = best[coarse(c)] / top; out[c] = v > 0.12 ? Math.min(1, v) : 0; }
    say(stepIndex, 1);
    return out;
}

function routes(cities, pop = []) {
    const g = G, at = new Map(cities.map((t, i) => [t.c, i])), port = portMap(cities.filter(t => t.port).map(t => t.c));
    // (D&D fork: the roads grown first — the capitals' network, then everyone's — and travel on them made easy: the main
    // roads' ground counts for about a sixth, the others' for about half)
    g.roadF = null;
    const crowns = cities.map((t, i) => i).filter(i => cities[i].capital || cities[i].seat);
    const main = slimeRoads(crowns.map(i => cities[i].c), crowns.map(() => 1), 4);
    const all = slimeRoads(cities.map(t => t.c), cities.map((t, i) => (t.capital || t.seat ? 3 : 1) * Math.max(0.3, Math.sqrt((pop[i] || 1000) / 20000))), 5);
    g.roadF = new Float32Array(g.n).fill(1);
    for (let c = 0; c < g.n; c++) { const m = main?.[c] || 0, o = all?.[c] || 0; if (m || o) g.roadF[c] = 1 / (1 + 5 * m + 1.5 * o); }
    say(6);
    // (1: each city's costs to its nearest neighbours by travel — directed: the winds and currents)
    const cost = new Map(), key = (a, b) => a * 65536 + b;
    for (let a = 0; a < cities.length; a++) {
        let found = 0;
        search([[cities[a].c, 0, a]], 'travel', ROUTE_DAYS, port, (c) => {
            const b = at.get(c);
            if (b !== undefined && b !== a) { cost.set(key(a, b), g.dist[c]); found++; }
            return found >= NEAR;
        });
    }
    const C = (a, b) => cost.get(key(a, b)) ?? Infinity, sym = (a, b) => Math.min(C(a, b), C(b, a));
    // (2: a link is kept unless going round by a third city costs about as little)
    const kept = [];
    const pairs = new Set();
    for (const k of cost.keys()) { const a = Math.floor(k / 65536), b = k % 65536; pairs.add(a < b ? key(a, b) : key(b, a)); }
    for (const k of pairs) {
        const a = Math.floor(k / 65536), b = k % 65536, ab = sym(a, b);
        let redundant = false;
        for (let c = 0; c < cities.length && !redundant; c++) {
            if (c === a || c === b) continue;
            const ac = sym(a, c), cb = sym(c, b);
            if (ac < ab && cb < ab && ac + cb < 1.15 * ab) redundant = true;
        }
        if (!redundant) kept.push([a, b]);
    }
    // (every city linked at least once, where any route reaches it)
    const deg = new Array(cities.length).fill(0);
    for (const [a, b] of kept) { deg[a]++; deg[b]++; }
    for (let a = 0; a < cities.length; a++) {
        if (deg[a]) continue;
        let best = -1, bv = Infinity;
        for (let b = 0; b < cities.length; b++) if (b !== a && sym(a, b) < bv) { bv = sym(a, b); best = b; }
        if (best >= 0) { kept.push(a < best ? [a, best] : [best, a]); deg[a]++; deg[best]++; }
    }
    // (D&D fork: the capitals all joined by main roads — the cheapest tree over them, by travel on the roads)
    if (crowns.length > 1) {
        const inC = new Set(crowns), cc = new Map();
        for (const a of crowns) {
            let left = crowns.length - 1;
            search([[cities[a].c, 0, a]], 'travel', Infinity, port, (c) => { const b = at.get(c); if (b !== undefined && b !== a && inC.has(b)) { cc.set(key(a, b), g.dist[c]); if (!C(a, b) || C(a, b) === Infinity) cost.set(key(a, b), g.dist[c]); return --left <= 0; } return false; });
        }
        const edges = [];
        for (let i = 0; i < crowns.length; i++) for (let j = i + 1; j < crowns.length; j++) { const a = crowns[i], b = crowns[j], w = Math.min(cc.get(key(a, b)) ?? Infinity, cc.get(key(b, a)) ?? Infinity); if (w < Infinity) edges.push([w, a, b]); }
        edges.sort((x, y) => x[0] - y[0]);
        const rt = new Map(crowns.map(i => [i, i])), fr = (i) => { while (rt.get(i) !== i) i = rt.get(i); return i; };
        const have = new Set(kept.map(([a, b]) => key(a, b)));
        for (const [, a, b] of edges) { const ra = fr(a), rb = fr(b); if (ra === rb) continue; rt.set(ra, rb); const k2 = a < b ? key(a, b) : key(b, a); if (!have.has(k2)) { kept.push(a < b ? [a, b] : [b, a]); have.add(k2); } }
    }
    // (D&D fork: one network — no city, no group of cities, cut off: the groups joined, the nearest pair first, however
    // far — by sea when they must)
    const root = cities.map((_, i) => i), find = (i) => { while (root[i] !== i) i = root[i] = root[root[i]]; return i; };
    for (const [a, b] of kept) root[find(a)] = find(b);
    for (let guard = 0; guard < cities.length; guard++) {
        const groups = new Map();
        cities.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
        if (groups.size <= 1) break;
        // (from the smallest group, the cheapest way out to any other)
        const A = [...groups.values()].sort((x, y) => x.length - y.length)[0], inA = new Set(A);
        let hit = -1;
        search(A.map(i => [cities[i].c, 0, i]), 'travel', Infinity, port, (c) => { const b = at.get(c); if (b !== undefined && !inA.has(b)) { hit = b; return true; } return false; });
        if (hit < 0) { root[find(A[0])] = [...groups.keys()].find(r => r !== find(A[0])); continue; }   // (no way out at all: left as it is)
        const a = g.lab[cities[hit].c], d = g.dist[cities[hit].c];
        cost.set(key(a, hit), d);
        kept.push(a < hit ? [a, hit] : [hit, a]);
        root[find(a)] = find(hit);
    }
    // (3: each kept link traced from its cheaper end)
    const bySource = new Map();
    for (const [a, b] of kept) { const [s, t] = C(a, b) <= C(b, a) ? [a, b] : [b, a]; if (!bySource.has(s)) bySource.set(s, []); bySource.get(s).push(t); }
    const out = [];
    for (const [s, targets] of bySource) {
        const want = new Set(targets.map(t => cities[t].c));
        const far = Math.max(ROUTE_DAYS * 1.5, ...targets.map(t => 1.2 * Math.min(C(s, t), C(t, s)) + 1).filter(Number.isFinite));
        search([[cities[s].c, 0, s]], 'travel', far, port, (c) => { want.delete(c); return want.size === 0; });
        for (const t of targets) {
            const end = cities[t].c;
            if (!(g.dist[end] < Infinity)) continue;
            const { cells, modes } = traceTravel(end);
            out.push({ a: s, b: t, days: g.dist[end], cells, modes });
        }
    }
    // (D&D fork: every city at least one way on foot — by land alone, to the nearest city it can walk to)
    const onFoot = new Uint8Array(cities.length);
    for (const r of out) if (!r.modes.includes(2)) { onFoot[r.a] = 1; onFoot[r.b] = 1; }
    for (let a = 0; a < cities.length; a++) {
        if (onFoot[a]) continue;
        g.landOnly = true;
        let hit = -1;
        searchTravel([[cities[a].c, 0, a]], Infinity, port, (c) => { const b = at.get(c); if (b !== undefined && b !== a) { hit = b; return true; } return false; });
        if (hit >= 0) { const { cells, modes } = traceTravel(cities[hit].c); out.push({ a, b: hit, days: g.dist[cities[hit].c], cells, modes }); onFoot[a] = onFoot[hit] = 1; }
        g.landOnly = false;
    }
    // (and the page's edits: the routes taken away, the routes added by hand)
    const E = g.edits;
    if (E) {
        const gone = new Set((E.removed || []).map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)));
        for (let i = out.length - 1; i >= 0; i--) { const r = out[i]; if (gone.has(r.a < r.b ? `${r.a}-${r.b}` : `${r.b}-${r.a}`)) out.splice(i, 1); }
        for (const [a, b] of E.added || []) {
            if (!cities[a] || !cities[b]) continue;
            searchTravel([[cities[a].c, 0, a]], Infinity, port, (c) => c === cities[b].c);
            if (g.dist[cities[b].c] < Infinity) { const { cells, modes } = traceTravel(cities[b].c); out.push({ a, b, days: g.dist[cities[b].c], cells, modes, hand: true }); }
        }
    }
    return out;
}

/** A kingdom's share of each material's sources (0…1), where it holds any. */
function holdsOf(owner, k) {
    const out = {};
    for (const id of Object.keys(G.ores || {})) {
        const R = richCells(id); if (!R.length) continue;
        let n = 0; for (const c of R) if (owner[c] === k) n++;
        if (n) out[id] = n / R.length;
    }
    return out;
}

/** A traced route as the page takes it: its ends, days, way on the map ([u, v]), each step's way and the current. */
function routeOut(r) {
    const g = G;
    return { a: r.a, b: r.b, days: r.days, hand: !!r.hand, path: r.cells.map(c => [((c % g.GW) + 0.5) / g.GW, (((c / g.GW) | 0) + 0.5) / g.GH]), modes: r.modes,
        cur: r.cells.map(c => (g.land[c] || g.lake[c] ? null : [+g.curU[c].toFixed(3), +g.curV[c].toFixed(3)])) };
}
/** A route added by hand (D&D fork): the best way between two cities, on the roads as they are. */
function linkRoute(a, b, from, to, ports) {
    const g = G, port = portMap(ports);
    searchTravel([[from, 0, a]], Infinity, port, (c) => c === to);
    if (!(g.dist[to] < Infinity)) return null;
    const { cells, modes } = traceTravel(to);
    return routeOut({ a, b, days: g.dist[to], cells, modes, hand: true });
}

// ── the whole realm ──
function finishRealm(cities, owner, K, extra = {}) {
    say(3);
    const { kingdoms, cityPop } = describe(cities, owner, K);
    pickSeats(cities, cityPop, K);
    const R = routes(cities, cityPop);
    const g = G;
    return {
        owner, K,
        cities: cities.map((t, i) => ({ c: t.c, u: ((t.c % g.GW) + 0.5) / g.GW, v: (((t.c / g.GW) | 0) + 0.5) / g.GH, capital: !!t.capital, seat: !!t.seat, kingdom: t.kingdom, port: !!t.port, people: Math.round(cityPop[i]),
            river: g.riverQ[t.c] >= CROSS_Q, heightM: Math.round(g.heightM[t.c]), koppen: g.codes[g.koppen[t.c]] })),
        kingdoms: kingdoms.map((k, i) => ({ ...k, id: i, people: Math.round(k.people), food: Math.round(k.food), selfSufficiency: k.people > 0 ? k.food / k.people : 0, holds: holdsOf(owner, i) })),
        // (and on the water, the surface current under each step — the map's arrows: how far the ship must make up for it)
        routes: R.map(routeOut),
        ...extra,
    };
}

function autoRealm(K, N, prefs = [], mins = [], ports = []) {
    const { caps, owner } = grow(Math.max(1, K), prefs);
    say(2);
    const cities = placeCities(caps, owner, Math.max(caps.length, N), mins, prefs, ports);
    return finishRealm(cities, owner, caps.length, { unmet: G.unmet || [] });
}

/** The realm from cities placed by hand (`list`: [{u, v, capital}]): the kingdoms grown from their capitals, the rest
 *  each in the kingdom it stands in. */
function fixedRealm(list) {
    const g = G, cell = (u, v) => Math.min(g.GH - 1, Math.max(0, Math.floor(v * g.GH))) * g.GW + Math.min(g.GW - 1, Math.max(0, Math.floor(u * g.GW)));
    let pts = list.map(t => ({ c: cell(t.u, t.v), capital: !!t.capital }));
    // (a city in the sea moves to the nearest land)
    for (const t of pts) if (!g.land[t.c]) { let best = t.c, bd = Infinity; const y0 = (t.c / g.GW) | 0, x0 = t.c % g.GW; for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { const yy = y0 + dy; if (yy < 0 || yy >= g.GH) continue; const c = yy * g.GW + ((x0 + dx + g.GW) % g.GW); if (g.land[c] && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = c; } } t.c = best; }
    if (!pts.some(t => t.capital) && pts.length) pts[0].capital = true;
    const caps = pts.filter(t => t.capital).map(t => t.c);
    const owner = partition(caps, new Array(caps.length).fill(0));
    const cities = pts.map((t, i) => ({ c: t.c, capital: t.capital, seat: !!list[i].seat, kingdom: t.capital ? caps.indexOf(t.c) : owner[t.c] }));
    // (a city outside every kingdom joins the nearest capital's)
    for (const t of cities) if (t.kingdom < 0) { let best = 0, bd = Infinity; caps.forEach((c, k) => { const d = angKm(c, t.c); if (d < bd) { bd = d; best = k; } }); t.kingdom = best; }
    return finishRealm(cities, owner, caps.length, { order: list.map((_, i) => i) });
}
