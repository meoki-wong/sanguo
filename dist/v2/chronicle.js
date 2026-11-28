// 经略三国 3.0 — 战役明细战报卡 / 天下大势曲线 / 外交关系矩阵 / 疆域演进回放

import { activeTreaty, cityNameV2, factionColor, factionNameV2, formatCalendar } from "./constants.js";

function escHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[m]));
}

export function recordBattleReport(state, report) {
  if (!state) return;
  const list = (state.battleReports ??= []);
  const seq = (state._nextReportSeq = (state._nextReportSeq || list.length) + 1);
  const entry = {
    id: `br-${seq}-${state.turn}`,
    turn: state.turn,
    kind: report.kind || "field",
    title: report.title || "战阵交锋",
    location: report.location || "",
    locationKey: report.locationKey || null,
    winnerFaction: report.winnerFaction || null,
    attacker: report.attacker || {},
    defender: report.defender || {},
    factors: (report.factors || []).filter(Boolean),
    losses: report.losses || {},
    artTriggered: (report.artTriggered || []).filter(Boolean),
    shattered: Boolean(report.shattered),
  };
  state.battleReports = [entry, ...list].slice(0, 32);
  return entry;
}

export function recordHistorySnapshot(world, state) {
  if (!state || !state.cities) return;
  const list = (state.historySnapshots ??= []);
  const counts = {};
  const troops = {};
  const owners = {};
  for (const fk of Object.keys(state.factions || {})) {
    counts[fk] = 0;
    troops[fk] = 0;
  }
  for (const c of Object.values(state.cities)) {
    owners[c.key] = c.owner;
    counts[c.owner] = (counts[c.owner] || 0) + 1;
    troops[c.owner] = (troops[c.owner] || 0) + c.troops;
  }
  for (const a of state.armies || []) {
    if (a.troops > 0) {
      troops[a.faction] = (troops[a.faction] || 0) + a.troops;
    }
  }
  const snap = { turn: state.turn, counts, troops, owners };
  if (list.length && list[list.length - 1].turn === state.turn) {
    list[list.length - 1] = snap;
  } else {
    list.push(snap);
    if (list.length > 120) list.shift();
  }
}

export function renderPowerChartSvg(world, state, metric = "cities") {
  const snaps = state.historySnapshots?.length
    ? state.historySnapshots
    : [{
      turn: state.turn,
      counts: Object.fromEntries(Object.keys(state.factions).map((fk) => [fk, Object.values(state.cities).filter((c) => c.owner === fk).length])),
      troops: Object.fromEntries(Object.keys(state.factions).map((fk) => [fk, Object.values(state.cities).filter((c) => c.owner === fk).reduce((s, c) => s + c.troops, 0)])),
      owners: Object.fromEntries(Object.values(state.cities).map((c) => [c.key, c.owner])),
    }];

  const peakMap = {};
  for (const s of snaps) {
    const src = metric === "troops" ? s.troops : s.counts;
    for (const [fk, val] of Object.entries(src || {})) {
      peakMap[fk] = Math.max(peakMap[fk] || 0, val || 0);
    }
  }
  const tracked = Object.keys(peakMap)
    .filter((fk) => (peakMap[fk] || 0) > 0 || fk === state.player)
    .sort((a, b) => (b === state.player ? 1 : 0) - (a === state.player ? 1 : 0) || (peakMap[b] || 0) - (peakMap[a] || 0))
    .slice(0, 6);

  const W = 680;
  const H = 220;
  const pad = { l: 46, r: 18, t: 18, b: 30 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  let maxVal = metric === "troops" ? 6000 : 12;
  for (const s of snaps) {
    const src = metric === "troops" ? s.troops : s.counts;
    for (const fk of tracked) {
      maxVal = Math.max(maxVal, src?.[fk] || 0);
    }
  }
  maxVal = metric === "troops" ? Math.ceil(maxVal / 2000) * 2000 : Math.min(44, Math.max(12, Math.ceil(maxVal / 4) * 4));

  const grids = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
    const y = pad.t + plotH * (1 - frac);
    const val = Math.round(maxVal * frac);
    const txt = metric === "troops" && val >= 1000 ? `${(val / 1000).toFixed(0)}k` : `${val}`;
    return `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="rgba(224,179,84,0.14)" stroke-dasharray="3 3"/>
      <text x="${pad.l - 6}" y="${(y + 4).toFixed(1)}" fill="#b8ac90" font-size="10" text-anchor="end">${txt}</text>`;
  }).join("");

  const n = snaps.length;
  const xAt = (i) => (n <= 1 ? pad.l + plotW * 0.5 : pad.l + (i / (n - 1)) * plotW);
  const yAt = (v) => pad.t + plotH * (1 - Math.min(1, (v || 0) / Math.max(1, maxVal)));

  const lines = tracked.map((fk) => {
    const col = factionColor(fk);
    const pts = snaps.map((s, i) => {
      const val = (metric === "troops" ? s.troops : s.counts)?.[fk] || 0;
      return `${xAt(i).toFixed(1)},${yAt(val).toFixed(1)}`;
    });
    const lastPt = pts[pts.length - 1].split(",");
    const strokeW = fk === state.player ? 2.8 : 1.7;
    return `<polyline fill="none" stroke="${col}" stroke-width="${strokeW}" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(" ")}"/>
      <circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="${fk === state.player ? 4.2 : 3}" fill="${col}" stroke="#fff4dc" stroke-width="1"/>`;
  }).join("");

  const startLbl = formatCalendar(state.year, snaps[0].turn).short;
  const endLbl = formatCalendar(state.year, snaps[snaps.length - 1].turn).short;
  const legend = tracked.map((fk) => {
    const last = snaps[snaps.length - 1];
    const v = (metric === "troops" ? last.troops : last.counts)?.[fk] || 0;
    const valStr = metric === "troops" ? `${v.toLocaleString()}兵` : `${v}城`;
    return `<span class="v2-chart-leg"><i style="background:${factionColor(fk)}"></i>${escHtml(factionNameV2(world, state, fk))} (${valStr})</span>`;
  }).join("");

  return `
    <div class="v2-chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="v2-chart-svg" role="img" aria-label="天下势力消长折线图">
        <rect x="0" y="0" width="${W}" height="${H}" rx="8" fill="rgba(16,13,9,0.75)"/>
        ${grids}
        ${lines}
        <text x="${pad.l}" y="${H - 8}" fill="#b8ac90" font-size="10">${escHtml(startLbl)}</text>
        <text x="${W - pad.r}" y="${H - 8}" fill="#e0b354" font-size="10" text-anchor="end">${escHtml(endLbl)}</text>
      </svg>
      <div class="v2-chart-legend">${legend}</div>
    </div>`;
}

