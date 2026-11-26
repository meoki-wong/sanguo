import { forceTotals, gameOutcome } from "./engine.js";

/**
 * Exact Later Han 13-province (州郡) mapping (including Jiaozhou / Lingnan) matching Romance of the Three Kingdoms XI.
 */
export const HISTORICAL_PROVINCE = {
  luoyang: "司隶", changan: "司隶",
  xiangping: "幽州", beiping: "幽州", ji: "幽州",
  jinyang: "并州",
  ye: "冀州", nanpi: "冀州",
  pingyuan: "青州", beihai: "青州",
  puyang: "兖州", chenliu: "兖州",
  xu: "豫州", runan: "豫州", xiaopei: "豫州",
  xiapi: "徐州",
  shouchun: "扬州", lujiang: "扬州", chaisang: "扬州", moling: "扬州", wu: "扬州", shanyin: "扬州",
  wan: "荆州", xinye: "荆州", xiangyang: "荆州", shangyong: "荆州",
  jiangxia: "荆州", jiangling: "荆州", linxiang: "荆州", linyuan: "荆州", quanling: "荆州", guiyang: "荆州",
  nanzheng: "益州", zitong: "益州", chengdu: "益州", jiangzhou: "益州", yufu: "益州", jianning: "益州", yunnan: "益州",
  tianshui: "凉州", anding: "凉州", guzang: "凉州",
  panyu: "交州", jiaozhi: "交州",
};

export function historicalProvince(cityKey, fallback = "") {
  return HISTORICAL_PROVINCE[cityKey] || fallback;
}

export function getImperialChoice(state) {
  const val = state?.imperialChoice;
  return val === "emperor" || val === "loyalist" ? val : null;
}

export function proclaimImperialChoice(world, state, choice) {
  if (!state || gameOutcome(state) !== "ongoing") throw new Error("战局已决，无法变更正统名号。");
  if (choice !== "emperor" && choice !== "loyalist") throw new Error("未知称谓抉择。");
  if (choice === "emperor") {
    const current = factionCourtProfile(world, state, state.player, { choice: null });
    if (!current.canClaimEmperor) throw new Error("尚未具备劝进称帝之势。");
  }
  return { ...state, imperialChoice: choice };
}

/**
 * Returns the live status of the Eastern Han Emperor on the map.
 * Eastern Han ends historically in 220 AD, so 234+ scenarios have no Han Emperor.
 */
export function hanEmperorStatus(state, options = {}) {
  if (!state || state.year >= 234) {
    return { active: false, name: null, cityKey: null, patron: null };
  }
  const choice = options.choice !== undefined ? options.choice : getImperialChoice(state);
  if (choice === "emperor") {
    return { active: false, name: null, cityKey: null, patron: null, supersededBy: state.player };
  }
  if (state.year === 184) {
    const cityKey = "luoyang";
    return { active: true, name: "汉灵帝", cityKey, patron: state.cities?.[cityKey]?.owner ?? "han" };
  }
  if (state.year === 190) {
    const cityKey = state.cities?.luoyang?.owner === "dong"
      ? "luoyang"
      : (state.cities?.changan?.owner === "dong" ? "changan" : "luoyang");
    return { active: true, name: "汉献帝", cityKey, patron: state.cities?.[cityKey]?.owner ?? null };
  }
  // 199, 208, 219
  const cityKey = "xu";
  return { active: true, name: "汉献帝", cityKey, patron: state.cities?.[cityKey]?.owner ?? null };
}

