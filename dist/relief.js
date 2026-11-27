// v24.0 — 动态灾疫蔓延 & 太医署应急救灾体系
// 状态挂在 state.saga.disasters 下，兼容旧存档与非 century 模式。

export const DISASTER_KINDS = [
  { id: "plague", name: "时疫蔓延", icon: "☣️", summary: "城中瘟疫流行，每季损兵 10% 并向相邻城池扩散。" },
  { id: "locust", name: "旱蝗成灾", icon: "🦗", summary: "蝗虫蔽日，产粮锐减并向周边州郡蔓延。" },
  { id: "flood", name: "大水漫堤", icon: "🌊", summary: "江河决口，城防与农田受损并波及邻城。" },
];

export function listActiveDisasters(state) {
  const list = state?.saga?.disasters;
  return Array.isArray(list) ? list : [];
}

/**
 * 扑灭指定城池灾情（mode: "medical" 太医署防疫35金 | "grain" 官仓开赈40粮）
 */
export function dispatchDisasterRelief(world, state, cityKey, mode = "medical", actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可调动太医署/官仓救灾。" };
  const list = listActiveDisasters(state);
  const entry = list.find((d) => d.cityKey === cityKey);
  if (!entry) return { ok: false, reason: "该城目前并无活跃灾疫。" };

  const fac = state.factions?.[actor];
  if (mode === "medical") {
    if (!fac || fac.treasury < 35) return { ok: false, reason: "派遣太医署防疫需拨款金 35。" };
  } else {
    if (!fac || fac.grain < 40) return { ok: false, reason: "官仓开赈济民需拨粮 40。" };
  }

  const next = structuredClone(state);
  if (mode === "medical") next.factions[actor].treasury -= 35;
  else next.factions[actor].grain -= 40;
  next.saga.disasters = list.filter((d) => d.cityKey !== cityKey);
  next.factions[actor].morale = Math.min(100, (next.factions[actor].morale ?? 75) + 6);
  next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + 4);

  const cname = world?.cities?.find((c) => c.key === cityKey)?.name || cityKey;
  return {
    ok: true,
    state: next,
    summary: `【救灾安民】已对${cname}（${entry.name}）实施${mode === "medical" ? "太医署防疫" : "官仓开赈"}！灾情彻底扑灭，民心 +6、海内声望 +4！`,
  };
}

/**
 * 季度结算：已有灾疫沿道路向 1 座相邻城池动态蔓延，每 4 季随机生成 1 处新灾疫
 */
export function settleDisastersTurn(world, state) {
  if (!state?.century || !world) return { state, notes: [] };
  const next = structuredClone(state);
  if (!next.saga) next.saga = {};
  const list = Array.isArray(next.saga.disasters) ? [...next.saga.disasters] : [];
  const notes = [];
  const turn = next.turn ?? 1;
  const cityNameOf = (k) => world.cities.find((c) => c.key === k)?.name || k;

  // 都江堰竣工可阻断水患
  const hasDujiangyan = (next.saga.megaprojects?.dujiangyan ?? 0) >= 3;

  // 1. 结算已有灾疫并沿道路蔓延
  const newSpreads = [];
  const retained = [];
  for (const d of list) {
    if ((d.expires ?? 0) <= turn) continue;
    retained.push(d);
    const city = next.cities?.[d.cityKey];
    if (!city) continue;
    if (d.id === "plague") {
      const loss = Math.min(1200, Math.floor(city.troops * 0.08));
      city.troops = Math.max(600, city.troops - loss);
    } else if (d.id === "flood") {
      city.defense = Math.max(1, (city.defense ?? 1) - 1);
    }
    // 蔓延至 1 座未受灾的相邻城池（最多同时存在 3 处灾区）
    if (retained.length + newSpreads.length < 3) {
      const cMeta = world.cities.find((c) => c.key === d.cityKey);
      const nb = (cMeta?.links || []).find((k) => !retained.some((x) => x.cityKey === k) && !newSpreads.some((x) => x.cityKey === k));
      if (nb) {
        newSpreads.push({ ...d, cityKey: nb, expires: turn + 2 });
        notes.push(`【灾疫蔓延】${cityNameOf(d.cityKey)}之「${d.name}」已波及邻城${cityNameOf(nb)}，请速开赈防疫！`);
      }
    }
  }
  const merged = [...retained, ...newSpreads];

  // 2. 每 4 季在己方某城触发 1 处新灾疫（保证系统鲜活可交互）
  if (turn >= 2 && turn % 4 === 2 && merged.length < 2) {
    const owned = Object.keys(next.cities || {}).filter((k) => next.cities[k].owner === next.player && !merged.some((x) => x.cityKey === k));
    if (owned.length) {
      const kind = DISASTER_KINDS[turn % DISASTER_KINDS.length];
      if (!(kind.id === "flood" && hasDujiangyan)) {
        const ck = owned[turn % owned.length];
        merged.push({ id: kind.id, name: kind.name, icon: kind.icon, cityKey: ck, expires: turn + 3 });
        notes.push(`【灾疫急报】${cityNameOf(ck)}突发「${kind.icon}${kind.name}」，速赴朝堂调动太医署或官仓救灾！`);
      }
    }
  }

  next.saga.disasters = merged.slice(0, 3);
  return { state: next, notes };
}