export function renderDiploMatrixHtml(world, state) {
  const activeFactions = Object.keys(state.factions || {})
    .map((fk) => ({
      fk,
      name: factionNameV2(world, state, fk),
      cities: Object.values(state.cities).filter((c) => c.owner === fk).length,
    }))
    .filter((f) => f.cities > 0)
    .sort((a, b) => (b.fk === state.player ? 1 : 0) - (a.fk === state.player ? 1 : 0) || b.cities - a.cities)
    .slice(0, 7);

  if (activeFactions.length < 2) {
    return `<p class="v2-muted">海内已无其余割据诸侯。</p>`;
  }

  return `
    <div class="v2-matrix-scroll">
      <table class="v2-matrix-table">
        <thead>
          <tr>
            <th>诸侯邦交</th>
            ${activeFactions.map((f) => `<th><span class="v2-fac-dot" style="background:${factionColor(f.fk)}"></span>${escHtml(f.name.slice(0, 3))}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${activeFactions.map((row) => `
            <tr>
              <th><span class="v2-fac-dot" style="background:${factionColor(row.fk)}"></span>${escHtml(row.name)} <small>(${row.cities})</small></th>
              ${activeFactions.map((col) => {
                if (row.fk === col.fk) return `<td class="self">—</td>`;
                const tr = activeTreaty(state, row.fk, col.fk);
                if (tr?.kind === "alliance") return `<td class="ally" title="同盟尚余 ${tr.expires - state.turn} 旬">盟</td>`;
                if (tr?.kind === "truce") return `<td class="truce" title="停战尚余 ${tr.expires - state.turn} 旬">停</td>`;
                return `<td class="war">战</td>`;
              }).join("")}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

export function renderReplayMapSvg(world, state, snapIndex = -1) {
  const snaps = state.historySnapshots?.length
    ? state.historySnapshots
    : [{
      turn: state.turn,
      counts: {},
      owners: Object.fromEntries(Object.values(state.cities).map((c) => [c.key, c.owner])),
    }];
  const idx = snapIndex < 0 ? snaps.length - 1 : Math.max(0, Math.min(snaps.length - 1, snapIndex));
  const snap = snaps[idx];
  const owners = snap.owners || {};
  const drawn = new Set();
  const roadLines = [];
  for (const c of world.cities) {
    for (const nb of c.links || []) {
      const k = [c.key, nb].sort().join(":");
      if (drawn.has(k)) continue;
      drawn.add(k);
      const nbCity = world.cities.find((w) => w.key === nb);
      if (!nbCity) continue;
      roadLines.push(`<line x1="${c.position[0]}" y1="${c.position[1]}" x2="${nbCity.position[0]}" y2="${nbCity.position[1]}" stroke="rgba(224,179,84,0.2)" stroke-width="1.2"/>`);
    }
  }

  const cityDots = world.cities.map((c) => {
    const ow = owners[c.key] || "han";
    const fill = factionColor(ow);
    const isPlayer = ow === state.player;
    const isMajor = isPlayer || c.links.length >= 4 || c.key === state.emperorCity;
    return `<g>
      <circle cx="${c.position[0]}" cy="${c.position[1]}" r="${isPlayer ? 7.2 : 5.4}" fill="${fill}" stroke="${isPlayer ? "#ffe28a" : "#f3ead3"}" stroke-width="${isPlayer ? 1.8 : 1}"/>
      ${isMajor ? `<text x="${c.position[0]}" y="${c.position[1] - 9}" fill="#e8dcc0" font-size="9" text-anchor="middle">${escHtml(c.name)}</text>` : ""}
    </g>`;
  }).join("");

  const cal = formatCalendar(state.year, snap.turn);
  const rankCounts = Object.entries(snap.counts || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([fk, n]) => `<span class="v2-chart-leg"><i style="background:${factionColor(fk)}"></i>${escHtml(factionNameV2(world, state, fk))} ${n}城</span>`)
    .join("");

  return `
    <div class="v2-replay-wrap">
      <div class="v2-replay-head">
        <strong>🕰️ ${escHtml(cal.label)}（第 ${snap.turn} 旬）</strong>
        <div class="v2-chart-legend">${rankCounts}</div>
      </div>
      <svg viewBox="40 20 710 460" class="v2-replay-svg" role="img" aria-label="九州疆域演进沙盘回放">
        <rect x="40" y="20" width="710" height="460" rx="10" fill="rgba(16,13,9,0.92)"/>
        ${roadLines.join("")}
        ${cityDots}
      </svg>
    </div>`;
}
