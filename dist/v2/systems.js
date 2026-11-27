// 经略三国 2.0 二期扩展系统：官道工事 / 天时实战奇计 / 名将羁绊与策反 / 筹码谈判台 / 二期智能 AI

import {
  CITY_SPECIALTIES, FORMATIONS_V2, FORT_CATALOG, NATIONAL_DECREES_V2, OFFICER_BONDS_V2,
  OFFICER_RIVALS_V2, STRATAGEM_CATALOG, TROOP_TYPES, citySpecialtyV2, edgeDisplayName,
  edgeKey, roadTerrain,
} from "./constants.js";
import {
  activeTreaty, armyWorldPosition, availableOfficersInCity, cityByKey,
  cityNameV2, createArmyRecord, factionNameV2, isHostileV2, returnOfficerHome,
} from "./engine.js";

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function hashStr(str = "") {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function ensurePhase2State(state) {
  if (!state) return state;
  state.forts ??= {};
  state.stratagemCooldowns ??= {};
  state.decrees ??= {};
  if (state.cities) {
    for (const c of Object.values(state.cities)) {
      if (!c.specialty || !CITY_SPECIALTIES[c.specialty]) {
        c.specialty = citySpecialtyV2(c.key);
      }
    }
  }
  if (Array.isArray(state.armies)) {
    for (const a of state.armies) {
      a.formation ??= "heyi";
      a.deputy ??= null;
      a.engagedWith ??= null;
      a.engageRounds ??= 0;
    }
  }
  return state;
}

export function hasDecree(state, faction, decreeId) {
  return Boolean(state?.decrees?.[faction]?.includes(decreeId));
}

export function enactDecree(world, state, decreeId) {
  const spec = NATIONAL_DECREES_V2[decreeId];
  if (!spec) throw new Error("未知国家方略国策。");
  const next = ensurePhase2State(structuredClone(state));
  const actor = next.player;
  const list = (next.decrees[actor] ??= []);
  if (list.includes(decreeId)) throw new Error(`已颁布国策「${spec.name}」。`);
  const cityCount = Object.values(next.cities).filter((c) => c.owner === actor).length;
  if (cityCount < spec.minCities) {
    throw new Error(`颁布「${spec.name}」至少需统领 ${spec.minCities} 座城池（当前 ${cityCount} 城）。`);
  }
  if ((next.factions[actor]?.treasury ?? 0) < spec.cost) {
    throw new Error(`颁布「${spec.name}」需国库 ${spec.cost} 钱。`);
  }
  next.factions[actor].treasury -= spec.cost;
  list.push(decreeId);
  if (decreeId === "imperial_edict") {
    next.factions[actor].morale = Math.max(next.factions[actor].morale, spec.moraleFloor || 75);
  }
  const ev = {
    turn: next.turn,
    kind: "system",
    faction: actor,
    text: `👑 颁布天下大政「${spec.icon} ${spec.name}」— ${spec.summary}`,
  };
  next.events = [...next.events, ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

export function edgeMidpoint(world, aKey, bKey) {
  const a = cityByKey(world, aKey)?.position;
  const b = cityByKey(world, bKey)?.position;
  if (!a || !b) return a || b || [390, 250];
  return [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
}

export function fortOnEdge(state, aKey, bKey) {
  if (!state?.forts || !aKey || !bKey) return null;
  return state.forts[edgeKey(aKey, bKey)] || null;
}

export function parseEdgeKey(eKey = "") {
  const parts = String(eKey).split(":");
  return parts.length === 2 ? parts : null;
}

// ===== 1. 官道关隘 / 箭楼 / 粮寨 / 水寨修筑 =====

export function canBuildFort(world, state, faction, fromKey, toKey, kind) {
  const spec = FORT_CATALOG[kind];
  if (!spec) return { ok: false, reason: "未知官道工事类型。" };
  const cA = cityByKey(world, fromKey);
  if (!cA || !cA.links.includes(toKey)) return { ok: false, reason: "两城间无直接相连的官道。" };
  const eKey = edgeKey(fromKey, toKey);
  if (state.forts?.[eKey]) return { ok: false, reason: "该处官道已建有防线工事。" };

  const sA = state.cities[fromKey];
  const sB = state.cities[toKey];
  const ownsA = sA?.owner === faction && !state.sieges?.[fromKey];
  const ownsB = sB?.owner === faction && !state.sieges?.[toKey];
  if (!ownsA && !ownsB) return { ok: false, reason: "须至少掌控官道一端且未遭围困之城池方能施工。" };

  if (spec.requiresRiver && roadTerrain(fromKey, toKey) !== "river") {
    return { ok: false, reason: "「江防水寨」仅限在江渡水路官道修建。" };
  }
  if ((state.factions[faction]?.treasury ?? 0) < spec.cost) {
    return { ok: false, reason: `筑造「${spec.name}」需国库 ${spec.cost} 钱。` };
  }
  return { ok: true, eKey };
}

export function buildFort(world, state, fromKey, toKey, kind, actor = state.player) {
  const next = ensurePhase2State(structuredClone(state));
  const check = canBuildFort(world, next, actor, fromKey, toKey, kind);
  if (!check.ok) throw new Error(check.reason);
  const spec = FORT_CATALOG[kind];
  next.factions[actor].treasury -= spec.cost;

  const [a, b] = [fromKey, toKey].sort();
  next.forts[check.eKey] = {
    edgeKey: check.eKey,
    a,
    b,
    kind,
    faction: actor,
    hp: spec.hpMax,
    hpMax: spec.hpMax,
    builtTurn: next.turn,
  };
  const label = edgeDisplayName(world, a, b);
  const pos = edgeMidpoint(world, a, b);
  const ev = {
    turn: next.turn,
    kind: "order",
    faction: actor,
    pos,
    text: `${spec.icon} ${factionNameV2(world, next, actor)}于「${label}」修筑${spec.name}完成！`,
  };
  next.events = [...next.events, ev].slice(-80);
  if (actor === next.player) next.lastTurnEvents = [ev];
  return next;
}

export function repairFort(world, state, eKey) {
  const next = ensurePhase2State(structuredClone(state));
  const fort = next.forts[eKey];
  if (!fort || fort.faction !== next.player) throw new Error("仅可修缮己方官道工事。");
  if (fort.hp >= fort.hpMax) throw new Error("该工事耐久已满，无需修缮。");
  if (next.factions[next.player].treasury < 8) throw new Error("抢修官道工事需国库 8 钱。");
  next.factions[next.player].treasury -= 8;
  fort.hp = Math.min(fort.hpMax, fort.hp + 95);
  return next;
}

export function demolishFort(state, eKey) {
  const next = ensurePhase2State(structuredClone(state));
  const fort = next.forts[eKey];
  if (!fort || fort.faction !== next.player) throw new Error("仅可拆除己方工事。");
  const spec = FORT_CATALOG[fort.kind];
  const refund = Math.round((spec?.cost ?? 16) * 0.3);
  next.factions[next.player].treasury += refund;
  delete next.forts[eKey];
  return next;
}

export function resolveFortsOnMove(world, next, army, events) {
  ensurePhase2State(next);
  army.blockedByFort = null;
  if (army.troops <= 0) return;
  const eKey = edgeKey(army.from, army.to);
  const fort = next.forts[eKey];
  if (!fort) return;

  const isFriendly = fort.faction === army.faction || activeTreaty(next, fort.faction, army.faction)?.kind === "alliance";
  const pos = edgeMidpoint(world, fort.a, fort.b);
  const passLabel = edgeDisplayName(world, fort.a, fort.b);

  if (isFriendly) {
    if (fort.kind === "depot") {
      army.grain = Math.min(20, army.grain + (FORT_CATALOG.depot.grainBoost || 4));
      army.morale = Math.min(100, army.morale + 3);
    }
    return;
  }

  if (!isHostileV2(next, fort.faction, army.faction)) return;

  if (fort.kind === "tower" && army.stance !== "besiege") {
    const xbBonus = hasDecree(next, fort.faction, "repeating_crossbow") ? 1.18 : 1;
    const dmg = Math.max(40, Math.round(army.troops * FORT_CATALOG.tower.arrowDmgPct * xbBonus));
    army.troops = Math.max(0, army.troops - dmg);
    army.morale = Math.max(10, army.morale - 6);
    events.push({
      turn: next.turn,
      kind: "fort_fire",
      faction: fort.faction,
      participants: [fort.faction, army.faction],
      pos,
      text: `🏹 ${passLabel}「连弩箭楼」居高齐射！${next.officers[army.officer]?.name || "过路敌军"}折损 ${dmg.toLocaleString()} 人。`,
    });
    return;
  }

  if (fort.kind === "water_fort" && army.troopType !== "navy" && army.stance !== "besiege") {
    const dmg = Math.max(40, Math.round(army.troops * 0.075));
    army.troops = Math.max(0, army.troops - dmg);
    army.morale = Math.max(10, army.morale - 6);
    if (army.progress > 0.65) army.progress = 0.65;
    events.push({
      turn: next.turn,
      kind: "fort_fire",
      faction: fort.faction,
      participants: [fort.faction, army.faction],
      pos,
      text: `⚓ ${passLabel}「江防水寨」楼船截渡，${next.officers[army.officer]?.name || "敌军"}强渡受阻并损 ${dmg.toLocaleString()} 人！`,
    });
    return;
  }

  if (fort.kind === "gate" && army.stance !== "besiege" && army.progress >= 0.48) {
    army.progress = 0.48;
    army.blockedByFort = eKey;
    const tSpec = TROOP_TYPES[army.troopType] || TROOP_TYPES.infantry;
    const fSpec = FORMATIONS_V2[army.formation || "heyi"] || FORMATIONS_V2.heyi;
    const thBonus = hasDecree(next, army.faction, "thunder_siege") ? 1.22 : 1;
    const fortDmg = Math.max(42, Math.round((army.troops / 18) * tSpec.siegeMult * fSpec.siegeMult * thBonus));
    const counterLoss = Math.max(35, Math.round(army.troops * 0.055));
    fort.hp = Math.max(0, fort.hp - fortDmg);
    army.troops = Math.max(0, army.troops - counterLoss);
    army.morale = Math.max(10, army.morale - 5);

    if (fort.hp <= 0) {
      delete next.forts[eKey];
      army.blockedByFort = null;
      events.push({
        turn: next.turn,
        kind: "fort_destroyed",
        faction: army.faction,
        participants: [army.faction, fort.faction],
        pos,
        text: `💥 ${next.officers[army.officer]?.name || "大军"}强攻拔除「${passLabel}关隘寨堡」，扫清官道！`,
      });
    } else {
      events.push({
        turn: next.turn,
        kind: "fort_blocked",
        faction: fort.faction,
        participants: [fort.faction, army.faction],
        pos,
        text: `🧱 ${next.officers[army.officer]?.name || "敌军"}遇「${passLabel}关隘寨堡」阻截！强攻损兵 ${counterLoss.toLocaleString()}，寨堡尚余耐久 ${fort.hp}。`,
      });
    }
  }
}

// ===== 2. 大地图「天时地利」实战奇计 =====

export function stratagemCooldownLeft(state, faction, kind) {
  const readyAt = state?.stratagemCooldowns?.[faction]?.[kind] ?? 0;
  return Math.max(0, readyAt - (state?.turn ?? 0));
}

function bestCaster(state, faction, casterKey = null) {
  if (casterKey && state.officers[casterKey]?.faction === faction) return state.officers[casterKey];
  return Object.values(state.officers)
    .filter((o) => o.faction === faction && !o.capturedBy)
    .sort((a, b) => (b.intellect + (b.traits.includes("fire") ? 18 : 0)) - (a.intellect + (a.traits.includes("fire") ? 18 : 0)))[0] || null;
}

export function castStratagem(world, state, { kind, targetType, targetId, casterKey = null }) {
  const next = ensurePhase2State(structuredClone(state));
  const spec = STRATAGEM_CATALOG[kind];
  if (!spec) throw new Error("未知战策奇计。");

  const fac = next.factions[next.player];
  if (!fac) throw new Error("玩家势力无效。");
  const cd = stratagemCooldownLeft(next, next.player, kind);
  if (cd > 0) throw new Error(`「${spec.name}」尚需冷却 ${cd} 旬方可再用。`);
  if (fac.treasury < spec.cost) throw new Error(`施展「${spec.name}」需国库 ${spec.cost} 钱。`);

  const caster = bestCaster(next, next.player, casterKey);
  const intelFactor = 1 + ((caster?.intellect ?? 72) - 70) * 0.008;
  let ev = null;

  if (kind === "fire_attack") {
    const wMult = next.weather?.key === "wind" ? 1.35 : next.weather?.key === "clear" && (next.weather?.fireMult ?? 1) > 1 ? 1.2 : (next.weather?.fireMult ?? 1);
    const fireTrait = caster?.traits?.includes("fire") ? 1.18 : 1;

    if (targetType === "fort") {
      const fort = next.forts[targetId];
      if (!fort || !isHostileV2(next, next.player, fort.faction)) throw new Error("请选择敌对官道工事施放火攻。");
      const dmg = Math.round(145 * intelFactor * wMult * fireTrait);
      fort.hp = Math.max(0, fort.hp - dmg);
      const pos = edgeMidpoint(world, fort.a, fort.b);
      const passName = edgeDisplayName(world, fort.a, fort.b);
      if (fort.hp <= 0) delete next.forts[targetId];
      ev = {
        turn: next.turn,
        kind: "stratagem_fire",
        faction: next.player,
        participants: [next.player, fort.faction],
        pos,
        text: `🔥 ${caster?.name || "智囊"}于${passName}借${next.weather?.name || "天时"}纵火焚营！敌寨损耐久 ${dmg}${fort.hp <= 0 ? "并轰然焚毁" : ""}！`,
      };
    } else {
      const army = next.armies.find((a) => a.id === targetId && a.troops > 0);
      if (!army || !isHostileV2(next, next.player, army.faction)) throw new Error("请选择敌对军团施放顺风火攻。");
      const pct = clamp(0.18 * intelFactor * wMult * fireTrait, 0.12, 0.34);
      const loss = Math.max(60, Math.round(army.troops * pct));
      army.troops = Math.max(0, army.troops - loss);
      army.grain = Math.max(0, army.grain - 8);
      army.morale = clamp(army.morale - 15, 10, 100);
      const pos = armyWorldPosition(world, army);
      const targetOff = next.officers[army.officer];
      if (army.troops < 120) {
        army.troops = 0;
        returnOfficerHome(next, army.officer, null);
      }
      ev = {
        turn: next.turn,
        kind: "stratagem_fire",
        faction: next.player,
        participants: [next.player, army.faction],
        pos,
        text: `🔥 「顺风火攻」奇效！${caster?.name || "谋臣"}火烧${targetOff?.name || "敌军"}连营，焚折 ${loss.toLocaleString()} 人并焚粮 8 石！`,
      };
    }
  } else if (kind === "flood_attack") {
    const wMult = next.weather?.key === "flood" ? 1.48 : 1.0;
    if (targetType === "city") {
      const city = next.cities[targetId];
      if (!city || !isHostileV2(next, next.player, city.owner)) throw new Error("请选择临江敌城施展决水淹城。");
      const links = cityByKey(world, targetId)?.links || [];
      const nearRiver = links.some((nb) => roadTerrain(targetId, nb) === "river");
      if (!nearRiver) throw new Error(`「${cityNameV2(world, targetId)}」地处内陆旱路，未临大江渡口，无法决水。`);
      const wallDmg = Math.round(135 * intelFactor * wMult);
      const troopDmg = Math.max(50, Math.round(city.troops * 0.14 * wMult));
      city.wall = Math.max(0, city.wall - wallDmg);
      city.troops = Math.max(0, city.troops - troopDmg);
      city.foodReserve = Math.max(0, city.foodReserve - 18);
      city.morale = clamp(city.morale - 12, 10, 100);
      ev = {
        turn: next.turn,
        kind: "stratagem_flood",
        faction: next.player,
        participants: [next.player, city.owner],
        city: targetId,
        pos: cityByKey(world, targetId)?.position,
        text: `🌊 决堤七军！「${cityNameV2(world, targetId)}」遭江洪倒灌，城防骤崩 -${wallDmg}、守军折损 ${troopDmg.toLocaleString()}！`,
      };
    } else {
      const army = next.armies.find((a) => a.id === targetId && a.troops > 0);
      if (!army || !isHostileV2(next, next.player, army.faction)) throw new Error("请选择临江渡河敌军施放水计。");
      const nearRiver = roadTerrain(army.from, army.to) === "river"
        || (cityByKey(world, army.targetCity)?.links || []).some((nb) => roadTerrain(army.targetCity, nb) === "river");
      if (!nearRiver) throw new Error("目标敌军不在水网渡口，无法决水阻击。");
      const loss = Math.max(60, Math.round(army.troops * 0.19 * intelFactor * wMult));
      army.troops = Math.max(0, army.troops - loss);
      army.morale = clamp(army.morale - 14, 10, 100);
      army.reorgDekads = Math.max(army.reorgDekads, 1);
      ev = {
        turn: next.turn,
        kind: "stratagem_flood",
        faction: next.player,
        participants: [next.player, army.faction],
        pos: armyWorldPosition(world, army),
        text: `🌊 「决水阻击」！大水漫灌冲散${next.officers[army.officer]?.name || "敌军"}，溺损 ${loss.toLocaleString()} 人并滞留一旬！`,
      };
    }
  } else if (kind === "raid_supply") {
    const army = next.armies.find((a) => a.id === targetId && a.troops > 0);
    if (!army || !isHostileV2(next, next.player, army.faction)) throw new Error("请选择外出行军或围城之敌军发动乌巢劫粮。");
    const hasCav = Object.values(next.officers).some((o) => o.faction === next.player && !o.capturedBy && (o.traits.includes("cavalry") || o.traits.includes("ambush")));
    const bonus = hasCav ? 1.25 : 1.0;
    const loss = Math.max(40, Math.round(army.troops * 0.08 * bonus));
    army.troops = Math.max(0, army.troops - loss);
    army.grain = 0;
    army.supplyCut = true;
    army.morale = clamp(army.morale - 16, 10, 100);
    ev = {
      turn: next.turn,
      kind: "stratagem_raid",
      faction: next.player,
      participants: [next.player, army.faction],
      pos: armyWorldPosition(world, army),
      text: `⚡ 奇袭乌巢！我军轻骑绕后烧空${next.officers[army.officer]?.name || "敌军"}全部随军粮草并断其粮道！`,
    };
  }

  fac.treasury -= spec.cost;
  next.stratagemCooldowns[next.player] ??= {};
  next.stratagemCooldowns[next.player][kind] = next.turn + spec.cooldown;
  next.armies = next.armies.filter((a) => a.troops > 0);
  if (ev) {
    next.events = [...next.events, ev].slice(-80);
    next.lastTurnEvents = [ev];
  }
  return next;
}

// ===== 3. 名将羁绊宿敌 & 细作离间策反 =====

export function evaluateBondBonus(state, officerKey, allyKeys = [], enemyKeys = []) {
  const off = state?.officers?.[officerKey];
  if (!off) return { atkMult: 1, defMult: 1, lossMult: 1, labels: [] };

  const allyNames = new Set(allyKeys.filter((k) => k && k !== officerKey).map((k) => state.officers[k]?.name).filter(Boolean));
  const enemyNames = new Set(enemyKeys.map((k) => state.officers[k]?.name).filter(Boolean));

  let atk = 0;
  let def = 0;
  let loss = 1;
  const labels = [];

  for (const bond of OFFICER_BONDS_V2) {
    if (!bond.members.includes(off.name)) continue;
    if (bond.members.some((m) => m !== off.name && allyNames.has(m))) {
      atk += bond.atkBonus;
      def += bond.defBonus;
      loss = Math.min(loss, bond.lossMult);
      labels.push(bond.name);
    }
  }

  for (const [r1, r2] of OFFICER_RIVALS_V2) {
    if ((off.name === r1 && enemyNames.has(r2)) || (off.name === r2 && enemyNames.has(r1))) {
      atk += 0.12;
      labels.push("宿敌死战");
      break;
    }
  }

  return {
    atkMult: clamp(1 + atk, 1, 1.32),
    defMult: clamp(1 + def, 1, 1.28),
    lossMult: clamp(loss, 0.8, 1),
    labels,
  };
}

export function cityBonds(state, cityKey) {
  const city = state?.cities?.[cityKey];
  if (!city) return [];
  const inCity = Object.values(state.officers).filter((o) => o.city === cityKey && !o.armyId && !o.capturedBy && o.faction === city.owner);
  const names = new Set(inCity.map((o) => o.name));
  const active = [];
  for (const bond of OFFICER_BONDS_V2) {
    const matched = bond.members.filter((m) => names.has(m));
    if (matched.length >= 2) active.push({ ...bond, matched });
  }
  return active;
}

export function sowDiscord(world, state, targetCityKey, targetOfficerKey) {
  const next = ensurePhase2State(structuredClone(state));
  const city = next.cities[targetCityKey];
  const off = next.officers[targetOfficerKey];
  if (!city || !off || !isHostileV2(next, next.player, off.faction)) {
    throw new Error("请选择敌对城池中的守臣发动离间。");
  }
  if (next.factions[next.player].treasury < 12) throw new Error("派遣细作散播流言离间需 12 钱。");

  const caster = bestCaster(next, next.player);
  const drop = clamp(Math.round(15 + ((caster?.intellect ?? 70) - 65) * 0.25), 12, 24);
  next.factions[next.player].treasury -= 12;
  off.loyalty = clamp(off.loyalty - drop, 15, 100);
  city.morale = clamp(city.morale - 7, 15, 100);

  const ev = {
    turn: next.turn,
    kind: "diplomacy",
    city: targetCityKey,
    pos: cityByKey(world, targetCityKey)?.position,
    text: `🕵️ 细作潜入「${cityNameV2(world, targetCityKey)}」巧行离间！${off.name}忠义骤降 -${drop}（当前 ${off.loyalty}）。`,
  };
  next.events = [...next.events, ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

export function bribeDefection(world, state, targetCityKey, targetOfficerKey) {
  const next = ensurePhase2State(structuredClone(state));
  const city = next.cities[targetCityKey];
  const off = next.officers[targetOfficerKey];
  if (!city || !off || !isHostileV2(next, next.player, off.faction)) {
    throw new Error("目标并非敌对在职武将。");
  }
  if (off.name === next.factions[off.faction]?.name) {
    throw new Error("敌国主公不可被重金策反。");
  }
  if (off.loyalty >= 75) {
    throw new Error(`${off.name}忠义尚坚（${off.loyalty}），需先「细作离间」使其忠义降至 75 以下！`);
  }
  if (next.factions[next.player].treasury < 30) throw new Error("重金策反敌将需国库 30 钱。");

  next.factions[next.player].treasury -= 30;
  const caster = bestCaster(next, next.player);
  const prob = clamp(Math.round((78 - off.loyalty) * 2.5 + ((caster?.intellect ?? 70) - 70) * 0.5), 25, 100);
  const roll = hashStr(`${next.turn}:${off.key}:${off.loyalty}:defect`) % 100;

  if (roll >= prob) {
    off.loyalty = clamp(off.loyalty - 8, 15, 100);
    const failEv = {
      turn: next.turn,
      kind: "diplomacy",
      city: targetCityKey,
      text: `策反「${off.name}」尚差火候（成功率 ${prob}%），但其内心愈发动摇（忠 ${off.loyalty}）。`,
    };
    next.events = [...next.events, failEv].slice(-80);
    next.lastTurnEvents = [failEv];
    return next;
  }

  const origFaction = off.faction;
  const canFlipCity = (city.commander === off.key || !city.commander) && off.loyalty <= 52 && city.troops <= 1850;
  if (city.commander === off.key) city.commander = null;
  if (city.governor === off.key) city.governor = null;

  off.faction = next.player;
  off.armyId = null;
  off.loyalty = 76;

  let text;
  if (canFlipCity) {
    city.owner = next.player;
    city.commander = off.key;
    city.morale = 68;
    delete next.sieges[targetCityKey];
    text = `🏳️ 举城献降！「${off.name}」感召内应，率「${cityNameV2(world, targetCityKey)}」兵马全城归顺！`;
  } else {
    const defectedTroops = Math.round(city.troops * 0.28);
    city.troops = Math.max(200, city.troops - defectedTroops);
    const recvCity = Object.values(next.cities).find((c) => c.owner === next.player) || null;
    if (recvCity) {
      off.city = recvCity.key;
      recvCity.troops += defectedTroops;
    }
    text = `🏳️ 阵前倒戈！${factionNameV2(world, next, origFaction)}大将「${off.name}」携 ${defectedTroops.toLocaleString()} 人弃暗投明，归入我朝！`;
  }

  const ev = {
    turn: next.turn,
    kind: "defection",
    faction: next.player,
    participants: [next.player, origFaction],
    city: targetCityKey,
    pos: cityByKey(world, targetCityKey)?.position,
    text,
  };
  next.events = [...next.events, ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

// ===== 4. 多边筹码外交谈判台 & 驱虎吞狼 =====

export function evaluateDeal(world, state, targetFaction, deal = {}) {
  const rival = state.factions?.[targetFaction];
  if (!rival || targetFaction === state.player) {
    return { ok: false, accepted: false, pct: 0, score: 0, threshold: 50, reasons: ["无效谈判势力"] };
  }

  const myCities = Object.values(state.cities).filter((c) => c.owner === state.player);
  const theirCities = Object.values(state.cities).filter((c) => c.owner === targetFaction);
  const myTroops = myCities.reduce((s, c) => s + c.troops, 0);
  const theirTroops = theirCities.reduce((s, c) => s + c.troops, 0);
  if (!theirCities.length) {
    return { ok: false, accepted: false, pct: 0, score: 0, threshold: 50, reasons: ["对方已无城池"] };
  }

  const gold = Math.max(0, Math.round(Number(deal.gold) || 0));
  const grain = Math.max(0, Math.round(Number(deal.grain) || 0));
  const type = deal.type || "truce";
  const treaty = activeTreaty(state, state.player, targetFaction);

  const baseDiff = {
    truce: 45,
    alliance: treaty?.kind === "truce" ? 58 : 76,
    trade_grain_gold: 38,
    peace_cede: 35,
    instigate_war: 64,
  };
  const threshold = baseDiff[type] ?? 50;
  let score = 20;
  const reasons = [];

  const ratio = myTroops / Math.max(600, theirTroops);
  if (ratio >= 1.45) {
    score += 22;
    reasons.push("我方军威强盛 (+22)");
  } else if (ratio <= 0.72) {
    score -= 10;
    reasons.push("彼强我弱 (-10)");
  }

  if (treaty?.kind === "alliance") {
    score += 18;
    reasons.push("盟好互信 (+18)");
  } else if (treaty?.kind === "truce") {
    score += 8;
    reasons.push("旧约尚存 (+8)");
  }

  if (hasDecree(state, state.player, "imperial_edict")) {
    score += 18;
    reasons.push("挟天子令威望 (+18)");
  }

  if (gold > 0) {
    const gPts = Math.round(gold * 0.95);
    score += gPts;
    reasons.push(`赠银 ${gold} 钱 (+${gPts})`);
  }
  if (grain > 0) {
    const grPts = Math.round(grain * 0.55);
    score += grPts;
    reasons.push(`输粮 ${grain} 石 (+${grPts})`);
  }

  if (deal.cedeCityKey && state.cities[deal.cedeCityKey]?.owner === state.player && myCities.length >= 2) {
    score += 62;
    reasons.push(`割让「${cityNameV2(world, deal.cedeCityKey)}」 (+62)`);
  }
  if (deal.releaseCaptiveKey && state.captives?.some((c) => c.officer === deal.releaseCaptiveKey && c.origFaction === targetFaction)) {
    score += 42;
    reasons.push(`归还俘将 (+42)`);
  }

  if (type === "instigate_war" && deal.thirdFactionKey) {
    const tName = factionNameV2(world, state, deal.thirdFactionKey);
    const borders = Object.values(state.cities).some((c) => c.owner === targetFaction
      && cityByKey(world, c.key).links.some((nb) => state.cities[nb]?.owner === deal.thirdFactionKey));
    if (borders) {
      score += 14;
      reasons.push(`与「${tName}」接壤积怨 (+14)`);
    } else {
      score -= 35;
      reasons.push(`未与「${tName}」接壤难以出兵 (-35)`);
    }
  }

  const pct = clamp(Math.round((score / Math.max(1, threshold)) * 100), 5, 100);
  return {
    ok: true,
    score,
    threshold,
    accepted: score >= threshold,
    pct,
    reasons,
  };
}

export function proposeDeal(world, state, targetFaction, deal = {}) {
  const next = ensurePhase2State(structuredClone(state));
  const evRes = evaluateDeal(world, next, targetFaction, deal);
  if (!evRes.ok) throw new Error(evRes.reasons[0] || "谈判对象无效。");

  const gold = Math.max(0, Math.round(Number(deal.gold) || 0));
  const grain = Math.max(0, Math.round(Number(deal.grain) || 0));
  const pFac = next.factions[next.player];
  const rFac = next.factions[targetFaction];
  if (pFac.treasury < gold) throw new Error(`国库不足 ${gold} 钱。`);
  if (pFac.grain < grain) throw new Error(`军粮不足 ${grain} 石。`);
  if (!evRes.accepted) throw new Error(`对方使臣回绝（接受度 ${evRes.pct}% < 100%），请加码钱粮、俘将或边城筹码！`);

  pFac.treasury -= gold;
  pFac.grain -= grain;
  rFac.treasury += gold;
  rFac.grain += grain;

  if (deal.cedeCityKey && next.cities[deal.cedeCityKey]?.owner === next.player) {
    const city = next.cities[deal.cedeCityKey];
    city.owner = targetFaction;
    city.governor = null;
    city.commander = null;
    delete next.sieges[city.key];
    for (const o of Object.values(next.officers)) {
      if (o.city === city.key && o.faction === next.player && !o.armyId && !o.capturedBy) {
        returnOfficerHome(next, o.key, null);
      }
    }
  }
  if (deal.releaseCaptiveKey) {
    const idx = next.captives.findIndex((c) => c.officer === deal.releaseCaptiveKey);
    if (idx >= 0) {
      const off = next.officers[deal.releaseCaptiveKey];
      if (off) {
        off.faction = targetFaction;
        off.capturedBy = null;
        off.city = Object.values(next.cities).find((c) => c.owner === targetFaction)?.key || null;
      }
      next.captives.splice(idx, 1);
    }
  }

  let msg = "";
  if (deal.type === "truce") {
    next.treaties = next.treaties.filter((t) => !(t.sides.includes(next.player) && t.sides.includes(targetFaction)));
    next.treaties.push({ kind: "truce", sides: [next.player, targetFaction].sort(), expires: next.turn + 18 });
    msg = `🤝 谈判缔约！与「${rFac.name}」达成停战和约（18 旬）。`;
  } else if (deal.type === "alliance") {
    next.treaties = next.treaties.filter((t) => !(t.sides.includes(next.player) && t.sides.includes(targetFaction)));
    next.treaties.push({ kind: "alliance", sides: [next.player, targetFaction].sort(), expires: next.turn + 36 });
    msg = `📜 会盟定鼎！与「${rFac.name}」结为深盟（借道协同，36 旬有效）！`;
  } else if (deal.type === "trade_grain_gold") {
    const gainGrain = Math.max(20, Math.round(gold * 1.45));
    pFac.grain += gainGrain;
    msg = `🌾 商贸换粮成功：支金 ${gold} 钱，自「${rFac.name}」购入军粮 ${gainGrain} 石！`;
  } else if (deal.type === "peace_cede") {
    next.treaties = next.treaties.filter((t) => !(t.sides.includes(next.player) && t.sides.includes(targetFaction)));
    next.treaties.push({ kind: "truce", sides: [next.player, targetFaction].sort(), expires: next.turn + 27 });
    msg = `🕊️ 割城换和生效：与「${rFac.name}」休兵 27 旬，稳固他线防区。`;
  } else if (deal.type === "instigate_war") {
    const third = deal.thirdFactionKey;
    if (!third || third === next.player || third === targetFaction) throw new Error("请选择要挑拨交战的第三方诸侯。");
    next.treaties = next.treaties.filter((t) => !(t.sides.includes(targetFaction) && t.sides.includes(third)));
    // Immediately dispatch a real border attack army from targetFaction -> thirdFactionKey!
    const launchCity = Object.values(next.cities)
      .filter((c) => c.owner === targetFaction && !next.sieges[c.key] && c.troops >= 900)
      .find((c) => cityByKey(world, c.key).links.some((nb) => next.cities[nb]?.owner === third));
    const thirdTargetKey = launchCity
      ? cityByKey(world, launchCity.key).links.find((nb) => next.cities[nb]?.owner === third)
      : null;
    const off = launchCity ? availableOfficersInCity(next, launchCity.key, targetFaction)[0] : null;
    if (launchCity && thirdTargetKey && off) {
      const troops = clamp(Math.round(launchCity.troops * 0.52), 400, 1600);
      launchCity.troops -= troops;
      if (launchCity.commander === off.key) launchCity.commander = null;
      if (launchCity.governor === off.key) launchCity.governor = null;
      off.city = null;
      const army = createArmyRecord(world, next, {
        faction: targetFaction,
        from: launchCity.key,
        route: [launchCity.key, thirdTargetKey],
        officerKey: off.key,
        troops,
        troopType: launchCity.troopType,
        stance: "attack",
        siegeStance: "storm",
      });
      off.armyId = army.id;
      next.armies.push(army);
      msg = `🐺 驱虎吞狼大计得售！「${rFac.name}」撕毁与「${factionNameV2(world, next, third)}」旧约，${off.name}正率 ${troops.toLocaleString()} 人直扑${cityNameV2(world, thirdTargetKey)}！`;
    } else {
      msg = `🐺 「${rFac.name}」受我筹码所动，已断绝与「${factionNameV2(world, next, third)}」邦交并陈兵对峙！`;
    }
  }

  const ev = { turn: next.turn, kind: "diplomacy", text: msg };
  next.events = [...next.events, ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

// ===== 5. 二期 AI 工事修筑 & 合纵连横 =====

export function planAiPhase2Dekad(world, state) {
  ensurePhase2State(state);
  const playerCitiesCount = Object.values(state.cities).filter((c) => c.owner === state.player).length;

  for (const fk of Object.keys(state.factions)) {
    if (fk === state.player) continue;
    const fac = state.factions[fk];
    const ownedCities = Object.values(state.cities).filter((c) => c.owner === fk);
    if (!ownedCities.length || (fac.treasury ?? 0) < 75) continue;

    // Limit max 2 road forts per AI faction
    const myForts = Object.values(state.forts).filter((f) => f.faction === fk);
    if (myForts.length < 2 && ((state.turn + hashStr(fk)) % 3 === 0)) {
      let bestEdge = null;
      for (const c of ownedCities) {
        if (state.sieges[c.key]) continue;
        for (const nb of cityByKey(world, c.key)?.links || []) {
          const enemy = state.cities[nb];
          if (!enemy || !isHostileV2(state, fk, enemy.owner)) continue;
          const eKey = edgeKey(c.key, nb);
          if (state.forts[eKey]) continue;
          const isRiver = roadTerrain(c.key, nb) === "river";
          const isPass = roadTerrain(c.key, nb) === "pass";
          const kind = isRiver && fac.treasury >= 22 ? "water_fort" : isPass ? "gate" : "tower";
          const score = enemy.troops + (enemy.owner === state.player ? 500 : 0) + (isPass ? 400 : 0);
          if (!bestEdge || score > bestEdge.score) {
            bestEdge = { a: c.key, b: nb, kind, score };
          }
        }
      }
      if (bestEdge) {
        const spec = FORT_CATALOG[bestEdge.kind];
        if (fac.treasury >= spec.cost) {
          fac.treasury -= spec.cost;
          const [a, b] = [bestEdge.a, bestEdge.b].sort();
          state.forts[edgeKey(a, b)] = {
            edgeKey: edgeKey(a, b),
            a,
            b,
            kind: bestEdge.kind,
            faction: fk,
            hp: spec.hpMax,
            hpMax: spec.hpMax,
            builtTurn: state.turn,
          };
        }
      }
    }

    // Defensive coalition truce when player dominates (>= 14 cities)
    if (playerCitiesCount >= 14 && (state.turn % 6 === 0)) {
      for (const otherFk of Object.keys(state.factions)) {
        if (otherFk === state.player || otherFk === fk) continue;
        if (activeTreaty(state, fk, otherFk)) continue;
        const otherCities = Object.values(state.cities).filter((c) => c.owner === otherFk);
        if (otherCities.length >= 2 && ownedCities.length >= 2) {
          state.treaties.push({ kind: "truce", sides: [fk, otherFk].sort(), expires: state.turn + 18 });
          break;
        }
      }
    }
  }
}
