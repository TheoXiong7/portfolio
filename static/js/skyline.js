/*
 * Contribution skyline: a year of GitHub activity as a heat map that folds up
 * into an isometric skyline, and back down again. Ported to vanilla JS from a
 * React/canvas component; the engine is the same, the chrome is ours.
 *
 * It is one scene, not two charts. Every day is a box on a grid; the 2D view
 * is that grid seen straight down, the 3D view is the same grid seen from the
 * corner. Switching views swings one camera between the two while each week's
 * bars rise (or settle) in a wave from the oldest week to the newest.
 *
 * Hover or tap a day for its count, arrow keys walk the grid, hover a legend
 * swatch to isolate that level, and in 3D drag to orbit (double-click resets).
 *
 * Reads `window.SKYLINE_DATA`, an array of { date: 'YYYY-MM-DD', count } set by
 * static/files/contributions.js (refreshed by scripts/contributions.py), which
 * must be loaded first. A script rather than fetched JSON so the page also works
 * opened straight from disk. The widget stays hidden if the data is missing.
 */
(function setupSkyline() {
    'use strict';

    const root = document.getElementById('skyline');
    if (!root) return;
    const canvas = root.querySelector('.skyline-canvas');
    const stage = root.querySelector('.skyline-stage');
    const tip = root.querySelector('.skyline-tip');
    const tipText = root.querySelector('.skyline-tip-text');
    const caption = root.querySelector('.skyline-caption');
    const legend = root.querySelector('.skyline-legend');
    const toggle = root.querySelector('.skyline-toggle');
    const live = root.querySelector('.skyline-live');
    if (!canvas || !stage || !tip || !tipText || !caption || !legend || !toggle || !live) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // -- pure maths ---------------------------------------------------------

    const DAY_MS = 86400000;
    const clamp01 = v => (v > 0 ? (v < 1 ? v : 1) : 0);
    const lerp = (a, b, t) => a + (b - a) * t;
    const easeInOutCubic = x => {
        const t = clamp01(x);
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    };
    const easeOutCubic = x => 1 - Math.pow(1 - clamp01(x), 3);
    const smoothstep = (a, b, x) => {
        const t = clamp01((x - a) / (b - a));
        return t * t * (3 - 2 * t);
    };

    const toKey = ms => new Date(ms).toISOString().slice(0, 10);
    const dayMs = v => {
        if (typeof v === 'number') return Math.floor(v / DAY_MS) * DAY_MS;
        if (typeof v === 'string') {
            const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
            if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
            v = new Date(v);
        }
        return Date.UTC(v.getFullYear(), v.getMonth(), v.getDate());
    };

    // 0 for an empty day, else 1-4 by quarters of `busy` (the 95th percentile day)
    const levelOf = (count, busy) => (count <= 0 ? 0 : busy <= 0 ? 4 : 1 + Math.min(3, Math.floor((count / busy) * 4)));

    // columns are weeks, rows are weekdays (row 0 = Sunday); ends on endMs, starts a year earlier
    const buildGrid = (data, endMs) => {
        const counts = new Map();
        for (const d of data) {
            if (!d || typeof d.date !== 'string') continue;
            const ms = dayMs(d.date);
            const c = Number(d.count);
            if (!Number.isFinite(ms) || !(c > 0) || !Number.isFinite(c)) continue;
            const k = toKey(ms);
            counts.set(k, (counts.get(k) || 0) + c);
        }
        let start = endMs - 364 * DAY_MS;
        start -= ((new Date(start).getUTCDay() + 7) % 7) * DAY_MS;
        const cells = [];
        for (let ms = start, i = 0; ms <= endMs; ms += DAY_MS, i++) {
            const date = toKey(ms);
            cells.push({ date, count: counts.get(date) || 0, level: 0, week: Math.floor(i / 7), day: i % 7 });
        }
        const nz = cells.map(c => c.count).filter(c => c > 0).sort((a, b) => a - b);
        const busy = nz.length ? nz[Math.floor(0.95 * (nz.length - 1))] : 0;
        for (const c of cells) c.level = levelOf(c.count, busy);
        return {
            cells,
            weeks: cells.length ? cells[cells.length - 1].week + 1 : 0,
            max: nz.length ? nz[nz.length - 1] : 0,
            total: cells.reduce((s, c) => s + c.count, 0),
        };
    };

    const monthLabels = (cells, weeks, locale) => {
        const fmt = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
        const out = [];
        let prev = -1;
        for (let w = 0; w < weeks; w++) {
            const c = cells[w * 7];
            if (!c) break;
            const m = +c.date.slice(5, 7);
            if (m !== prev) out.push({ week: w, label: fmt.format(dayMs(c.date)) });
            prev = m;
        }
        if (out.length > 1 && out[1].week - out[0].week < 3) out.shift();
        return out;
    };

    // box height in grid units: empty days are thin slabs, the busiest day ~7.6 cells tall
    const barHeight = (count, max) => (count > 0 && max > 0 ? 0.4 + Math.pow(count / max, 0.85) * 7.2 : 0.2);

    // share of the morph each bar spends waiting; the wave sweeps oldest week -> newest
    const WAVE = 0.42;
    const riseAt = (t, week, weeks, day) => {
        const d = (weeks > 1 ? week / (weeks - 1) : 0) * 0.36 + (day / 6) * 0.06;
        return easeOutCubic((t - d) / (1 - WAVE));
    };

    const YAW_3D = Math.PI / 4;
    const ELEV_3D = (34 * Math.PI) / 180;
    const YAW_RANGE = [(8 * Math.PI) / 180, (82 * Math.PI) / 180];
    const ELEV_RANGE = [(18 * Math.PI) / 180, (62 * Math.PI) / 180];

    // e=0 looks straight down (a plain heat map), e=1 is the isometric corner view
    const camera = (e, dYaw, dElev) => {
        const yaw = Math.min(YAW_RANGE[1], Math.max(0, lerp(0, YAW_3D + dYaw, e)));
        const elev = lerp(Math.PI / 2, Math.min(ELEV_RANGE[1], Math.max(ELEV_RANGE[0], ELEV_3D + dElev)), e);
        return { cs: Math.cos(yaw), sn: Math.sin(yaw), se: Math.sin(elev), ce: Math.cos(elev) };
    };
    const project = (c, x, y, z) => [x * c.cs - y * c.sn, (x * c.sn + y * c.cs) * c.se - z * c.ce];

    const mixRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const luminance = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

    // four colours per theme, lightest activity -> heaviest
    const PALETTE = {
        light: ['#c6e48b', '#7bc96f', '#239a3b', '#196127'],
        dark: ['#0e4429', '#006d32', '#26a641', '#39d353'],
    };

    const FG_FALLBACK = [10, 10, 10];
    const BG_FALLBACK = [255, 255, 255];

    // any CSS colour -> sRGB, by letting the browser paint it
    let probe = null;
    const toRGB = (color, fallback) => {
        if (!probe) {
            const c = document.createElement('canvas');
            c.width = c.height = 1;
            probe = c.getContext('2d', { willReadFrequently: true });
        }
        if (!probe) return fallback;
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = 'rgba(0,0,0,0)';
        probe.fillStyle = color;
        probe.fillRect(0, 0, 1, 1);
        const d = probe.getImageData(0, 0, 1, 1).data;
        if (d[3] < 8) return fallback;
        return [d[0], d[1], d[2]];
    };

    const rgbString = (r, g, b) => 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
    const rgbaString = (c, a) => 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a.toFixed(3) + ')';

    const pointInQuad = (p, o, x, y) => {
        let sign = 0;
        for (let k = 0; k < 4; k++) {
            const ax = p[o + k * 2];
            const ay = p[o + k * 2 + 1];
            const bx = p[o + ((k + 1) % 4) * 2];
            const by = p[o + ((k + 1) % 4) * 2 + 1];
            const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
            if (Math.abs(cross) < 1e-9) continue;
            const s = cross > 0 ? 1 : -1;
            if (sign === 0) sign = s;
            else if (s !== sign) return false;
        }
        return sign !== 0;
    };

    const quadPath = (p, o, r) => {
        if (r < 0.3) {
            ctx.moveTo(p[o], p[o + 1]);
            ctx.lineTo(p[o + 2], p[o + 3]);
            ctx.lineTo(p[o + 4], p[o + 5]);
            ctx.lineTo(p[o + 6], p[o + 7]);
            ctx.closePath();
            return;
        }
        ctx.moveTo((p[o + 6] + p[o]) / 2, (p[o + 7] + p[o + 1]) / 2);
        for (let k = 0; k < 4; k++) {
            const b = (k + 1) % 4;
            ctx.arcTo(p[o + k * 2], p[o + k * 2 + 1], p[o + b * 2], p[o + b * 2 + 1], r);
        }
        ctx.closePath();
    };

    // -- data -----------------------------------------------------------------

    const data = window.SKYLINE_DATA;
    if (Array.isArray(data) && data.length) start(data);

    // -- the widget -------------------------------------------------------------

    function start(data) {
        const locale = 'en-US';
        const DURATION = 1300;
        const dates = data.map(d => dayMs(d.date)).filter(Number.isFinite);
        const end = dates.length ? Math.max(...dates) : dayMs(new Date());
        const model = buildGrid(data, end);
        model.months = monthLabels(model.cells, model.weeks, locale);

        const nf = new Intl.NumberFormat(locale);
        const dfy = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        const dfl = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        const noun = n => (n === 1 ? 'contribution' : 'contributions');
        const describe = i => {
            const c = model.cells[i];
            if (!c) return '';
            return (c.count ? nf.format(c.count) + ' ' + noun(c.count) : 'No contributions') + ' on ' + dfl.format(dayMs(c.date));
        };

        caption.textContent = nf.format(model.total) + ' ' + noun(model.total) + ' in the last year';
        canvas.setAttribute('aria-label',
            nf.format(model.total) + ' GitHub ' + noun(model.total) + ' between ' +
            dfy.format(dayMs(model.cells[0].date)) + ' and ' + dfy.format(dayMs(model.cells[model.cells.length - 1].date)) +
            '. Use the arrow keys to read individual days.');

        const levelNames = ['No contributions', 'Light', 'Moderate', 'Heavy', 'Heaviest'];
        const swatches = levelNames.map((name, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('aria-label', 'Highlight ' + name.toLowerCase() + ' days');
            b.setAttribute('aria-pressed', 'false');
            b.title = name;
            b.addEventListener('mouseenter', () => setLegend(i));
            b.addEventListener('focus', () => setLegend(i));
            b.addEventListener('blur', () => setLegend(-1));
            b.addEventListener('click', () => setLegend(legendLevel === i ? -1 : i));
            legend.appendChild(b);
            return b;
        });
        legend.addEventListener('mouseleave', () => setLegend(-1));

        const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
        let reduced = reduceMq.matches;

        // morph: t is linear time 0 (2D) -> 1 (3D); the camera eases it, the bars wave it
        let t = 0;
        let target = 0;
        let goal = 1;
        // orbit offsets, eased toward their goals
        let yaw = 0;
        let elev = 0;
        let yawGoal = 0;
        let elevGoal = 0;
        // layout
        let W = 0;
        let H2 = 0;
        let H3 = 0;
        let Hmax = 0;
        let lastH = -1;
        let dpr = 1;
        let font = '10px sans-serif';
        // colours: [empty, l1, l2, l3, l4] x rgb, eased toward the goal
        const col = new Float32Array(15);
        const colGoal = new Float32Array(15);
        let colReady = false;
        let fg = FG_FALLBACK;
        let bg = BG_FALLBACK;
        // cells
        const n = model.cells.length;
        const weeks = model.weeks;
        const wk = new Float32Array(n);
        const dy = new Float32Array(n);
        const lv = new Uint8Array(n);
        const hgt = new Float32Array(n);
        const zs = new Float32Array(n);
        const hover = new Float32Array(n);
        const dim = new Float32Array(n);
        const polys = new Float32Array(n * 24);
        const faces = new Uint8Array(n);
        const order = Array.from({ length: n }, (_, i) => i);
        for (let i = 0; i < n; i++) {
            const c = model.cells[i];
            wk[i] = c.week;
            dy[i] = c.day;
            lv[i] = c.level;
            hgt[i] = barHeight(c.count, model.max);
        }
        const months = model.months;
        // interaction
        let hovered = -1;
        let pinned = -1;
        let activeIdx = -1;
        let legendLevel = -1;
        let tipW = 0;
        let raf = 0;
        let last = 0;

        const retheme = () => {
            const cs = getComputedStyle(document.documentElement);
            fg = toRGB(cs.getPropertyValue('--fg').trim(), FG_FALLBACK) || FG_FALLBACK;
            bg = toRGB(cs.getPropertyValue('--bg').trim(), null) || (luminance(fg) > 0.5 ? [10, 10, 10] : BG_FALLBACK);
            const isDark = luminance(bg) < 0.45;
            font = '400 10px ' + (getComputedStyle(root).fontFamily || 'sans-serif');
            const pal = PALETTE[isDark ? 'dark' : 'light'];
            const empty = mixRGB(bg, fg, isDark ? 0.11 : 0.075);
            const all = [empty].concat(pal.map(c => toRGB(c, FG_FALLBACK) || FG_FALLBACK));
            for (let k = 0; k < 5; k++) for (let ch = 0; ch < 3; ch++) colGoal[k * 3 + ch] = all[k][ch];
            if (!colReady || reduced) {
                col.set(colGoal);
                colReady = true;
            }
            all.forEach((c, k) => { swatches[k].style.background = rgbString(c[0], c[1], c[2]); });
            kick();
        };

        // projected extent of the scene for camera `cam`, with each bar at its current height
        const extent = (cam, e, full) => {
            const w = lerp(0.78, 0.9, e);
            const off = (1 - w) / 2;
            let minx = Infinity;
            let maxx = -Infinity;
            let miny = Infinity;
            let maxy = -Infinity;
            const add = (x, y, z) => {
                const p = project(cam, x, y, z);
                if (p[0] < minx) minx = p[0];
                if (p[0] > maxx) maxx = p[0];
                if (p[1] < miny) miny = p[1];
                if (p[1] > maxy) maxy = p[1];
            };
            for (let i = 0; i < n; i++) {
                const x0 = wk[i] + off;
                const y0 = dy[i] + off;
                const z = full ? hgt[i] * e : zs[i];
                add(x0, y0, z);
                add(x0 + w, y0, z);
                add(x0, y0 + w, z);
                add(x0 + w, y0 + w, 0);
                add(x0, y0 + w, 0);
                add(x0 + w, y0, 0);
            }
            // room for the month labels that run along the front edge in 3D
            add(0, 7 + 1.5 * e, 0);
            add(weeks, 7 + 1.5 * e, 0);
            return { minx, maxx, miny, maxy };
        };

        const relayout = () => {
            const w = Math.round(stage.clientWidth);
            if (!w) return;
            W = w;
            dpr = Math.min(2, window.devicePixelRatio || 1);
            const b2 = extent(camera(0, 0, 0), 0, true);
            H2 = 20 + 4 + ((b2.maxy - b2.miny) / (b2.maxx - b2.minx)) * (W - 4);
            const b3 = extent(camera(1, 0, 0), 1, true);
            const natural = ((b3.maxy - b3.miny) / (b3.maxx - b3.minx)) * (W - 40) + 40;
            H3 = Math.max(Math.min(natural, W * 0.72, 620), Math.min(natural, 240));
            Hmax = Math.ceil(Math.max(H2, H3));
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(Hmax * dpr);
            canvas.style.width = W + 'px';
            canvas.style.height = Hmax + 'px';
            lastH = -1;
            draw();
        };

        const draw = () => {
            if (!W) return;
            const e = easeInOutCubic(t);
            const cam = camera(e, yaw, elev);
            const Hc = lerp(H2, H3, e);
            if (Math.abs(Hc - lastH) > 0.2) {
                stage.style.height = Hc.toFixed(1) + 'px';
                lastH = Hc;
            }
            for (let i = 0; i < n; i++) zs[i] = riseAt(t, wk[i], weeks, dy[i]) * hgt[i];
            const b = extent(cam, e, false);
            const pad = lerp(2, 20, e);
            const left = pad;
            const top = pad + 20 * (1 - e);
            const aw = W - left - pad;
            const ah = Hc - top - pad;
            const bw = Math.max(1e-6, b.maxx - b.minx);
            const bh = Math.max(1e-6, b.maxy - b.miny);
            const s = Math.min(aw / bw, ah / bh);
            const ox = left + (aw - bw * s) / 2 - b.minx * s;
            const oy = top + (ah - bh * s) / 2 - b.miny * s;
            const { cs, sn, se, ce } = cam;
            const px = (x, y) => ox + (x * cs - y * sn) * s;
            const py = (x, y, z) => oy + ((x * sn + y * cs) * se - z * ce) * s;

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, Hmax);

            // painter's order: farthest first
            order.sort((a, c) => (wk[a] + 0.5) * sn + (dy[a] + 0.5) * cs - ((wk[c] + 0.5) * sn + (dy[c] + 0.5) * cs));

            const w = lerp(0.78, 0.9, e);
            const off = (1 - w) / 2;
            const radius = lerp(0.17, 0.03, e) * s;
            const outline = (1 - e) * 0.07;
            const lift = 0.7 * e;
            const ex = col[0];
            const ey = col[1];
            const ez = col[2];

            for (let k = 0; k < n; k++) {
                const i = order[k];
                const x0 = wk[i] + off;
                const y0 = dy[i] + off;
                const x1 = x0 + w;
                const y1 = y0 + w;
                const z = zs[i] + hover[i] * lift;
                const o = i * 24;
                // top
                polys[o] = px(x0, y0); polys[o + 1] = py(x0, y0, z);
                polys[o + 2] = px(x1, y0); polys[o + 3] = py(x1, y0, z);
                polys[o + 4] = px(x1, y1); polys[o + 5] = py(x1, y1, z);
                polys[o + 6] = px(x0, y1); polys[o + 7] = py(x0, y1, z);
                // +y face (left on screen)
                polys[o + 8] = px(x0, y1); polys[o + 9] = py(x0, y1, 0);
                polys[o + 10] = px(x1, y1); polys[o + 11] = py(x1, y1, 0);
                polys[o + 12] = polys[o + 4]; polys[o + 13] = polys[o + 5];
                polys[o + 14] = polys[o + 6]; polys[o + 15] = polys[o + 7];
                // +x face (right on screen)
                polys[o + 16] = px(x1, y0); polys[o + 17] = py(x1, y0, 0);
                polys[o + 18] = polys[o + 10]; polys[o + 19] = polys[o + 11];
                polys[o + 20] = polys[o + 4]; polys[o + 21] = polys[o + 5];
                polys[o + 22] = polys[o + 2]; polys[o + 23] = polys[o + 3];

                const tall = z * ce * s;
                let f = 0;
                if (tall > 0.35 && w * cs * s > 0.35) f |= 1;
                if (tall > 0.35 && w * sn * s > 0.35) f |= 2;
                faces[i] = f;

                const L = lv[i] * 3;
                let r = col[L];
                let g = col[L + 1];
                let bl = col[L + 2];
                const d = dim[i];
                if (d > 0.002) {
                    r += (ex - r) * 0.72 * d;
                    g += (ey - g) * 0.72 * d;
                    bl += (ez - bl) * 0.72 * d;
                }
                const hv = hover[i];
                if (hv > 0.002) {
                    const m = 0.16 * hv;
                    r += (fg[0] - r) * m;
                    g += (fg[1] - g) * m;
                    bl += (fg[2] - bl) * m;
                }
                if (f & 1) {
                    ctx.beginPath();
                    quadPath(polys, o + 8, 0);
                    ctx.fillStyle = rgbString(r * 0.84, g * 0.84, bl * 0.84);
                    ctx.fill();
                }
                if (f & 2) {
                    ctx.beginPath();
                    quadPath(polys, o + 16, 0);
                    ctx.fillStyle = rgbString(r * 0.68, g * 0.68, bl * 0.68);
                    ctx.fill();
                }
                ctx.beginPath();
                quadPath(polys, o, radius);
                ctx.fillStyle = rgbString(r, g, bl);
                ctx.fill();
                if (outline > 0.004) {
                    ctx.strokeStyle = rgbaString(fg, outline);
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
                if (hv > 0.02) {
                    ctx.strokeStyle = rgbaString(fg, 0.85 * hv);
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }
            }

            // month labels: along the top in 2D, along the front edge in 3D; they fade, never pop
            const muted = mixRGB(bg, fg, 0.55);
            ctx.font = font;
            const a2 = 1 - smoothstep(0, 0.4, e);
            const a3 = smoothstep(0.62, 1, e);
            if (a2 > 0.004) {
                ctx.fillStyle = rgbaString(muted, a2);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                let edge = -Infinity;
                for (const m of months) {
                    const x = px(m.week + off, -0.3);
                    const tw = ctx.measureText(m.label).width;
                    if (x < edge || x + tw > W) continue;
                    ctx.fillText(m.label, x, py(m.week + off, -0.3, 0) - 3);
                    edge = x + tw + 6;
                }
            }
            if (a3 > 0.004) {
                ctx.fillStyle = rgbaString(muted, a3);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                let edge = -Infinity;
                for (const m of months) {
                    const x = px(m.week + 0.5, 7.3);
                    const tw = ctx.measureText(m.label).width;
                    if (x < edge || x + tw > W) continue;
                    ctx.fillText(m.label, x, py(m.week + 0.5, 7.3, 0) + 2);
                    edge = x + tw + 10;
                }
            }

            // the tooltip rides the active cell through morphs and orbits
            if (activeIdx >= 0 && activeIdx < n) {
                const i = activeIdx;
                const z = zs[i] + hover[i] * lift;
                const tx = px(wk[i] + 0.5, dy[i] + 0.5);
                const ty = Math.min(py(wk[i] + off, dy[i] + off, z), py(wk[i] + off + w, dy[i] + off, z), py(wk[i] + off, dy[i] + off + w, z));
                const half = tipW / 2;
                const cx = Math.min(W - half - 2, Math.max(half + 2, tx));
                tip.style.transform = 'translate(' + (cx - half).toFixed(1) + 'px,' + (ty - 8).toFixed(1) + 'px) translateY(-100%)';
                tip.style.setProperty('--arrow', (tx - cx + half).toFixed(1) + 'px');
            }
        };

        const tick = now => {
            raf = 0;
            const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
            last = now;
            let moving = false;

            if (t !== target) {
                const step = reduced ? 1 : (dt * 1000) / DURATION;
                t = target > t ? Math.min(target, t + step) : Math.max(target, t - step);
                moving = true;
            }

            const ko = reduced ? 1 : 1 - Math.exp(-dt * 12);
            yaw += (yawGoal - yaw) * ko;
            elev += (elevGoal - elev) * ko;
            if (Math.abs(yawGoal - yaw) > 1e-4 || Math.abs(elevGoal - elev) > 1e-4) moving = true;
            else {
                yaw = yawGoal;
                elev = elevGoal;
            }

            const kc = reduced ? 1 : 1 - Math.exp(-dt * 7);
            for (let k = 0; k < 15; k++) {
                const d = colGoal[k] - col[k];
                if (Math.abs(d) > 0.4) {
                    col[k] += d * kc;
                    moving = true;
                } else col[k] = colGoal[k];
            }

            const kh = reduced ? 1 : 1 - Math.exp(-dt * 16);
            const kd = reduced ? 1 : 1 - Math.exp(-dt * 10);
            for (let i = 0; i < n; i++) {
                const hg = i === activeIdx ? 1 : 0;
                const dg = legendLevel >= 0 && lv[i] !== legendLevel ? 1 : 0;
                const h = hover[i];
                const d = dim[i];
                if (h !== hg) {
                    hover[i] = Math.abs(hg - h) < 0.003 ? hg : h + (hg - h) * kh;
                    moving = true;
                }
                if (d !== dg) {
                    dim[i] = Math.abs(dg - d) < 0.003 ? dg : d + (dg - d) * kd;
                    moving = true;
                }
            }

            draw();
            if (moving) raf = requestAnimationFrame(tick);
        };

        const kick = () => {
            if (raf) return;
            last = performance.now();
            raf = requestAnimationFrame(tick);
        };

        const setActive = i => {
            activeIdx = i;
            const c = model.cells[i];
            tip.classList.toggle('show', !!c);
            tip.setAttribute('aria-hidden', c ? 'false' : 'true');
            if (c) {
                tipText.replaceChildren();
                const strong = document.createElement('strong');
                strong.textContent = c.count ? nf.format(c.count) + ' ' + noun(c.count) : 'No contributions';
                const date = document.createElement('span');
                date.className = 'skyline-tip-date';
                date.textContent = ' on ' + dfy.format(dayMs(c.date));
                tipText.append(strong, date);
                tipW = tip.offsetWidth;
                draw();
            }
            kick();
        };

        // the active day is the hovered one, else the pinned one (tap, click or keyboard)
        const refreshActive = () => {
            const next = hovered >= 0 ? hovered : pinned;
            if (next !== activeIdx) setActive(next);
        };

        const setLegend = level => {
            if (level === legendLevel) return;
            legendLevel = level;
            swatches.forEach((b, i) => b.setAttribute('aria-pressed', i === level ? 'true' : 'false'));
            kick();
        };

        const hit = (x, y) => {
            for (let k = n - 1; k >= 0; k--) {
                const i = order[k];
                const o = i * 24;
                if (pointInQuad(polys, o, x, y)) return i;
                if (faces[i] & 1 && pointInQuad(polys, o + 8, x, y)) return i;
                if (faces[i] & 2 && pointInQuad(polys, o + 16, x, y)) return i;
            }
            return -1;
        };

        const local = ev => {
            const r = canvas.getBoundingClientRect();
            return [ev.clientX - r.left, ev.clientY - r.top];
        };

        const cursorFor = i => (target === 1 ? 'grab' : i >= 0 ? 'pointer' : 'default');

        let drag = null;

        const onDown = ev => {
            if (ev.button !== 0) return;
            const can = target === 1;
            drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, yaw: yawGoal, elev: elevGoal, moved: false, orbit: can, mouse: ev.pointerType === 'mouse' };
            if (can) {
                try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* capture is a nicety */ }
            }
        };

        const onMove = ev => {
            if (drag && drag.orbit && ev.pointerId === drag.id) {
                const dx = ev.clientX - drag.x;
                const dyy = ev.clientY - drag.y;
                if (drag.moved || Math.hypot(dx, dyy) > 4) {
                    drag.moved = true;
                    yawGoal = Math.min(YAW_RANGE[1] - YAW_3D, Math.max(YAW_RANGE[0] - YAW_3D, drag.yaw + dx * 0.006));
                    if (drag.mouse) elevGoal = Math.min(ELEV_RANGE[1] - ELEV_3D, Math.max(ELEV_RANGE[0] - ELEV_3D, drag.elev + dyy * 0.004));
                    canvas.style.cursor = 'grabbing';
                    hovered = -1;
                    refreshActive();
                    kick();
                    return;
                }
            }
            if (ev.pointerType !== 'mouse') return;
            const [x, y] = local(ev);
            const i = hit(x, y);
            if (i !== hovered) {
                hovered = i;
                refreshActive();
            }
            canvas.style.cursor = cursorFor(i);
        };

        const onUp = ev => {
            if (!drag || ev.pointerId !== drag.id) return;
            const wasMoved = drag.moved;
            drag = null;
            if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
            canvas.style.cursor = cursorFor(-1);
            if (wasMoved) return;
            const [x, y] = local(ev);
            const i = hit(x, y);
            pinned = i === pinned ? -1 : i;
            if (ev.pointerType !== 'mouse') hovered = -1;
            refreshActive();
        };

        const onCancel = () => { drag = null; };

        const onLeave = () => {
            if (drag) return;
            hovered = -1;
            refreshActive();
        };

        const onDbl = () => {
            yawGoal = 0;
            elevGoal = 0;
            kick();
        };

        const onKey = ev => {
            const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'];
            if (!keys.includes(ev.key)) return;
            ev.preventDefault();
            if (ev.key === 'Escape') {
                pinned = -1;
                hovered = -1;
                refreshActive();
                return;
            }
            let i = pinned >= 0 ? pinned : activeIdx >= 0 ? activeIdx : n - 1;
            if (pinned >= 0 || activeIdx >= 0) {
                if (ev.key === 'ArrowLeft') i -= 7;
                if (ev.key === 'ArrowRight') i += 7;
                if (ev.key === 'ArrowUp') i -= 1;
                if (ev.key === 'ArrowDown') i += 1;
                if (ev.key === 'Home') i = 0;
                if (ev.key === 'End') i = n - 1;
            }
            i = Math.max(0, Math.min(n - 1, i));
            pinned = i;
            hovered = -1;
            refreshActive();
            live.textContent = describe(i);
        };

        const onBlur = () => {
            pinned = -1;
            refreshActive();
        };

        const setTarget = () => {
            if (goal === target) return;
            target = goal;
            if (goal === 0) {
                yawGoal = 0;
                elevGoal = 0;
            }
            canvas.style.cursor = cursorFor(-1);
            canvas.style.touchAction = target === 1 ? 'pan-y' : 'auto';
            kick();
        };

        const setView = view => {
            goal = view === '3d' ? 1 : 0;
            root.classList.toggle('is-3d', goal === 1);
            toggle.querySelectorAll('button[data-view]').forEach(b => {
                b.setAttribute('aria-pressed', b.dataset.view === view ? 'true' : 'false');
            });
            setTarget();
        };

        toggle.addEventListener('click', ev => {
            const b = ev.target.closest('button[data-view]');
            if (b) setView(b.dataset.view);
        });

        // -- go ---------------------------------------------------------------------

        root.hidden = false;
        retheme();
        relayout();
        if (reduced) t = goal;
        setView('3d'); // the skyline rises out of the flat map on first paint

        new ResizeObserver(() => {
            if (Math.round(stage.clientWidth) !== W) relayout();
        }).observe(stage);

        new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        reduceMq.addEventListener('change', () => {
            reduced = reduceMq.matches;
            kick();
        });

        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp);
        canvas.addEventListener('pointercancel', onCancel);
        canvas.addEventListener('pointerleave', onLeave);
        canvas.addEventListener('dblclick', onDbl);
        canvas.addEventListener('keydown', onKey);
        canvas.addEventListener('blur', onBlur);
    }
})();
