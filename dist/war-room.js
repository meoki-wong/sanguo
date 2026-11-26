// v18.0 — 「军机处」一键批阅减负 + 天下大势实时走势图 + 存档码导入导出
// 零外部依赖，纯 SVG 折线图与 UTF-8 安全 Base64 存档码。

import { BUILDING_CATALOG, cityBuildings, citySlotLimit, wonderForCity, builtWonderInCity } from "./buildings.js";
import { activeSiegeOn, isSupplyCut } from "./supply.js";
import { getTechState, TECH_TREE } from "./tech.js";
import { personaForFaction } from "./ai-persona.js";

/**
 * 扫描当前战局，生成「军机处」高优先级待办事项列表（按紧急度排序）
 */
export function collectWarRoomItems(world, era, state) {
  if (!state?.century) return [];
  const items = [];
  const player = state.player;
  const fac = state.factions?.[player] || { treasury: 0, grain: 0 };
  const cityNameOf = (k) => world?.cities?.find((c) => c.key === k)?.name || k;

  // 1. 危急告警：己方城池被断粮或被围城
  for (const [ck, city] of Object.entries(state.cities || {})) {
    if (city.owner !== player) continue;
    if (isSupplyCut(state, ck)) {
      items.push({
        id: `cut_${ck}`,
        priority: 100,
        severity: "urgent",
        tag: "断粮危急",
        title: `${cityNameOf(ck)}粮道被断！`,
        detail: `该城守军防战 -22% 且每季溃散，建议增援或修筑粮仓转运站。`,
        actionType: "focus_city",
        cityKey: ck,
        actionLabel: "查看城池",
      });
    }
    const siege = activeSiegeOn(state, ck);
    if (siege) {
      items.push({
        id: `siege_${ck}`,
        priority: 98,
        severity: "urgent",
        tag: "围城告急",
        title: `${cityNameOf(ck)}正遭敌军合围！`,
        detail: `敌偏师自${cityNameOf(siege.from)}筑垒围困，每季损兵毁防，请速派兵解围。`,
        actionType: "focus_city",
        cityKey: ck,
        actionLabel: "驰援解围",
      });
    }
  }

  // 2. 国库粮草预警
  if (fac.grain < 90) {
    items.push({
      id: "low_grain",
      priority: 92,
      severity: "urgent",
      tag: "军粮告急",
      title: `国库余粮仅 ${fac.grain}，即将影响出征`,
      detail: "建议在农业大城修筑「屯田营」或切换年度方略为稳农蓄粮。",
      actionType: "open_buildings",
      actionLabel: "修筑屯田",
    });
  }

  // 3. 可研习科技提醒
  const tech = getTechState(state);
  const affordableTech = TECH_TREE.find(
    (t) => !tech.unlocked.includes(t.id)
      && (!t.requires || tech.unlocked.includes(t.requires))
      && (tech.points ?? 0) >= t.costTp
      && fac.treasury >= t.costTreasury,
  );
  if (affordableTech) {
    items.push({
      id: `tech_${affordableTech.id}`,
      priority: 82,
      severity: "opportunity",
      tag: "兵技可研",
      title: `可立即研习「${affordableTech.name}」`,
      detail: `当前兵技点 ${tech.points} TP（需 ${affordableTech.costTp} TP / 金 ${affordableTech.costTreasury}）：${affordableTech.summary}`,
      actionType: "open_tech",
      actionLabel: "前往研习",
    });
  }

  // 4. 名城奇观可兴建提醒
  for (const [ck, city] of Object.entries(state.cities || {})) {
    if (city.owner !== player) continue;
    const wonder = wonderForCity(ck);
    if (wonder && !builtWonderInCity(state, ck) && fac.treasury >= wonder.costTreasury && fac.grain >= wonder.costGrain) {
      const exists = Object.values(state.saga?.buildings?.wonders || {}).includes(wonder.id);
      if (!exists) {
        items.push({
          id: `wonder_${ck}`,
          priority: 78,
          severity: "opportunity",
          tag: "奇观可筑",
          title: `${cityNameOf(ck)}可兴建地域奇观「${wonder.name}」`,
          detail: `${wonder.summary}（需金 ${wonder.costTreasury} / 粮 ${wonder.costGrain}）`,
          actionType: "focus_city",
          cityKey: ck,
          actionLabel: "前往兴建",
        });
      }
    }
  }

  // 5. 空闲城池设施槽位建议（最多提示 2 处最富余的城池）
  if (fac.treasury >= 60) {
    const candidates = Object.entries(state.cities || {})
      .filter(([ck, c]) => c.owner === player && cityBuildings(state, ck).length < citySlotLimit(ck))
      .sort((a, b) => (b[1].farm + b[1].commerce) - (a[1].farm + a[1].commerce))
      .slice(0, 2);
    for (const [ck] of candidates) {
      const built = cityBuildings(state, ck);
      const suggest = !built.includes("tuntian") ? BUILDING_CATALOG[0] : BUILDING_CATALOG[5];
      items.push({
        id: `build_${ck}`,
        priority: 65,
        severity: "info",
        tag: "城建良机",
        title: `${cityNameOf(ck)}仍有空闲设施槽（${built.length}/${citySlotLimit(ck)}）`,
        detail: `推荐兴建「${suggest.icon} ${suggest.name}」：${suggest.summary}`,
        actionType: "focus_city",
        cityKey: ck,
        actionLabel: "城建批阅",
      });
    }
  }

  // 6. 敌方重镇可发动细作/断粮机会
  const adj = new Map();
  for (const c of world?.cities || []) {
    adj.set(c.key, Array.isArray(c.links) ? [...c.links] : []);
  }
  for (const [a, b] of world?.roads || []) {
    if (adj.has(a) && !adj.get(a).includes(b)) adj.get(a).push(b);
    if (adj.has(b) && !adj.get(b).includes(a)) adj.get(b).push(a);
  }
  const ownedSet = new Set(Object.entries(state.cities || {}).filter(([, c]) => c.owner === player).map(([k]) => k));
  const enemyFront = Object.entries(state.cities || {})
    .filter(([ck, c]) => c.owner !== player && (adj.get(ck) || []).some((n) => ownedSet.has(n)))
    .sort((a, b) => b[1].troops - a[1].troops)[0];
  if (enemyFront && fac.treasury >= 45 && !isSupplyCut(state, enemyFront[0])) {
    const [ek, ec] = enemyFront;
    items.push({
      id: `intel_${ek}`,
      priority: 60,
      severity: "info",
      tag: "破敌良策",
      title: `边境强敌${cityNameOf(ek)}屯兵 ${ec.troops.toLocaleString()}`,
      detail: "可先派遣奇兵「断其粮道」或「策反内应」，再行围城或临阵破敌，事半功倍。",
      actionType: "focus_city",
      cityKey: ek,
      actionLabel: "谋划攻取",
    });
  }

  return items.sort((a, b) => b.priority - a.priority);
}

