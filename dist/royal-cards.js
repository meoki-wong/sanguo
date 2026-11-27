// v26.0 — 王权 Reigns 式「君主闪电密奏」决策卡系统
// 每季一奏，支持左划驳回/权谋 vs 右划准奏/仁义，四维预判亮灯 + 三连政赏赐

import { addSagaBuff, ensureSaga, recordAnnal } from "./saga.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

export const ROYAL_DECREE_CARDS = [
  {
    id: "huatuo_clinic",
    tag: "医道民生",
    title: "神医求设官医署",
    speaker: "华佗",
    portraitIcon: "🩺",
    prompt: "神医华佗入府请命，愿于军中广设疫诊医署并传麻沸散方剂，然需拨出军饷采购药材。",
    left: {
      label: "军资吃紧，只留随军医官",
      stamp: "节省",
      preview: { treasury: "up", grain: "none", morale: "down", reputation: "none" },
      effects: { treasury: 45, morale: -2 },
      outcomeText: "严控经费增盈府库 45 金，但士卒略感医护不周（民心 -2）。",
    },
    right: {
      label: "特拨钱财全数支助医署",
      stamp: "准奏",
      preview: { treasury: "down", grain: "none", morale: "up", reputation: "up" },
      effects: { treasury: -45, morale: 6, reputation: 4, troopBoost: 300 },
      outcomeText: "伤兵大愈、归心日众：全境士气 +6，海内声望 +4，首府康复归伍 +300 兵。",
    },
  },
  {
    id: "mojin_gold",
    tag: "奇财险策",
    title: "发丘密令掘古墓",
    speaker: "发丘校尉",
    portraitIcon: "⛏️",
    prompt: "前线将校密报古冢陪葬甚丰，若令兵卒夜掘可得大批军饷，惟恐天下士人非议有伤厚道。",
    left: {
      label: "严令禁止，立碑修护古冢",
      stamp: "立义",
      preview: { treasury: "none", grain: "none", morale: "up", reputation: "up" },
      effects: { reputation: 5, morale: 3 },
      outcomeText: "士林传颂主公敬重先贤：海内声望 +5，民心 +3。",
    },
    right: {
      label: "军需至急，秘密充公资军",
      stamp: "急饷",
      preview: { treasury: "up", grain: "up", morale: "none", reputation: "down" },
      effects: { treasury: 120, grain: 60, reputation: -6 },
      outcomeText: "府库剧增 120 金、粮 +60，然流言微起（声望 -6）。",
    },
  },
  {
    id: "steppe_horses",
    tag: "边贸战马",
    title: "胡商私售大宛骏马",
    speaker: "关市令",
    portraitIcon: "🐎",
    prompt: "塞外马商携三百匹铁骑战马入关求售，若破格优待可强我骑锋，或以官粮平价换购。",
    left: {
      label: "以余粮折价换马，稳妥充边",
      stamp: "易粮",
      preview: { treasury: "none", grain: "down", morale: "none", reputation: "none" },
      effects: { grain: -70, troopBoost: 420 },
      outcomeText: "耗粮 70 石换得战马新卒 420 众，骑兵战备渐厚。",
    },
    right: {
      label: "重金尽收名驹并厚赏骑营",
      stamp: "强骑",
      preview: { treasury: "down", grain: "none", morale: "up", reputation: "up" },
      effects: { treasury: -65, morale: 2, reputation: 2, buff: { kind: "attack", value: 0.08, duration: 3, label: "西域良驹" } },
      outcomeText: "精骑披挂新鞍，全军攻势 +8%（持续 3 季）！",
    },
  },
  {
    id: "corrupt_granary",
    tag: "肃贪纠察",
    title: "督粮官私掺砂糠",
    speaker: "御史中丞",
    portraitIcon: "⚖️",
    prompt: "军中督粮曹吏私卖官麦掺入糠秕，今已人赃俱获。查办则军资有损或可借头安众。",
    left: {
      label: "着其戴罪罚俸倍偿库银",
      stamp: "重罚",
      preview: { treasury: "up", grain: "up", morale: "down", reputation: "none" },
      effects: { treasury: 75, grain: 80, morale: -3 },
      outcomeText: "追缴贪墨 75 金、80 粮入库，但部分士卒微怨未诛首恶。",
    },
    right: {
      label: "斩首示众，开仓补发纯麦",
      stamp: "正法",
      preview: { treasury: "none", grain: "down", morale: "up", reputation: "up" },
      effects: { grain: -55, morale: 8, reputation: 5 },
      outcomeText: "三军欢呼明法严正：民心士气 +8，海内声望 +5！",
    },
  },
  {
    id: "xuyou_defection",
    tag: "暗谍虚实",
    title: "敌方降客献草图",
    speaker: "细作头目",
    portraitIcon: "🗡️",
    prompt: "一名敌城散吏夜渡来奔，自称携敌营布防草图，然而形迹颇疑，不知真降抑或苦肉计。",
    left: {
      label: "厚赐礼送离境以安外心",
      stamp: "疑放",
      preview: { treasury: "down", grain: "none", morale: "none", reputation: "up" },
      effects: { treasury: -25, reputation: 4 },
      outcomeText: "宽怀示人未堕圈套，四方侠士感念大度（声望 +4）。",
    },
    right: {
      label: "扣留审实并破格赐重金验证",
      stamp: "用谍",
      preview: { treasury: "down", grain: "none", morale: "none", reputation: "none" },
      effects: { treasury: -40, techPoints: 26, buff: { kind: "fire", value: 0.1, duration: 3, label: "破防草图" } },
      outcomeText: "核实暗道要害：兵技点 +26，计略奇袭威力 +10%（3 季）！",
    },
  },
  {
    id: "generals_brawl",
    tag: "将帅和睦",
    title: "二将酒后争功拔剑",
    speaker: "典军校尉",
    portraitIcon: "🍶",
    prompt: "庆功酒酣之际，两员猛将因争首功按剑对峙，帐下偏裨纷纷劝阻，请主公亲裁。",
    left: {
      label: "罚酒斥责，各令立军令状",
      stamp: "军法",
      preview: { treasury: "none", grain: "none", morale: "up", reputation: "up" },
      effects: { morale: 4, reputation: 3 },
      outcomeText: "二将愧服立状争先，军纪威严更盛。",
    },
    right: {
      label: "赐良弓宝刀命其演武比试分先登",
      stamp: "激将",
      preview: { treasury: "down", grain: "none", morale: "up", reputation: "none" },
      effects: { treasury: -35, buff: { kind: "attack", value: 0.09, duration: 3, label: "双雄争先" }, morale: 3 },
      outcomeText: "将校斗志如火，全军攻势 +9%（3 季）、士气 +3！",
    },
  },
  {
    id: "refugee_wave",
    tag: "避乱百姓",
    title: "万余流民叩关求庇",
    speaker: "郡国太守",
    portraitIcon: "🌾",
    prompt: "邻境战火连天，万余携老扶幼流民涌至关外，关吏不敢擅开城门。救则耗粮，闭则失望。",
    left: {
      label: "闭关设障，仅许壮丁随军",
      stamp: "精选",
      preview: { treasury: "none", grain: "none", morale: "down", reputation: "down" },
      effects: { troopBoost: 550, morale: -4, reputation: -4 },
      outcomeText: "挑拣壮丁增兵 +550，但流民哀声动道（民心 -4，声望 -4）。",
    },
    right: {
      label: "大开城门施粥分田屯耕",
      stamp: "仁庇",
      preview: { treasury: "none", grain: "down", morale: "up", reputation: "up" },
      effects: { grain: -90, morale: 7, reputation: 7, troopBoost: 320 },
      outcomeText: "仁名播于四野：海内声望 +7，民心 +7，兼募义勇 +320 众！",
    },
  },
  {
    id: "fake_intercept",
    tag: "反间密谋",
    title: "伪作手书离间敌将",
    speaker: "谋士密使",
    portraitIcon: "✉️",
    prompt: "近来敌前线主将与其国主微有隙，先生提议仿写敌将笔迹，投书反间令其互疑。",
    left: {
      label: "行堂堂正正之师，不屑诡诈",
      stamp: "堂皇",
      preview: { treasury: "none", grain: "none", morale: "up", reputation: "up" },
      effects: { reputation: 5, morale: 2 },
      outcomeText: "坚守王道气象，郡县名士赞服（声望 +5，民心 +2）。",
    },
    right: {
      label: "蜜蜡封书重赏死士送入敌宫",
      stamp: "反间",
      preview: { treasury: "down", grain: "none", morale: "none", reputation: "none" },
      effects: { treasury: -45, rumorEnemy: true },
      outcomeText: "敌廷君臣果生嫌隙！邻境敌城陷流言动摇 3 季。",
    },
  },
  {
    id: "repeating_crossbow",
    tag: "军械奇巧",
    title: "木匠献连发机关弩",
    speaker: "作坊少府",
    portraitIcon: "🏹",
    prompt: "民间老木工携一具一次连发十矢的巧弩图样求见，言若给铜铁匠人，三月内即可成批锻造。",
    left: {
      label: "先收图样略赐十金嘉勉",
      stamp: "封存",
      preview: { treasury: "down", grain: "none", morale: "none", reputation: "none" },
      effects: { treasury: -10, techPoints: 18 },
      outcomeText: "匠人谢恩退下，工坊留存草图（兵技点 +18）。",
    },
    right: {
      label: "全额拨付铜铁立试百具新弩",
      stamp: "革制",
      preview: { treasury: "down", grain: "none", morale: "none", reputation: "none" },
      effects: { treasury: -55, techPoints: 34, buff: { kind: "siege", value: 0.1, duration: 3, label: "巧匠连弩" } },
      outcomeText: "神弩成批列装：兵技点 +34，攻城强射 +10%（3 季）！",
    },
  },
  {
    id: "drought_prayer",
    tag: "天时民意",
    title: "夏旱祈雨抑或浚渠",
    speaker: "礼部司仪",
    portraitIcon: "🌧️",
    prompt: "近月少雨禾苗渐黄。巫祝请筑高坛盛礼祈雨，农官却请速发丁夫疏浚陂塘古渠。",
    left: {
      label: "设坛敬天从俗安抚百姓名声",
      stamp: "祈天",
      preview: { treasury: "down", grain: "none", morale: "up", reputation: "up" },
      effects: { treasury: -30, morale: 4, reputation: 3 },
      outcomeText: "百姓感念主公诚祈，民心 +4、声望 +3。",
    },
    right: {
      label: "重酬民夫连夜浚通古水渠",
      stamp: "兴农",
      preview: { treasury: "down", grain: "up", morale: "up", reputation: "none" },
      effects: { treasury: -45, grain: 145, morale: 4 },
      outcomeText: "清水滚滚入田：粮仓急补 145 石、民心 +4！",
    },
  },
  {
    id: "mountain_tribute",
    tag: "山越交涉",
    title: "山越酋帅献方物求市",
    speaker: "山越使者",
    portraitIcon: "⛰️",
    prompt: "江南深山部族遣使奉上藤盾犀皮与铜矿石，求允许下山换盐铁布匹，或可直接征其精壮。",
    left: {
      label: "立盟互市征矿免其兵役",
      stamp: "通商",
      preview: { treasury: "up", grain: "none", morale: "none", reputation: "up" },
      effects: { treasury: 85, reputation: 3 },
      outcomeText: "山货源源换银，府库净增 85 金、声望 +3。",
    },
    right: {
      label: "颁赐铁甲封其精锐为山地旅",
      stamp: "收编",
      preview: { treasury: "down", grain: "none", morale: "none", reputation: "none" },
      effects: { treasury: -40, troopBoost: 620, buff: { kind: "defense", value: 0.08, duration: 3, label: "山越劲旅" } },
      outcomeText: "收编山地健卒 +620 众，全军守御 +8%（3 季）！",
    },
  },
  {
    id: "silk_merchants",
    tag: "海路商税",
    title: "吴越海舶滞港请免关",
    speaker: "市舶令",
    portraitIcon: "⛵",
    prompt: "满载蜀锦香料之巨舰遇季风滞港，商贾恳求减半关钞，来年必携倍增货船复来。",
    left: {
      label: "照律全额征收充实军费",
      stamp: "依律",
      preview: { treasury: "up", grain: "none", morale: "none", reputation: "down" },
      effects: { treasury: 95, reputation: -2 },
      outcomeText: "照律征税充入国库 95 金，商贾颇叹苛重。",
    },
    right: {
      label: "减免三成且赐护航令牌",
      stamp: "招徕",
      preview: { treasury: "up", grain: "up", morale: "none", reputation: "up" },
      effects: { treasury: 40, grain: 70, reputation: 5 },
      outcomeText: "百船交誉而返，得税 40 金、买粮 70 石且声望 +5！",
    },
  },
  {
    id: "old_veteran",
    tag: "恤老抚军",
    title: "老卒负伤求归乡里",
    speaker: "军正官",
    portraitIcon: "🎖️",
    prompt: "征战十载的老兵校尉膝伤难行，请辞归耕。留营恐损体恤，厚遣又需一笔安置钱。",
    left: {
      label: "改任仓曹文职留其教导新卒",
      stamp: "留任",
      preview: { treasury: "none", grain: "none", morale: "up", reputation: "none" },
      effects: { morale: 3, techPoints: 16 },
      outcomeText: "宿卒倾囊授艺，新兵战阵纯熟（士气 +3，兵技 +16）。",
    },
    right: {
      label: "重赠养老赏田体面送归故里",
      stamp: "厚恤",
      preview: { treasury: "down", grain: "none", morale: "up", reputation: "up" },
      effects: { treasury: -35, morale: 7, reputation: 4 },
      outcomeText: "三军感泣主公不弃功臣：士气 +7，海内声望 +4！",
    },
  },
  {
    id: "bamboo_books",
    tag: "兴学文教",
    title: "郡城儒生请重修石经学宫",
    speaker: "祭酒博士",
    portraitIcon: "📚",
    prompt: "乱世战火频仍，士子聚请拨款修复崩塌的郡学经阁并招揽四方游学才俊。",
    left: {
      label: "战时当先甲兵，暂缓土木",
      stamp: "缓建",
      preview: { treasury: "none", grain: "none", morale: "none", reputation: "down" },
      effects: { reputation: -2, troopBoost: 240 },
      outcomeText: "省下土木转补战阵新兵 +240，士人略微叹息。",
    },
    right: {
      label: "兴学礼贤，重修太学招士",
      stamp: "崇文",
      preview: { treasury: "down", grain: "none", morale: "none", reputation: "up" },
      effects: { treasury: -50, reputation: 8, techPoints: 24 },
      outcomeText: "名士游学毕至：海内声望 +8，兵技策论点 +24！",
    },
  },
  {
    id: "salt_monopoly",
    tag: "盐铁国策",
    title: "豪强私煮官盐",
    speaker: "盐铁使",
    portraitIcon: "🧂",
    prompt: "大族暗于海滨私煎井盐谋暴利。收归官营可聚重金，然豪强暗控地方乡勇恐生骚动。",
    left: {
      label: "招安豪强令定额岁贡官盐",
      stamp: "羁縻",
      preview: { treasury: "up", grain: "none", morale: "up", reputation: "none" },
      effects: { treasury: 60, morale: 2 },
      outcomeText: "地方平静无扰，每年坐收贡金 +60，民生尚安。",
    },
    right: {
      label: "雷霆抄没私灶，一律盐铁官营",
      stamp: "专卖",
      preview: { treasury: "up", grain: "none", morale: "down", reputation: "none" },
      effects: { treasury: 135, morale: -4 },
      outcomeText: "国库大增 +135 金，但市面盐价略升致民心 -4。",
    },
  },
  {
    id: "river_navy_drill",
    tag: "水上演武",
    title: "水师请添造蒙冲斗舰",
    speaker: "水军都督",
    portraitIcon: "⚓",
    prompt: "水军都督奏称敌岸战船频频出没，请拨巨款与工匠加紧修造锁铁连环蒙冲舰。",
    left: {
      label: "巩固两岸烽燧守垒为主",
      stamp: "岸防",
      preview: { treasury: "down", grain: "none", morale: "none", reputation: "none" },
      effects: { treasury: -25, buff: { kind: "defense", value: 0.09, duration: 3, label: "江防连营" } },
      outcomeText: "省耗筑起沿岸壁垒：防御 +9%（3 季）！",
    },
    right: {
      label: "大力兴船加紧演练火船破浪",
      stamp: "水战",
      preview: { treasury: "down", grain: "none", morale: "none", reputation: "none" },
      effects: { treasury: -60, buff: { kind: "fire", value: 0.14, duration: 4, label: "赤焰蒙冲" }, techPoints: 18 },
      outcomeText: "水师火计大成：计略火攻 +14%（4 季）、兵技 +18！",
    },
  },
  {
    id: "night_bandits",
    tag: "治安清剿",
    title: "山匪截劫粮队后自首",
    speaker: "亭长游徼",
    portraitIcon: "🏹",
    prompt: "山中群盗夜劫军粮未遂反遭围困，盗首愿献全数赃银并率百余壮丁求降赎罪。",
    left: {
      label: "破格受降充作敢死前锋营",
      stamp: "招降",
      preview: { treasury: "up", grain: "none", morale: "none", reputation: "none" },
      effects: { treasury: 40, troopBoost: 450 },
      outcomeText: "收缴赃款 +40 金并整编百余敢死之士 +450 兵！",
    },
    right: {
      label: "尽诛首恶，将夺回粮食分予农家",
      stamp: "清乡",
      preview: { treasury: "none", grain: "up", morale: "up", reputation: "up" },
      effects: { grain: 65, morale: 6, reputation: 4 },
      outcomeText: "乡里商道从此清晏：归仓粮 +65，民心 +6，声望 +4。",
    },
  },
  {
    id: "prisoner_ransom",
    tag: "战俘处置",
    title: "敌族重金赎回族兄校尉",
    speaker: "典狱官",
    portraitIcon: "⛓️",
    prompt: "前阵擒得敌方宗亲偏将，对方遣使秘密送来二百金与五十车谷米愿秘密赎还。",
    left: {
      label: "正色拒贿，好言礼待留营感化",
      stamp: "礼遇",
      preview: { treasury: "none", grain: "none", morale: "up", reputation: "up" },
      effects: { reputation: 6, morale: 3 },
      outcomeText: "俘将感念厚待愿供军情，海内赞颂主公高义（声望 +6）！",
    },
    right: {
      label: "收银换粮放还，以实我军前线",
      stamp: "换资",
      preview: { treasury: "up", grain: "up", morale: "none", reputation: "down" },
      effects: { treasury: 140, grain: 110, reputation: -3 },
      outcomeText: "一换而得府库 +140 金、粮 +110 石，唯略损严名。",
    },
  },
  {
    id: "spring_plough",
    tag: "劝农大典",
    title: "主公是否亲耕藉田",
    speaker: "大司农",
    portraitIcon: "🌱",
    prompt: "仲春时节，大司农请主公依古礼停军务半日、亲赴郊外扶犁藉田，鼓舞四方春耕。",
    left: {
      label: "战云正密，派有司代劳而督训兵卒",
      stamp: "练兵",
      preview: { treasury: "none", grain: "none", morale: "none", reputation: "none" },
      effects: { troopBoost: 380, techPoints: 14 },
      outcomeText: "将士加练无懈：主城募兵 +380，军务心得 +14 点。",
    },
    right: {
      label: "亲执金犁三推，下令减半春税",
      stamp: "劝农",
      preview: { treasury: "down", grain: "up", morale: "up", reputation: "up" },
      effects: { treasury: -20, grain: 130, morale: 6, reputation: 5 },
      outcomeText: "万民欢呼丰年可期：收粮大增 +130 石，民心 +6，声望 +5！",
    },
  },
  {
    id: "white_horse_remnant",
    tag: "重振残骑",
    title: "失散白马义从前来投奔",
    speaker: "哨骑队长",
    portraitIcon: "🏹",
    prompt: "昔日威震塞北之白马义从百余残部携射雕神弓自乱军脱出，愿投主公帐下效命。",
    left: {
      label: "厚赐安家之资，散入诸城教习骑射",
      stamp: "授艺",
      preview: { treasury: "down", grain: "none", morale: "none", reputation: "up" },
      effects: { treasury: -35, reputation: 4, techPoints: 28 },
      outcomeText: "骑射真传融入全军：声望 +4，兵技点 +28！",
    },
    right: {
      label: "重整白马旗号直接编入大营精骑",
      stamp: "立营",
      preview: { treasury: "down", grain: "none", morale: "up", reputation: "none" },
      effects: { treasury: -50, troopBoost: 520, buff: { kind: "attack", value: 0.1, duration: 3, label: "白马忠魂" } },
      outcomeText: "「白马义从」重立！主城增锐骑 +520、攻势 +10%（3 季）！",
    },
  },
  {
    id: "comet_omen",
    tag: "星象异变",
    title: "夜观客星掠过紫微",
    speaker: "太史令",
    portraitIcon: "☄️",
    prompt: "深夜太史急奏：西方星芒异动，街头流言纷纷，揣测乃换主易旗或征战有捷之兆。",
    left: {
      label: "下《罪己安民书》宽慰天下耳目",
      stamp: "安民",
      preview: { treasury: "none", grain: "none", morale: "up", reputation: "up" },
      effects: { morale: 5, reputation: 6 },
      outcomeText: "谦恭之辞传遍朝野，谣言自散（民心 +5，声望 +6）！",
    },
    right: {
      label: "顺势传檄：此乃王师扫荡乱贼之瑞兆",
      stamp: "顺势",
      preview: { treasury: "none", grain: "none", morale: "none", reputation: "down" },
      effects: { reputation: -2, buff: { kind: "attack", value: 0.11, duration: 3, label: "星芒破阵" }, rumorEnemy: true },
      outcomeText: "军心战意暴涨 +11%（3 季），反震动敌边城守军！",
    },
  },
  {
    id: "forge_iron_ore",
    tag: "冶铁精造",
    title: "矿监报发现百炼赤铁矿脉",
    speaker: "铁官令",
    portraitIcon: "⚒️",
    prompt: "工匠回报南山采得高纯赤铁矿，若悉数铸成重甲可固城守战损，或可专锻攻城霹雳大锤。",
    left: {
      label: "倾力打造玄铁重铠守具",
      stamp: "玄甲",
      preview: { treasury: "down", grain: "none", morale: "none", reputation: "none" },
      effects: { treasury: -40, buff: { kind: "defense", value: 0.12, duration: 4, label: "百炼玄甲" } },
      outcomeText: "精铠分披前锋：全军防御 +12%（4 季）！",
    },
    right: {
      label: "铸造百具破门大铁锤与冲车头",
      stamp: "破城",
      preview: { treasury: "down", grain: "none", morale: "none", reputation: "none" },
      effects: { treasury: -40, buff: { kind: "siege", value: 0.14, duration: 4, label: "精铁冲车" } },
      outcomeText: "重型破垒器械入库：攻城威力 +14%（4 季）！",
    },
  },
  {
    id: "banquet_scholars",
    tag: "铜雀文会",
    title: "是否大宴江表及中原士族",
    speaker: "礼曹掾",
    portraitIcon: "🏮",
    prompt: "大宗亲与地方名士各望主公明示亲疏。盛宴招贤耗时耗财，然若仅招清流则恐疏军门勋旧。",
    left: {
      label: "特请三军功臣宿将把酒共醉",
      stamp: "酬勋",
      preview: { treasury: "down", grain: "none", morale: "up", reputation: "none" },
      effects: { treasury: -45, morale: 4, troopBoost: 360 },
      outcomeText: "老将壮士涕零效死，募勇大增 +360、士气 +4。",
    },
    right: {
      label: "并邀清流名士赋诗定交",
      stamp: "清赏",
      preview: { treasury: "down", grain: "none", morale: "none", reputation: "up" },
      effects: { treasury: -45, reputation: 8, techPoints: 22 },
      outcomeText: "文武并集佳话传世：海内声望 +8，兵技策论 +22！",
    },
  },
  {
    id: "reserve_grain_sell",
    tag: "平准物价",
    title: "粮价暴涨民间米贵",
    speaker: "平准令",
    portraitIcon: "⚖️",
    prompt: "岁末坊间谷价倍涨。开平准仓平价抛售可深收民心并回笼些许铜钱；抑或囤居惜售？",
    left: {
      label: "惜粮待战时高价，暂留军仓",
      stamp: "惜粮",
      preview: { treasury: "up", grain: "up", morale: "down", reputation: "down" },
      effects: { grain: 85, treasury: 50, morale: -4, reputation: -3 },
      outcomeText: "军仓积谷反涨 +85、入款 +50 金，但市井颇有微词。",
    },
    right: {
      label: "尽开官仓平价粜粮济民间",
      stamp: "平准",
      preview: { treasury: "up", grain: "down", morale: "up", reputation: "up" },
      effects: { grain: -80, treasury: 60, morale: 8, reputation: 5 },
      outcomeText: "既得平价粮钱 +60 金，更收万民拥戴（民心 +8，声望 +5）！",
    },
  },
];

