export const TRAIT_CATALOG = {
  fire: {
    id: "fire",
    name: "火攻",
    tone: "crimson",
    short: "出征战力+12%（夏秋/江渡+16%）",
    detail: "精熟火计与顺风破敌：出征时进攻战力 +12%，夏秋季或江渡地形额外 +4%。",
  },
  cavalry: {
    id: "cavalry",
    name: "突骑",
    tone: "gold",
    short: "陆路出征战力+12%",
    detail: "善于率轻骑奔袭冲阵：非水路出征时进攻战力 +12%。",
  },
  navy: {
    id: "navy",
    name: "水师",
    tone: "azure",
    short: "江渡水战攻防+16%",
    detail: "谙熟楼船水战之法：沿江水路或江渡地形交战时攻防战力 +16%。",
  },
  fortress: {
    id: "fortress",
    name: "铁壁",
    tone: "steel",
    short: "任守将城防战力+14%",
    detail: "老成持重善守险要：担任城池守将抵御敌军时，守军战力 +14%。",
  },
  farming: {
    id: "farming",
    name: "屯田",
    tone: "jade",
    short: "太守农商建设减3钱",
    detail: "长于兴修屯田与理政开源：任太守委任屯田/商贸建设时，每季费用减免 3 钱。",
  },
  logistics: {
    id: "logistics",
    name: "筹策",
    tone: "amber",
    short: "无视恶劣天气衰减且+6%战力",
    detail: "运筹帷幄精通粮道：出征无视风雪汛期减成，并额外提升 6% 稳健战力。",
  },
  ambush: {
    id: "ambush",
    name: "奇袭",
    tone: "violet",
    short: "攻城削弱城防加成30%",
    detail: "出奇制胜直捣要害：攻城时削弱敌城城防加成 30%。",
  },
  charisma: {
    id: "charisma",
    name: "威名",
    tone: "imperial",
    short: "攻防全军战力+7%",
    detail: "仁德威望素著四方：领兵出征或镇守城池时全军战力 +7%。",
  },
};