export const HISTORICAL_TITLES = {
  184: {
    han: { title: "汉灵帝", note: "大汉天子统御正朔" },
    yellow: { title: "天公将军 · 大贤良师", note: "苍天已死，黄天当立" },
    frontier: { title: "幽州牧", note: "刘虞宗室抚边" },
    biao: { title: "荆州刺史", note: "镇抚荆襄郡县" },
    jian: { title: "破虏将军 · 长沙太守", note: "平乱江汉，整备江东" },
    yan: { title: "益州牧", note: "保境安蜀" },
    ma: { title: "西凉诸部首领", note: "雄踞凉州" },
    shi: { title: "交趾太守", note: "保境岭南，礼贤养士" },
  },
  190: {
    dong: { title: "汉相国", note: "废立天子，独专汉政" },
    yuan: { title: "渤海太守 · 联军盟主", note: "统率关东十八路诸侯" },
    cao: { title: "奋武将军", note: "矫诏发兵，立足陈留" },
    gongsun: { title: "奋武将军 · 北平太守", note: "白马义从护持北疆" },
    jiu: { title: "后将军 · 南阳太守", note: "四世三公，据守淮南" },
    biao: { title: "荆州刺史", note: "单骑入荆，安集九郡" },
    jian: { title: "破虏将军 · 长沙太守", note: "联军先锋，北上讨董" },
    yan: { title: "益州牧", note: "闭境自守蜀道" },
    ma: { title: "征西将军", note: "关凉劲旅" },
    shi: { title: "绥南中郎将 · 交趾太守", note: "雄长交州，通商南海" },
  },
  199: {
    cao: { title: "汉司空 · 车骑将军", note: "奉天子以令不臣" },
    yuan: { title: "大将军 · 冀州牧", note: "兼领四州，虎视中原" },
    biao: { title: "镇南将军 · 荆州牧", note: "跨蹈汉南" },
    zhang: { title: "振威将军 · 益州牧", note: "据险守蜀" },
    ce: { title: "讨逆将军 · 吴侯", note: "江东小霸王，席卷吴会" },
    ma: { title: "征西将军 · 关凉诸将", note: "控扼关陇" },
    lu: { title: "镇民中郎将 · 汉宁太守", note: "五斗米道治汉中" },
    gongsun: { title: "辽东太守 · 平州牧", note: "自立辽海" },
    shi: { title: "绥南中郎将 · 交趾太守", note: "雄长交州" },
  },
  208: {
    cao: { title: "汉丞相", note: "统北地而征荆吴" },
    wu: { title: "讨虏将军 · 会稽太守", note: "据江东六郡，抗衡北师" },
    liu: { title: "左将军 · 豫州牧", note: "结好东吴，图存汉室" },
    han: { title: "荆南四郡太守", note: "分守江南" },
    zhang: { title: "益州牧", note: "安守巴蜀" },
    lu: { title: "汉宁太守", note: "据守汉中" },
    ma: { title: "卫尉 · 关凉诸部", note: "关凉联兵" },
    gongsun: { title: "辽东太守", note: "偏安辽东" },
    shi: { title: "安远将军 · 龙度亭侯", note: "据守交广，观望中原" },
  },
  219: {
    cao: { title: "魏王", note: "位居诸侯王之上，犹守汉臣之名" },
    liu: { title: "汉中王", note: "进位汉中王，北拒曹魏" },
    wu: { title: "车骑将军 · 徐州牧", note: "吕蒙白衣渡江，图取荆襄" },
  },
  234: {
    wei: { title: "魏明帝 · 大魏朝廷", note: "曹魏正朔，御极中原" },
    shu: { title: "汉后主 · 季汉朝廷", note: "继承汉统，丞相北伐" },
    wu: { title: "吴大帝 · 大吴朝廷", note: "孙权称帝，鼎足江南" },
  },
  262: {
    wei: { title: "魏元帝 · 大魏朝廷", note: "大魏朝廷，司马执政" },
    shu: { title: "汉后主 · 季汉朝廷", note: "季汉朝廷，姜维北守" },
    wu: { title: "吴景帝 · 大吴朝廷", note: "大吴朝廷，扼守长江" },
  },
  265: {
    jin: { title: "晋武帝 · 大晋朝廷", note: "司马受禅，建晋称尊" },
    wu: { title: "吴末帝 · 大吴朝廷", note: "大吴朝廷，独守东南" },
  },
};

