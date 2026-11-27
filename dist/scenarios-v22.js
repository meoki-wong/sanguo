// v22.0 — 两大全新史诗剧本：「194 徐州风云」与「225 南中平定」
// 基于 baseline 44 城与既有阵营体系构造，确保 100% 覆盖 44 城且零冲突。

function buildScenarioFromBase(world, baseline, { year, title, overrides = {}, extraFactions = {}, extraOfficers = [] }) {
  const positions = new Map(world.cities.map(({ key, position }) => [key, position]));
  const ownership = { ...baseline.ownership };
  for (const [cityKey, factionKey] of Object.entries(overrides)) {
    if (positions.has(cityKey)) ownership[cityKey] = factionKey;
  }

  const factionMap = new Map(baseline.factions.map((f) => [f.key, { ...f, stats: [...f.stats] }]));
  for (const [k, cfg] of Object.entries(extraFactions)) {
    factionMap.set(k, {
      key: k,
      name: cfg.name,
      trait: cfg.trait,
      stats: [...cfg.stats],
      position: positions.get(cfg.capital),
      path: "",
    });
  }

  // 只保留拥有至少 1 座城的势力，并重算其 path 与首都
  const capitals = { ...(baseline.capitals || {}) };
  const ownedBy = new Map();
  for (const [ck, fk] of Object.entries(ownership)) {
    if (!ownedBy.has(fk)) ownedBy.set(fk, []);
    ownedBy.get(fk).push(ck);
  }
  const factions = [];
  for (const [fk, cityList] of ownedBy.entries()) {
    const baseF = factionMap.get(fk);
    if (!baseF || !cityList.length) continue;
    const cap = extraFactions[fk]?.capital && cityList.includes(extraFactions[fk].capital)
      ? extraFactions[fk].capital
      : (capitals[fk] && cityList.includes(capitals[fk]) ? capitals[fk] : cityList[0]);
    capitals[fk] = cap;
    factions.push({
      ...baseF,
      position: positions.get(cap),
      path: cityList.map((c) => baseline.zones[c]).join(" "),
    });
  }

  const validKeys = new Set(factions.map((f) => f.key));
  const officers = [
    ...baseline.officers
      .filter((o) => validKeys.has(o.faction))
      .map((o, idx) => ({ ...o, key: `${o.key}-y${year}-${idx}` })),
    ...extraOfficers.filter((o) => validKeys.has(o.faction)),
  ];

  return {
    year,
    title,
    ownership,
    capitals,
    factions,
    officers,
    zones: baseline.zones,
    periodNames: { ...baseline.periodNames },
  };
}

/**
 * 194 年「徐州风云」：吕布突袭兖州濮阳，刘备领徐州下邳小沛，曹操腹背受敌，孙策初渡江东
 */
export function scenario194Xuzhou(world, baseline199) {
  return buildScenarioFromBase(world, baseline199, {
    year: 194,
    title: "徐州风云",
    overrides: {
      puyang: "lvbu",
      chenliu: "lvbu",
      xiapi: "liu",
      xiaopei: "liu",
      xu: "cao",
      qiao: "cao",
    },
    extraFactions: {
      lvbu: { name: "吕布", trait: "飞将袭兖", capital: "puyang", stats: [110, 105, 80] },
      liu: { name: "刘备", trait: "仁义领徐", capital: "xiapi", stats: [105, 115, 82] },
    },
    extraOfficers: [
      { key: "lvbu-194-0", faction: "lvbu", name: "吕布", governance: 38, command: 97, home: "puyang" },
      { key: "lvbu-194-1", faction: "lvbu", name: "陈宫", governance: 88, command: 78, home: "chenliu" },
      { key: "lvbu-194-2", faction: "lvbu", name: "高顺", governance: 62, command: 88, home: "puyang" },
      { key: "lvbu-194-3", faction: "lvbu", name: "张辽", governance: 66, command: 93, home: "chenliu" },
      { key: "liu-194-0", faction: "liu", name: "刘备", governance: 86, command: 82, home: "xiapi" },
      { key: "liu-194-1", faction: "liu", name: "关羽", governance: 74, command: 96, home: "xiapi" },
      { key: "liu-194-2", faction: "liu", name: "张飞", governance: 52, command: 92, home: "xiaopei" },
      { key: "liu-194-3", faction: "liu", name: "赵云", governance: 76, command: 93, home: "xiaopei" },
      { key: "liu-194-4", faction: "liu", name: "糜竺", governance: 88, command: 48, home: "xiapi" },
    ],
  });
}

/**
 * 225 年「南中平定」：三足鼎立已成，诸葛亮率师南征七擒孟获，魏吴虎视眈眈
 */
export function scenario225Nanzhong(world, baseline234) {
  return buildScenarioFromBase(world, baseline234, {
    year: 225,
    title: "南中平定",
    overrides: {
      yunnan: "shi",
      jianning: "shi",
    },
    extraFactions: {
      shi: { name: "孟获·南蛮", trait: "藤甲蛮王", capital: "yunnan", stats: [120, 145, 84] },
    },
    extraOfficers: [
      { key: "shi-225-0", faction: "shi", name: "孟获", governance: 56, command: 88, home: "yunnan" },
      { key: "shi-225-1", faction: "shi", name: "祝融", governance: 54, command: 86, home: "yunnan" },
      { key: "shi-225-2", faction: "shi", name: "木鹿大王", governance: 45, command: 84, home: "jianning" },
      { key: "shi-225-3", faction: "shi", name: "兀突骨", governance: 38, command: 89, home: "jianning" },
    ],
  });
}