export const FAMOUS_OFFICERS = {
  // 魏 / 曹魏 / 西晋
  "曹操": { title: "孟德", might: 78, intellect: 95, traits: ["charisma", "logistics"] },
  "荀彧": { title: "文若", might: 26, intellect: 96, traits: ["farming", "logistics"] },
  "荀攸": { title: "公达", might: 28, intellect: 94, traits: ["logistics", "ambush"] },
  "郭嘉": { title: "奉孝", might: 22, intellect: 98, traits: ["ambush", "logistics"] },
  "程昱": { title: "仲德", might: 48, intellect: 90, traits: ["fortress", "ambush"] },
  "贾诩": { title: "文和", might: 35, intellect: 97, traits: ["ambush", "fire"] },
  "张辽": { title: "文远", might: 93, intellect: 84, traits: ["cavalry", "ambush"] },
  "夏侯渊": { title: "妙才", might: 91, intellect: 70, traits: ["cavalry", "ambush"] },
  "夏侯惇": { title: "元让", might: 90, intellect: 71, traits: ["cavalry"] },
  "曹仁": { title: "子孝", might: 86, intellect: 78, traits: ["fortress", "charisma"] },
  "徐晃": { title: "公明", might: 90, intellect: 76, traits: ["fortress", "cavalry"] },
  "于禁": { title: "文则", might: 83, intellect: 74, traits: ["fortress"] },
  "乐进": { title: "文谦", might: 85, intellect: 68, traits: ["ambush"] },
  "李典": { title: "曼成", might: 79, intellect: 79, traits: ["logistics"] },
  "许褚": { title: "仲康", might: 96, intellect: 46, traits: ["cavalry"] },
  "曹洪": { title: "子廉", might: 82, intellect: 62, traits: ["cavalry"] },
  "曹休": { title: "文烈", might: 81, intellect: 74, traits: ["cavalry"] },
  "满宠": { title: "伯宁", might: 72, intellect: 86, traits: ["fortress", "farming"] },
  "刘晔": { title: "子扬", might: 36, intellect: 91, traits: ["fire", "logistics"] },
  "毛玠": { title: "孝先", might: 32, intellect: 83, traits: ["farming"] },
  "任峻": { title: "伯达", might: 44, intellect: 82, traits: ["farming"] },
  "钟繇": { title: "元常", might: 34, intellect: 89, traits: ["farming"] },
  "陈群": { title: "长文", might: 28, intellect: 88, traits: ["farming"] },
  "司马懿": { title: "仲达", might: 64, intellect: 97, traits: ["fortress", "logistics"] },
  "司马昭": { title: "子上", might: 68, intellect: 89, traits: ["logistics", "charisma"] },
  "司马炎": { title: "安世", might: 56, intellect: 82, traits: ["charisma"] },
  "羊祜": { title: "叔子", might: 74, intellect: 91, traits: ["charisma", "farming"] },
  "杜预": { title: "元凯", might: 69, intellect: 93, traits: ["logistics", "navy"] },
  "文鸯": { title: "次骞", might: 95, intellect: 64, traits: ["cavalry", "ambush"] },
  "王濬": { title: "士治", might: 76, intellect: 85, traits: ["navy", "fire"] },
  "郭淮": { title: "伯济", might: 78, intellect: 83, traits: ["fortress", "logistics"] },
  "邓艾": { title: "士载", might: 82, intellect: 90, traits: ["ambush", "farming"] },
  "钟会": { title: "士季", might: 60, intellect: 91, traits: ["logistics"] },
  "张郃": { title: "儁乂", might: 89, intellect: 81, traits: ["cavalry", "fortress"] },
  "庞德": { title: "令明", might: 94, intellect: 65, traits: ["cavalry"] },
  "田豫": { title: "国让", might: 76, intellect: 82, traits: ["fortress"] },
  "臧霸": { title: "宣高", might: 84, intellect: 70, traits: ["cavalry"] },
  "曹叡": { title: "元仲", might: 54, intellect: 84, traits: ["charisma"] },
  "张华": { title: "茂先", might: 34, intellect: 91, traits: ["farming"] },

  // 蜀 / 蜀汉
  "刘备": { title: "玄德", might: 76, intellect: 82, traits: ["charisma", "fortress"] },
  "诸葛亮": { title: "孔明", might: 42, intellect: 100, traits: ["fire", "logistics"] },
  "关羽": { title: "云长", might: 97, intellect: 82, traits: ["charisma", "navy"] },
  "张飞": { title: "翼德", might: 98, intellect: 62, traits: ["cavalry", "ambush"] },
  "赵云": { title: "子龙", might: 96, intellect: 80, traits: ["cavalry", "fortress"] },
  "黄忠": { title: "汉升", might: 94, intellect: 68, traits: ["ambush"] },
  "魏延": { title: "文长", might: 92, intellect: 78, traits: ["ambush", "cavalry"] },
  "马超": { title: "孟起", might: 97, intellect: 64, traits: ["cavalry", "charisma"] },
  "法正": { title: "孝直", might: 44, intellect: 95, traits: ["ambush", "fire"] },
  "姜维": { title: "伯约", might: 88, intellect: 91, traits: ["cavalry", "logistics"] },
  "王平": { title: "子均", might: 82, intellect: 79, traits: ["fortress"] },
  "蒋琬": { title: "公琰", might: 36, intellect: 89, traits: ["farming", "logistics"] },
  "费祎": { title: "文伟", might: 34, intellect: 88, traits: ["farming"] },
  "糜竺": { title: "子仲", might: 28, intellect: 78, traits: ["farming"] },
  "霍弋": { title: "绍先", might: 80, intellect: 81, traits: ["fortress"] },
  "罗宪": { title: "令则", might: 81, intellect: 83, traits: ["fortress", "charisma"] },
  "张翼": { title: "伯恭", might: 81, intellect: 74, traits: ["fortress"] },

  // 吴 / 东吴
  "孙坚": { title: "文台", might: 92, intellect: 76, traits: ["cavalry", "charisma"] },
  "孙策": { title: "伯符", might: 94, intellect: 78, traits: ["cavalry", "charisma"] },
  "孙权": { title: "仲谋", might: 68, intellect: 86, traits: ["charisma", "navy"] },
  "周瑜": { title: "公瑾", might: 74, intellect: 97, traits: ["fire", "navy"] },
  "鲁肃": { title: "子敬", might: 46, intellect: 93, traits: ["farming", "charisma"] },
  "吕蒙": { title: "子明", might: 82, intellect: 91, traits: ["navy", "ambush"] },
  "陆逊": { title: "伯言", might: 68, intellect: 96, traits: ["fire", "fortress"] },
  "甘宁": { title: "兴霸", might: 94, intellect: 74, traits: ["navy", "ambush"] },
  "太史慈": { title: "子义", might: 94, intellect: 72, traits: ["cavalry", "ambush"] },
  "黄盖": { title: "公覆", might: 84, intellect: 74, traits: ["fire", "navy"] },
  "周泰": { title: "幼平", might: 92, intellect: 56, traits: ["fortress"] },
  "程普": { title: "德谋", might: 83, intellect: 78, traits: ["navy", "fortress"] },
  "韩当": { title: "义公", might: 83, intellect: 65, traits: ["navy"] },
  "张昭": { title: "子布", might: 25, intellect: 90, traits: ["farming"] },
  "张纮": { title: "子纲", might: 24, intellect: 90, traits: ["farming"] },
  "顾雍": { title: "元叹", might: 26, intellect: 89, traits: ["farming"] },
  "诸葛瑾": { title: "子瑜", might: 38, intellect: 86, traits: ["charisma", "farming"] },
  "朱然": { title: "义封", might: 80, intellect: 81, traits: ["fortress", "fire"] },
  "施绩": { title: "公绪", might: 80, intellect: 79, traits: ["navy", "fortress"] },
  "陶璜": { title: "世英", might: 81, intellect: 80, traits: ["navy", "farming"] },
  "士燮": { title: "威彦", might: 56, intellect: 84, traits: ["farming", "charisma"] },
  "士壹": { title: "威仲", might: 54, intellect: 76, traits: ["farming"] },
  "步骘": { title: "子山", might: 68, intellect: 86, traits: ["farming", "logistics"] },

  // 群雄 / 汉室
  "吕布": { title: "奉先", might: 100, intellect: 48, traits: ["cavalry", "ambush"] },
  "董卓": { title: "仲颖", might: 88, intellect: 66, traits: ["cavalry"] },
  "袁绍": { title: "本初", might: 72, intellect: 76, traits: ["charisma"] },
  "颜良": { title: "—", might: 94, intellect: 52, traits: ["cavalry"] },
  "文丑": { title: "—", might: 93, intellect: 50, traits: ["cavalry"] },
  "田丰": { title: "元皓", might: 32, intellect: 92, traits: ["logistics", "farming"] },
  "审配": { title: "正南", might: 56, intellect: 84, traits: ["fortress"] },
  "皇甫嵩": { title: "义真", might: 83, intellect: 86, traits: ["fire", "fortress"] },
  "朱儁": { title: "公伟", might: 82, intellect: 82, traits: ["cavalry"] },
  "卢植": { title: "子干", might: 72, intellect: 88, traits: ["charisma", "logistics"] },
  "张角": { title: "大贤良师", might: 46, intellect: 88, traits: ["fire", "charisma"] },
  "公孙瓒": { title: "伯圭", might: 85, intellect: 68, traits: ["cavalry"] },
  "刘表": { title: "景升", might: 45, intellect: 80, traits: ["charisma", "farming"] },
  "文聘": { title: "仲业", might: 84, intellect: 78, traits: ["fortress", "navy"] },
  "张任": { title: "—", might: 86, intellect: 79, traits: ["ambush", "fortress"] },
  "严颜": { title: "—", might: 85, intellect: 74, traits: ["fortress"] },
  "马腾": { title: "寿成", might: 85, intellect: 64, traits: ["cavalry"] },
  "韩遂": { title: "文约", might: 78, intellect: 82, traits: ["cavalry", "ambush"] },
  "张鲁": { title: "公祺", might: 54, intellect: 78, traits: ["farming"] },
  "张松": { title: "永年", might: 25, intellect: 86, traits: ["logistics"] },
  "董和": { title: "幼宰", might: 34, intellect: 86, traits: ["farming"] },
};