export const POLITY_LEXICONS = {
  imperial: {
    org: "朝廷",
    ruler: "陛下",
    modeLabel: "帝王模式",
    memorialsTitle: "御案奏折",
    advisorAction: "御前呈奏",
    doctrineBtn: "朝政诏纲",
    doctrineTitle: "朝政总纲 · 一键托付",
    cityCardLabel: "御览城池",
    attackVerb: "下旨讨伐",
    attackOrder: "已下旨",
    approveTreaty: "准奏缔约",
    rejectTreaty: "严词拒之",
    autoStaffBtn: "朝廷补官",
    autoStaffMsg: "朝廷已自动补任",
    urgentTag: "朝廷急报",
    pendingLabel: "朝廷待决",
    courtLabel: "朝廷",
    delegateVerb: "朝廷委任",
    directLabel: "御前直辖",
    doctrineEmptyTitle: "尚无朝廷全国总纲，诸郡需逐一理政",
    doctrineTag: "诏纲未定",
  },
  royal: {
    org: "王府",
    ruler: "大王",
    modeLabel: "王府模式",
    memorialsTitle: "王府笺奏",
    advisorAction: "王府呈笺",
    doctrineBtn: "王府方略",
    doctrineTitle: "王府方略 · 一键委任",
    cityCardLabel: "王府巡城",
    attackVerb: "传令讨伐",
    attackOrder: "已传王命",
    approveTreaty: "准令缔约",
    rejectTreaty: "严词拒之",
    autoStaffBtn: "王府授官",
    autoStaffMsg: "王府已自动授官",
    urgentTag: "王府急报",
    pendingLabel: "王府待决",
    courtLabel: "王府",
    delegateVerb: "王府委任",
    directLabel: "王府直辖",
    doctrineEmptyTitle: "尚无王府治境总纲，诸城需逐一理政",
    doctrineTag: "方略未定",
  },
  regent: {
    org: "霸府",
    ruler: "明公",
    modeLabel: "霸府模式",
    memorialsTitle: "霸府军报",
    advisorAction: "幕下禀报",
    doctrineBtn: "霸府方略",
    doctrineTitle: "霸府方略 · 一键委任",
    cityCardLabel: "巡视城池",
    attackVerb: "奉诏讨伐",
    attackOrder: "已传令",
    approveTreaty: "准行缔约",
    rejectTreaty: "严词拒之",
    autoStaffBtn: "承制辟署",
    autoStaffMsg: "霸府已承制辟署",
    urgentTag: "边关急报",
    pendingLabel: "霸府待决",
    courtLabel: "霸府",
    delegateVerb: "霸府委任",
    directLabel: "霸府直辖",
    doctrineEmptyTitle: "尚无霸府治境总纲，诸城需逐一理政",
    doctrineTag: "方略未定",
  },
  warlord: {
    org: "幕府",
    ruler: "主公",
    modeLabel: "诸侯模式",
    memorialsTitle: "幕府军报",
    advisorAction: "军师禀报",
    doctrineBtn: "治境方略",
    doctrineTitle: "治境方略 · 一键委任",
    cityCardLabel: "巡视城池",
    attackVerb: "传令出兵",
    attackOrder: "已下军令",
    approveTreaty: "准行缔约",
    rejectTreaty: "严词拒之",
    autoStaffBtn: "幕府辟署",
    autoStaffMsg: "幕府已辟署任官",
    urgentTag: "军情急报",
    pendingLabel: "军府待决",
    courtLabel: "幕府",
    delegateVerb: "幕府委任",
    directLabel: "幕府直辖",
    doctrineEmptyTitle: "尚无治境总纲，诸城需逐一调度",
    doctrineTag: "方略未定",
  },
  rebel: {
    org: "天公府",
    ruler: "大贤良师",
    modeLabel: "义军模式",
    memorialsTitle: "渠帅军报",
    advisorAction: "大方呈报",
    doctrineBtn: "道众方略",
    doctrineTitle: "道众方略 · 分授诸部",
    cityCardLabel: "巡视据点",
    attackVerb: "起兵讨伐",
    attackOrder: "已传天令",
    approveTreaty: "准行议和",
    rejectTreaty: "断然拒之",
    autoStaffBtn: "分授渠帅",
    autoStaffMsg: "天公府已分授渠帅",
    urgentTag: "四方急报",
    pendingLabel: "教中待决",
    courtLabel: "天公府",
    delegateVerb: "分部托付",
    directLabel: "亲统据点",
    doctrineEmptyTitle: "尚无全军方略，各郡需逐一调度",
    doctrineTag: "方略未定",
  },
};