/**
 * 每季记录各主要势力的「天下大势」快照（城池/兵力/综合国力）
 */
export function recordHistorySnapshot(state) {
  if (!state?.century) return state;
  const next = structuredClone(state);
  if (!next.saga) next.saga = {};
  if (!Array.isArray(next.saga.historySeries)) next.saga.historySeries = [];

  const turn = next.turn ?? 1;
  // 防止同一回合重复记录
  if (next.saga.historySeries.some((s) => s.turn === turn)) return next;

  const stats = {};
  for (const fid of Object.keys(next.factions || {})) {
    stats[fid] = { cities: 0, troops: 0, power: 0 };
  }
  for (const city of Object.values(next.cities || {})) {
    if (!stats[city.owner]) stats[city.owner] = { cities: 0, troops: 0, power: 0 };
    stats[city.owner].cities += 1;
    stats[city.owner].troops += city.troops ?? 0;
  }
  for (const [fid, s] of Object.entries(stats)) {
    const fac = next.factions?.[fid] || { treasury: 0, grain: 0 };
    s.power = Math.round(s.cities * 120 + s.troops / 120 + (fac.treasury ?? 0) * 0.4 + (fac.grain ?? 0) * 0.25);
  }

  next.saga.historySeries.push({ turn, stats });
  // 最多保留最近 48 季（12 年）避免存档膨胀
  if (next.saga.historySeries.length > 48) {
    next.saga.historySeries = next.saga.historySeries.slice(-48);
  }
  return next;
}

const CHART_PALETTE = [
  "#c9923b", "#4e89ae", "#c8553d", "#588157", "#8e6c88", "#d4a373", "#3d5a80", "#e07a5f",
];

/**
 * 渲染纯 SVG「天下大势」多势力折线图（metric: "cities" | "troops" | "power"）
 */