const metaCache = new Map();

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function hashName(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function officerMeta(officer) {
  if (!officer) {
    return { might: 50, intellect: 50, title: "", traits: [], seal: "将" };
  }
  const cacheKey = `${officer.name}:${officer.command}:${officer.governance}`;
  const cached = metaCache.get(cacheKey);
  if (cached) return cached;

  const curated = FAMOUS_OFFICERS[officer.name];
  let might;
  let intellect;
  let traitIds;
  let title = "";

  if (curated) {
    ({ might, intellect, traits: traitIds, title } = curated);
    if (title === "—") title = "";
  } else {
    const h = hashName(officer.name || "将");
    might = clamp(officer.command * 0.88 + (h % 14) - 2, 32, 95);
    intellect = clamp(officer.governance * 0.86 + ((h >> 4) % 14) - 2, 32, 95);
    traitIds = [];
    const peak = Math.max(officer.command ?? 0, officer.governance ?? 0);
    if (peak >= 80) {
      if ((officer.command ?? 0) >= (officer.governance ?? 0)) {
        const martialPool = ["cavalry", "fortress", "ambush", "navy"];
        traitIds.push(martialPool[h % martialPool.length]);
      } else {
        const civilPool = ["farming", "logistics", "charisma"];
        traitIds.push(civilPool[h % civilPool.length]);
      }
    }
  }

  const traits = traitIds.map((id) => TRAIT_CATALOG[id]).filter(Boolean);
  const seal = officer.name ? [...officer.name][0] : "将";
  const result = { might, intellect, title, traits, seal };
  metaCache.set(cacheKey, result);
  return result;
}

export function hasTrait(officer, traitId) {
  return Boolean(officer && officerMeta(officer).traits.some((t) => t.id === traitId));
}

export function combatTraitEffects({ attacker, defender, weather, travel, state }) {
  const neutral = {
    attackMult: 1,
    defenseMult: 1,
    wallFactor: 1,
    ignoreWeather: false,
    attackerTraits: [],
    defenderTraits: [],
  };
  if (!state?.century) return neutral;

  let attackMult = 1;
  let defenseMult = 1;
  let wallFactor = 1;
  let ignoreWeather = false;
  const attackerTraits = [];
  const defenderTraits = [];
  const seasonIndex = state.turn % 4; // 0:春 1:夏 2:秋 3:冬
  const isWater = travel === "water" || weather?.terrain === "river";

  if (attacker) {
    if (hasTrait(attacker, "fire")) {
      const fireBonus = seasonIndex === 1 || seasonIndex === 2 || isWater ? 1.16 : 1.12;
      attackMult *= fireBonus;
      attackerTraits.push("火攻");
    }
    if (hasTrait(attacker, "cavalry") && !isWater) {
      attackMult *= 1.12;
      attackerTraits.push("突骑");
    }
    if (hasTrait(attacker, "navy") && isWater) {
      attackMult *= 1.16;
      attackerTraits.push("水师");
    }
    if (hasTrait(attacker, "logistics")) {
      attackMult *= 1.06;
      ignoreWeather = true;
      attackerTraits.push("筹策");
    }
    if (hasTrait(attacker, "ambush")) {
      wallFactor *= 0.7;
      attackerTraits.push("奇袭");
    }
    if (hasTrait(attacker, "charisma")) {
      attackMult *= 1.07;
      attackerTraits.push("威名");
    }
  }

  if (defender) {
    if (hasTrait(defender, "fortress")) {
      defenseMult *= 1.14;
      defenderTraits.push("铁壁");
    }
    if (hasTrait(defender, "navy") && weather?.terrain === "river") {
      defenseMult *= 1.16;
      defenderTraits.push("水师");
    }
    if (hasTrait(defender, "charisma")) {
      defenseMult *= 1.07;
      defenderTraits.push("威名");
    }
  }

  return {
    attackMult: Math.min(1.32, attackMult),
    defenseMult: Math.min(1.28, defenseMult),
    wallFactor,
    ignoreWeather,
    attackerTraits,
    defenderTraits,
  };
}

export function governorTraitDiscount(era, city, focus, state) {
  if (!state?.century || !city?.governor) return 0;
  if (focus !== "farming" && focus !== "commerce") return 0;
  const governor = era?.officers?.find(({ key }) => key === city.governor);
  return hasTrait(governor, "farming") ? 3 : 0;
}