function dynamicRankTitle(cities, baseTitle) {
  if (cities >= 14) return baseTitle.includes("王") ? baseTitle : "进爵称王";
  if (cities >= 12) return baseTitle.includes("大将军") || baseTitle.includes("丞相") || baseTitle.includes("相国") || baseTitle.includes("王") ? baseTitle : "大将军 · 司马";
  if (cities >= 9) return baseTitle;
  if (cities >= 6) return baseTitle;
  return baseTitle;
}

/**
 * Classifies any faction into strict historical polity tier:
 * "imperial" (genuine Emperor) | "royal" (诸侯王如魏王/汉中王) | "regent" (奉/挟天子) | "warlord" (割据诸侯) | "rebel" (黄巾)
 */
export function factionCourtProfile(world, state, factionKey = state?.player, options = {}) {
  const cities = state && factionKey ? forceTotals(state, factionKey).cities : 0;
  const han = hanEmperorStatus(state, options);
  const holdsEmperor = Boolean(han.active && han.patron === factionKey && !(state.year === 184 && factionKey === "han"));
  const choice = factionKey === state?.player
    ? (options.choice !== undefined ? options.choice : getImperialChoice(state))
    : null;
  const meta = HISTORICAL_TITLES[state?.year]?.[factionKey];
  const baseTitle = meta?.title || (cities >= 6 ? "州牧 · 征镇将军" : "郡守 · 偏将军");

  let tier = "warlord";
  if (state?.year === 184 && factionKey === "han") {
    tier = "imperial";
  } else if (state?.year >= 234 && ["wei", "shu", "wu", "jin"].includes(factionKey)) {
    tier = "imperial";
  } else if (factionKey === state?.player && choice === "emperor" && cities >= 18) {
    tier = "imperial";
  } else if (state?.year === 184 && factionKey === "yellow") {
    tier = "rebel";
  } else if ((state?.year === 219 && ["cao", "liu"].includes(factionKey)) || (cities >= 14 && (state?.year ?? 0) <= 219)) {
    tier = "royal";
  } else if (holdsEmperor) {
    tier = "regent";
  }

  let badge = dynamicRankTitle(cities, baseTitle);
  if (tier === "imperial" && choice === "emperor") {
    badge = `受禅称帝 · 建朝立元`;
  } else if (holdsEmperor) {
    const suffix = state?.year === 190 && factionKey === "dong" ? "挟天子" : "奉天子";
    if (!badge.includes(suffix)) badge = `${badge} · ${suffix}`;
  }

  const lexicon = POLITY_LEXICONS[tier];
  const canClaimEmperor = Boolean(
    factionKey === state?.player
    && tier !== "imperial"
    && tier !== "rebel"
    && (state?.year ?? 999) <= 219
    && cities >= 18
    && choice !== "loyalist",
  );

  const tooltip = [
    badge,
    `建制：${lexicon.org}`,
    meta?.note,
    han.active ? `${han.name}驻跸${han.cityKey === "xu" ? "许昌" : han.cityKey === "changan" ? "长安" : "洛阳"}` : null,
  ].filter(Boolean).join(" · ");

  return {
    tier,
    isImperial: tier === "imperial",
    holdsEmperor,
    hanEmperor: han,
    badge,
    tooltip,
    canClaimEmperor,
    lexicon,
  };
}
