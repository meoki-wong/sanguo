// v23.0 — 九州 12 大名城地域特产光环（一城一宝，争夺更有战略意义）

export const CITY_SPECIALTIES = {
  luoyang: { name: "太学文脉", icon: "📚", tag: "文治", ecoGold: 0.08, tpBonus: 10, summary: "中枢太学所在：全势力税收 +8%、每季 +10 TP。" },
  changan: { name: "关中甲胄", icon: "🛡️", tag: "军械", defBonus: 0.08, summary: "秦地武库重镇：全军守御 +8%。" },
  chengdu: { name: "蜀锦盐井", icon: "🧵", tag: "富庶", ecoGold: 0.12, ecoGrain: 0.08, summary: "天府锦官城：全势力钱税 +12%、产粮 +8%。" },
  moling: { name: "百炼吴钩", icon: "⚔️", tag: "精兵", atkBonus: 0.07, summary: "江东铸剑名都：全军攻势 +7%。" },
  wuwei: { name: "汗血良马", icon: "🐎", tag: "铁骑", atkBonus: 0.09, summary: "河西牧马圣地：全军骑兵突击 +9%。" },
  xiangyang: { name: "荆楚名士", icon: "🎋", tag: "贤才", tpBonus: 12, defBonus: 0.05, summary: "水镜庞德公故里：每季 +12 TP、守御 +5%。" },
  wan: { name: "南阳冶铁", icon: "⚒️", tag: "锻造", atkBonus: 0.06, defBonus: 0.04, summary: "宛城官营冶铁：全军攻 +6%、防 +4%。" },
  hanzhong: { name: "天府粮道", icon: "🌾", tag: "粮仓", ecoGrain: 0.12, summary: "巴蜀咽喉沃野：全势力产粮 +12%。" },
  xu: { name: "中原官屯", icon: "🏛️", tag: "屯田", ecoGrain: 0.1, ecoGold: 0.06, summary: "枣祗任峻屯田典范：产粮 +10%、钱税 +6%。" },
  ye: { name: "邺都文枢", icon: "🏯", tag: "声望", ecoGold: 0.08, tpBonus: 8, summary: "河北雄都：全势力钱税 +8%、每季 +8 TP。" },
  chaisang: { name: "鄱阳船木", icon: "⛵", tag: "水师", atkBonus: 0.05, ecoGold: 0.06, summary: "江东造船良材：攻势 +5%、商税 +6%。" },
  panyu: { name: "南海珠贝", icon: "🦪", tag: "海贸", ecoGold: 0.14, summary: "岭南海丝枢纽：全势力商税 +14%。" },
};

export function citySpecialty(cityKey) {
  return CITY_SPECIALTIES[cityKey] || null;
}

export function activeSpecialtiesFor(state, factionId) {
  if (!state?.century || !factionId) return [];
  const list = [];
  for (const [ck, spec] of Object.entries(CITY_SPECIALTIES)) {
    if (state.cities?.[ck]?.owner === factionId) {
      list.push({ cityKey: ck, ...spec });
    }
  }
  return list;
}

export function specialtyEconomyModifiers(state, factionId) {
  if (!state?.century || factionId !== state.player) return { treasuryMult: 1, grainMult: 1, tpBonus: 0 };
  const list = activeSpecialtiesFor(state, factionId);
  let treasuryMult = 1;
  let grainMult = 1;
  let tpBonus = 0;
  for (const s of list) {
    treasuryMult += s.ecoGold ?? 0;
    grainMult += s.ecoGrain ?? 0;
    tpBonus += s.tpBonus ?? 0;
  }
  return {
    treasuryMult: Number(Math.min(1.45, treasuryMult).toFixed(3)),
    grainMult: Number(Math.min(1.45, grainMult).toFixed(3)),
    tpBonus,
  };
}

export function specialtyCombatModifiers(state, factionId) {
  if (!state?.century || factionId !== state.player) return { attackMult: 1, defenseMult: 1 };
  const list = activeSpecialtiesFor(state, factionId);
  let attackMult = 1;
  let defenseMult = 1;
  for (const s of list) {
    attackMult += s.atkBonus ?? 0;
    defenseMult += s.defBonus ?? 0;
  }
  return {
    attackMult: Number(Math.min(1.3, attackMult).toFixed(3)),
    defenseMult: Number(Math.min(1.3, defenseMult).toFixed(3)),
  };
}