export function renderTrendChartSvg(era, state, metric = "power") {
  const series = state?.saga?.historySeries || [];
  if (series.length === 0) {
    return `<div class="v18-empty">推进 1 季后将自动生成各势力走势曲线。</div>`;
  }

  const latest = series[series.length - 1].stats || {};
  const topFactions = Object.entries(latest)
    .filter(([, s]) => (s.cities ?? 0) > 0)
    .sort((a, b) => (b[1][metric] ?? 0) - (a[1][metric] ?? 0))
    .slice(0, 6)
    .map(([fid]) => fid);
  if (!topFactions.includes(state.player) && latest[state.player]) {
    topFactions.unshift(state.player);
  }

  const W = 540;
  const H = 210;
  const padL = 44;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let maxVal = 1;
  for (const snap of series) {
    for (const fid of topFactions) {
      const v = snap.stats?.[fid]?.[metric] ?? 0;
      if (v > maxVal) maxVal = v;
    }
  }

  const xOf = (i) => (series.length <= 1 ? padL + plotW / 2 : padL + (i / (series.length - 1)) * plotW);
  const yOf = (v) => padT + plotH - (v / maxVal) * plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((r) => {
    const y = (padT + plotH - r * plotH).toFixed(1);
    const val = Math.round(maxVal * r);
    const label = metric === "troops" && val >= 10000 ? `${(val / 10000).toFixed(1)}万` : String(val);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(180,150,100,0.18)" stroke-dasharray="3 3"/>
      <text x="${padL - 6}" y="${Number(y) + 3}" fill="#a89f91" font-size="10" text-anchor="end">${label}</text>`;
  }).join("");

  const polylines = topFactions.map((fid, idx) => {
    const color = fid === state.player ? "#f0b44c" : CHART_PALETTE[(idx + 1) % CHART_PALETTE.length];
    const width = fid === state.player ? 2.8 : 1.7;
    const pts = series.map((snap, i) => `${xOf(i).toFixed(1)},${yOf(snap.stats?.[fid]?.[metric] ?? 0).toFixed(1)}`).join(" ");
    const last = series[series.length - 1].stats?.[fid]?.[metric] ?? 0;
    const lx = xOf(series.length - 1).toFixed(1);
    const ly = yOf(last).toFixed(1);
    return `<polyline fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>
      <circle cx="${lx}" cy="${ly}" r="${fid === state.player ? 4 : 3}" fill="${color}"/>`;
  }).join("");

  const firstTurn = series[0].turn;
  const lastTurn = series[series.length - 1].turn;
  const xLabels = `<text x="${padL}" y="${H - 6}" fill="#a89f91" font-size="10">第${firstTurn}季</text>
    <text x="${W - padR}" y="${H - 6}" fill="#a89f91" font-size="10" text-anchor="end">第${lastTurn}季</text>`;

  const legend = topFactions.map((fid, idx) => {
    const color = fid === state.player ? "#f0b44c" : CHART_PALETTE[(idx + 1) % CHART_PALETTE.length];
    const fname = (Array.isArray(era?.factions) ? era.factions.find((f) => f.key === fid)?.name : era?.factions?.[fid]?.name) || fid;
    const persona = personaForFaction(fid);
    const val = latest[fid]?.[metric] ?? 0;
    const vText = metric === "troops" && val >= 10000 ? `${(val / 10000).toFixed(1)}万` : String(val);
    return `<span class="v18-legend-chip" style="border-color:${color}"><i style="background:${color}"></i>${fname}${fid === state.player ? "(我)" : ""} · ${vText} <small>${persona.badge}</small></span>`;
  }).join("");

  return `<svg class="v18-trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="天下大势走势图">${gridLines}${polylines}${xLabels}</svg>
    <div class="v18-trend-legend">${legend}</div>`;
}

/**
 * 战局存档码编码（SG18: + UTF-8 安全 Base64）
 */
export function encodeShareCode(backupJsonText) {
  const bytes = new TextEncoder().encode(backupJsonText);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return `SG18:${b64}`;
}

/**
 * 战局存档码解码
 */
export function decodeShareCode(codeText) {
  const clean = String(codeText || "").trim();
  if (!clean.startsWith("SG18:")) {
    throw new Error("存档码格式无效（应以 SG18: 开头）。");
  }
  const b64 = clean.slice(5).replace(/\s+/g, "");
  let bytes;
  if (typeof atob === "function") {
    const binary = atob(b64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } else {
    bytes = new Uint8Array(Buffer.from(b64, "base64"));
  }
  return new TextDecoder().decode(bytes);
}