/**
 * 判断本季是否仍有未批复的「君主闪电密奏」
 */
export function hasPendingRoyalCard(state) {
  if (!state?.century) return false;
  const rd = state.saga?.royalDecrees;
  if (!rd) return true;
  return rd.lastTurn !== state.turn;
}

/**
 * 从 24 张密奏中确定性抽取本季卡片（尚未批阅优先）
 */
export function drawRoyalCard(state) {
  const seen = new Set(state?.saga?.royalDecrees?.seen || []);
  const unseen = ROYAL_DECREE_CARDS.filter((c) => !seen.has(c.id));
  const pool = unseen.length ? unseen : ROYAL_DECREE_CARDS;
  const turn = state?.turn ?? 0;
  const owned = Object.values(state?.cities || {}).filter((c) => c?.owner === state?.player).length;
  const idx = (turn * 5 + owned + seen.size) % pool.length;
  return pool[idx];
}

/**
 * 批复闪电密奏（left / right）并将四维/军事奖惩真实写入天下状态
 */
export function resolveRoyalCard(state, cardId, side = "right") {
  if (!state?.century) {
    return { state, card: null, choice: null, notes: [], streak: 0, streakBonus: false };
  }
  const card = ROYAL_DECREE_CARDS.find((c) => c.id === cardId) || drawRoyalCard(state);
  const choice = side === "left" ? card.left : card.right;
  const eff = choice.effects || {};

  const next = structuredClone(state);
  const saga = ensureSaga(next);
  const player = next.player;
  const faction = next.factions?.[player];
  const notes = [];

  if (typeof eff.treasury === "number" && faction) {
    faction.treasury = Math.max(0, Math.round((faction.treasury ?? 0) + eff.treasury));
    notes.push(`府库 ${eff.treasury >= 0 ? `+${eff.treasury}` : eff.treasury}`);
  }
  if (typeof eff.grain === "number" && faction) {
    faction.grain = Math.max(0, Math.round((faction.grain ?? 0) + eff.grain));
    notes.push(`储粮 ${eff.grain >= 0 ? `+${eff.grain}` : eff.grain}`);
  }
  if (typeof eff.morale === "number") {
    for (const city of Object.values(next.cities || {})) {
      if (city?.owner === player) {
        city.morale = clamp((city.morale ?? 70) + eff.morale, 0, 100);
      }
    }
    notes.push(`民心 ${eff.morale >= 0 ? `+${eff.morale}` : eff.morale}`);
  }
  if (typeof eff.reputation === "number" && saga) {
    saga.reputation = clamp((saga.reputation ?? 50) + eff.reputation, 0, 100);
    notes.push(`声望 ${eff.reputation >= 0 ? `+${eff.reputation}` : eff.reputation}`);
  }
  if (typeof eff.techPoints === "number" && saga) {
    saga.tech ??= { points: 0, unlocked: [] };
    saga.tech.points = Math.min(9999, (saga.tech.points ?? 0) + eff.techPoints);
    notes.push(`兵技 +${eff.techPoints}`);
  }
  if (eff.buff) {
    addSagaBuff(next, { ...eff.buff, faction: player });
    notes.push(`${eff.buff.label}（${eff.buff.duration}季）`);
  }
  if (typeof eff.troopBoost === "number" && eff.troopBoost > 0) {
    const owned = Object.entries(next.cities || {}).filter(([, c]) => c?.owner === player);
    if (owned.length) {
      owned.sort((a, b) => (b[1].troops ?? 0) - (a[1].troops ?? 0));
      owned[0][1].troops = Math.min(60000, Math.round((owned[0][1].troops ?? 0) + eff.troopBoost));
      notes.push(`首府增兵 +${eff.troopBoost}`);
    }
  }
  if (eff.rumorEnemy && saga) {
    const enemyCity = Object.entries(next.cities || {}).find(([, c]) => c?.owner && c.owner !== player)?.[0];
    if (enemyCity) {
      saga.rumors ??= {};
      saga.rumors[enemyCity] = next.turn + 3;
      notes.push(`「${enemyCity}」流言动摇 3 季`);
    }
  }

  saga.royalDecrees ??= { lastTurn: -1, seen: [], streak: 0 };
  const prevTurn = saga.royalDecrees.lastTurn ?? -1;
  const nextStreak = prevTurn === next.turn - 1 || prevTurn === -1 ? (saga.royalDecrees.streak ?? 0) + 1 : 1;
  saga.royalDecrees.lastTurn = next.turn;
  saga.royalDecrees.seen = [...new Set([...(saga.royalDecrees.seen ?? []), card.id])].slice(-24);
  saga.royalDecrees.streak = nextStreak;

  let streakBonus = false;
  if (nextStreak > 0 && nextStreak % 3 === 0 && faction) {
    streakBonus = true;
    faction.treasury = Math.max(0, (faction.treasury ?? 0) + 50);
    saga.reputation = clamp((saga.reputation ?? 50) + 2, 0, 100);
    notes.push(`🌟 明君三连批赏：府库 +50 · 声望 +2`);
  }

  recordAnnal(next, "君主密奏", `批阅「${card.title}」·【${choice.stamp}】：${choice.outcomeText}`);
  return { state: next, card, choice, notes, streak: nextStreak, streakBonus };
}
