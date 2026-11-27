// v25.0 — 沉浸式「三国演义多分支剧情剧场」
// 8 幕历史名戏 × 2~3 幕多分支抉择 × 真实改变天下声望、国库粮草、科技、军心、敌城流言或名士投效

import { addSagaBuff, ensureSaga, MAX_WILD_PENDING, recordAnnal, WILD_TALENT_POOL } from "./saga.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

export const DRAMA_PLAYS = [
  {
    id: "sangu",
    title: "三顾茅庐 · 卧龙出山",
    subtitle: "隆中对策，定三分天下大计",
    badge: "寻贤名篇",
    cast: "刘备 · 诸葛亮 · 张飞",
    summary: "风雪叩柴扉，面对卧龙先生对荆益二州与天下的剖析，主公将如何礼遇并定立国策？",
    totalSteps: 3,
    scenes: {
      act1: {
        id: "act1",
        actLabel: "第一幕 · 隆中风雪",
        speaker: "张飞",
        mood: "焦躁试探",
        narration: "大雪纷飞，茅庐外寒风刺骨。已是第三次亲往隆中，小童却报先生昼寝未醒。张翼德按捺不住，欲于门后举火催醒。",
        dialogue: "「哥哥！此村夫何等傲慢，教俺一把火烧他屋后柴草，看他起不起！」",
        options: [
          {
            id: "wait_snow",
            label: "拱手立雪，戒弟守礼以待",
            style: "仁义",
            hint: "倾心敬贤，卧龙深感诚意（开启隆中深谈线）",
            nextSceneId: "act2a",
          },
          {
            id: "send_scroll",
            label: "留书言志，先递九州舆图试问天下",
            style: "霸略",
            hint: "以实务动之，考校其济世真才（开启实务对策线）",
            nextSceneId: "act2b",
          },
        ],
      },
      act2a: {
        id: "act2a",
        actLabel: "第二幕 · 隆中草堂",
        speaker: "诸葛亮",
        mood: "肃然展卷",
        narration: "诸葛亮见主公雪满双肩而神色益恭，遂整衣出迎，张挂西川五十四州舆图。",
        dialogue: "「将军既欲伸大义于天下，今曹公拥百万之众，孙权据江东已历三世，未知将军欲先取何地以为根基？」",
        options: [
          {
            id: "longzhong_plan",
            label: "愿依先生高见：跨荆益、外结东吴以待天时",
            style: "王佐",
            hint: "重政略与长远积蓄",
            nextSceneId: "act3a",
          },
          {
            id: "march_north",
            label: "中原乃龙兴枢机，当先练精锐直窥许洛",
            style: "锐进",
            hint: "重军威与当下锐气",
            nextSceneId: "act3b",
          },
        ],
      },
      act2b: {
        id: "act2b",
        actLabel: "第二幕 · 图前论剑",
        speaker: "诸葛亮",
        mood: "欣然击节",
        narration: "卧龙展阅所留九州舆图，上面兵粮关隘批注详明，不由抚掌微笑，邀入内室共筹粮秣器械之术。",
        dialogue: "「观将军舆图，非徒尚义者也！然用兵首在木牛流马与连弩之利，敢问何策为急？」",
        options: [
          {
            id: "craft_focus",
            label: "请先生执掌工械革故，先强甲兵与转运",
            style: "工巧",
            hint: "侧重科技点与军械革新",
            nextSceneId: "act3b",
          },
          {
            id: "alliance_focus",
            label: "请先生持节合纵，以三寸舌安四邻之心",
            style: "纵横",
            hint: "侧重声望与守备大阵",
            nextSceneId: "act3a",
          },
        ],
      },
      act3a: {
        id: "act3a",
        actLabel: "第三幕 · 鱼水相得",
        speaker: "诸葛亮",
        mood: "拜受军师印",
        narration: "草堂定策既成，三军上下皆感王霸有期。若卧龙尚未入幕，亦可就此举荐贤名传于郡国。",
        dialogue: "「亮虽不敏，愿效犬马之劳！从此君臣如鱼得水，誓靖中原！」",
        options: [
          {
            id: "seal_wolong",
            label: "拜为军师中郎将，颁布宽仁屯田之策",
            style: "定鼎",
            hint: "声望 +10 · 全军防御 +12%（6季）· 粮草 +260 · 若未招诸葛亮则立即访得",
            effects: {
              reputation: 10,
              grain: 260,
              techPoints: 18,
              buff: { kind: "defense", value: 0.12, duration: 6, label: "隆中定策" },
              inviteTalentId: "zhuge_liang",
              annal: "【三顾茅庐】诚感卧龙出山，颁定三分国策，军民望风归附。",
            },
          },
        ],
      },
      act3b: {
        id: "act3b",
        actLabel: "第三幕 · 砺兵整旅",
        speaker: "诸葛亮",
        mood: "羽扇轻摇",
        narration: "卧龙献上八阵图略与改良连弩法式，军中工匠连夜赶造，兵锋骤利。",
        dialogue: "「兵法之道，攻心为上，器利为先。今连弩已备，请将军点将出师！」",
        options: [
          {
            id: "forge_crossbows",
            label: "全军换装连弩，扩编精锐",
            style: "强军",
            hint: "声望 +6 · 科技点 +35 · 全军攻势 +12%（6季）· 首府增兵 +700",
            effects: {
              reputation: 6,
              techPoints: 35,
              troopBoost: 700,
              buff: { kind: "attack", value: 0.12, duration: 6, label: "损益连弩" },
              inviteTalentId: "zhuge_liang",
              annal: "【三顾茅庐】得卧龙献损益连弩与整军法式，麾下甲兵锐利倍增。",
            },
          },
        ],
      },
    },
  },
  {
    id: "huarong",
    title: "华容道 · 义释枭雄",
    subtitle: "泥泞绝境中的恩义与霸业抉择",
    badge: "忠义名篇",
    cast: "关羽 · 曹操 · 诸葛亮",
    summary: "赤壁溃败，曹军衣甲不全困于华容泥道。面前是旧日厚恩的枭雄，身后是军令状与天下版图。",
    totalSteps: 3,
    scenes: {
      act1: {
        id: "act1",
        actLabel: "第一幕 · 泥道截杀",
        speaker: "关羽",
        mood: "横刀勒马",
        narration: "烟尘尽处，残兵败甲踉跄而出，青龙偃月刀寒光映面。曹操勒马拱手，提及昔日许昌上马金下马银之旧谊。",
        dialogue: "「将军别来无恙！今日虽兵败势穷，然五关斩将之时，我未曾遣一兵相阻，将军岂无水木之念乎？」",
        options: [
          {
            id: "hesitate_duty",
            label: "念及旧恩而犹豫，责其欺君却未即时挥刀",
            style: "忠义",
            hint: "进入义节与天下舆论博弈",
            nextSceneId: "act2a",
          },
          {
            id: "press_hard",
            label: "怒叱「既知大义，何敢挟天子」，催兵合围",
            style: "铁律",
            hint: "进入重赏索质与战场肃清",
            nextSceneId: "act2b",
          },
        ],
      },
      act2a: {
        id: "act2a",
        actLabel: "第二幕 · 群将泣求",
        speaker: "张辽",
        mood: "故人跪恳",
        narration: "张文远纵马上前下拜，曹军士卒见状纷纷泣伏泥淖。此时关平进言军法不可废，而旧友之情亦难违。",
        dialogue: "「云长兄！今曹公虽败，若杀之恐成北地死战之局；莫若留其半壁残喘，以待两虎相制！」",
        options: [
          {
            id: "release_high",
            label: "「义不负恩，法不失信」—— 放开一角，索其军资誓书",
            style: "侠义",
            hint: "名震四海，收缴大宗军资而留余地",
            nextSceneId: "act3a",
          },
          {
            id: "capture_baggage",
            label: "纵曹操单骑北归，悉数收降其后队輜重与战马",
            style: "权衡",
            hint: "实惠兵马粮饷，士气大振",
            nextSceneId: "act3b",
          },
        ],
      },
      act2b: {
        id: "act2b",
        actLabel: "第二幕 · 绝境困兽",
        speaker: "曹操",
        mood: "决死一搏",
        narration: "见去路已被校刀手封死，许褚等亲卫拔剑护主，泥泞道中爆发最后惨烈血战。",
        dialogue: "「大丈夫宁死于阵，岂束手于泥涂！诸将随我冲杀出路！」",
        options: [
          {
            id: "seize_supplies",
            label: "趁乱尽夺旗鼓甲仗，震慑敌境诸城",
            style: "威震",
            hint: "强攻军威与临敌动摇",
            nextSceneId: "act3b",
          },
          {
            id: "strict_discipline",
            label: "收兵严整军法，向麾下明赏罚",
            style: "严整",
            hint: "锤炼铁军防线",
            nextSceneId: "act3a",
          },
        ],
      },
      act3a: {
        id: "act3a",
        actLabel: "第三幕 · 义绝千秋",
        speaker: "关羽",
        mood: "回营请罪",
        narration: "华容一役传遍九州，天下士人无不叹服我军「重信守义，临阵不欺」，归降附义之声日隆。",
        dialogue: "「关某虽违将令，幸未负平生所学！愿倾家赀劳军，请主公治罪。」",
        options: [
          {
            id: "pardon_honor",
            label: "免其军法而嘉其信义，全军士气振奋",
            style: "收心",
            hint: "声望 +12 · 钱粮 +160/+180 · 城池士气 +10",
            effects: {
              reputation: 12,
              treasury: 160,
              grain: 180,
              moraleBoost: 10,
              annal: "【华容道】义释旧恩并严整军纪，九州士人皆颂主公宽仁大度。",
            },
          },
        ],
      },
      act3b: {
        id: "act3b",
        actLabel: "第三幕 · 缴获盈仓",
        speaker: "关平",
        mood: "清点俘获",
        narration: "大军沿华容泥道收拢遗弃的战甲粮车百余乘，敌方败兵退散诸城皆心胆俱裂。",
        dialogue: "「禀主公！得精甲三千、粮秣无数，足供三军两季征伐之用！」",
        options: [
          {
            id: "arm_legion",
            label: "甲兵尽归前敌，动摇邻境敌城守心",
            style: "破敌",
            hint: "府库 +220 · 粮草 +260 · 全军攻击 +10%（5季）· 敌边城流言动摇",
            effects: {
              treasury: 220,
              grain: 260,
              rumorEnemy: true,
              buff: { kind: "attack", value: 0.1, duration: 5, label: "华容缴获" },
              annal: "【华容道】截获北军大批甲仗粮车，敌境邻城风声鹤唳。",
            },
          },
        ],
      },
    },
  },
  {
    id: "dandao",
    title: "单刀赴会 · 孤胆镇荆",
    subtitle: "一叶轻舟入虎穴，折冲樽俎定江防",
    badge: "胆略名篇",
    cast: "关羽 · 鲁肃 · 周泰",
    summary: "东吴邀宴索荆州，刀斧手已伏于亭下。孤身赴宴，如何以气魄反客为主？",
    totalSteps: 3,
    scenes: {
      act1: {
        id: "act1",
        actLabel: "第一幕 · 临江亭宴",
        speaker: "鲁肃",
        mood: "礼敬而严",
        narration: "江风猎猎，临江亭上酒过三巡。鲁子敬放下酒爵，直指荆州三郡归属，亭下吕蒙、甘宁暗按刀柄。",
        dialogue: "「昔日借荆州以图西川，今西川既定，岂容久假不归？」",
        options: [
          {
            id: "argue_alliance",
            label: "侃侃而言：汉室未复而曹魏未灭，岂可自毁长城",
            style: "大义",
            hint: "以抗曹大局压服群将，占据道义高地",
            nextSceneId: "act2a",
          },
          {
            id: "grip_blade",
            label: "左手持杯右手挽鲁肃腕，笑着提及先主破敌血战",
            style: "豪胆",
            hint: "霸气镇场，令伏兵不敢妄动",
            nextSceneId: "act2b",
          },
        ],
      },
      act2a: {
        id: "act2a",
        actLabel: "第二幕 · 舌压江东",
        speaker: "关羽",
        mood: "声若洪钟",
        narration: "席间吴将欲拔剑争辩，却被重义之言堵得哑口无言，鲁肃亦暗暗点头。",
        dialogue: "「此乃国家大事，皆在座上酒中决之，岂容武夫多言！」",
        options: [
          {
            id: "trade_treaty",
            label: "重申江防互市之约，各安疆界",
            style: "安边",
            hint: "获丰厚国库军费与城防稳固",
            nextSceneId: "act3a",
          },
          {
            id: "deter_border",
            label: "陈说我军战船水师之盛，不战而屈人之兵",
            style: "威慑",
            hint: "强化攻城器械与科技储备",
            nextSceneId: "act3b",
          },
        ],
      },
      act2b: {
        id: "act2b",
        actLabel: "第二幕 · 醉扯子敬",
        speaker: "周仓",
        mood: "持刀护主",
        narration: "「莫以酒醉相戏！」关羽佯醉起身，左手亲挽鲁肃右臂步下江矶，江东数百伏兵投鼠忌器，只得目送青龙舟扬帆而去。",
        dialogue: "「今日承蒙子敬盛情，改日再请过江吃酒！」",
        options: [
          {
            id: "sail_triumph",
            label: "登舟击鼓凯旋，令三军传颂孤胆威名",
            style: "神威",
            hint: "三军士气大涨，主力增员",
            nextSceneId: "act3b",
          },
          {
            id: "fortify_river",
            label: "归营立即沿江增筑烽燧水栅",
            style: "固防",
            hint: "防御加成与粮仓充盈",
            nextSceneId: "act3a",
          },
        ],
      },
      act3a: {
        id: "act3a",
        actLabel: "第三幕 · 江表生敬",
        speaker: "鲁肃",
        mood: "临江目送",
        narration: "东吴见我方君臣胆魄兼备、疆界谨严，遂息兵戈而通商船，南郡水陆皆安。",
        dialogue: "「云长真天下英雄，不可轻图也。」",
        options: [
          {
            id: "consolidate_peace",
            label: "广开江津互市，加固城防",
            style: "稳境",
            hint: "声望 +9 · 府库 +240 · 全军防御 +12%（5季）",
            effects: {
              reputation: 9,
              treasury: 240,
              buff: { kind: "defense", value: 0.12, duration: 5, label: "单刀镇荆" },
              annal: "【单刀赴会】孤胆入席折冲尊俎，邻邦敬惮而不敢轻动。",
            },
          },
        ],
      },
      act3b: {
        id: "act3b",
        actLabel: "第三幕 · 威名惊世",
        speaker: "关羽",
        mood: "归帆破浪",
        narration: "「单刀赴会」之事不胫而走，各镇壮士闻风投效，水陆精锐斗志如虹。",
        dialogue: "「天下英雄如过江之鲫，惟我军不可折其锐气！」",
        options: [
          {
            id: "rally_braves",
            label: "大赏勇烈，扩充舟师与步锐",
            style: "雄威",
            hint: "声望 +8 · 增兵 +800 · 全军攻势 +10%（5季）· 士气 +8",
            effects: {
              reputation: 8,
              troopBoost: 800,
              moraleBoost: 8,
              buff: { kind: "attack", value: 0.1, duration: 5, label: "孤胆惊敌" },
              annal: "【单刀赴会】单刀过江安然还营，壮士云从，军势大盛。",
            },
          },
        ],
      },
    },
  },
  {
    id: "kongcheng",
    title: "西城空城计 · 琴音退敌",
    subtitle: "老兵五百对十五万大军，一曲清音定生死",
    badge: "奇谋名篇",
    cast: "诸葛亮 · 司马懿 · 司马昭",
    summary: "敌大军骤临城下而守兵尽出，唯余老弱残卒。生死一瞬，敢不敢大开四门抚琴焚香？",
    totalSteps: 3,
    scenes: {
      act1: {
        id: "act1",
        actLabel: "第一幕 · 兵临西城",
        speaker: "哨探",
        mood: "飞马报急",
        narration: "尘头起处，十五万精锐铺天盖地扑向西城，城内却只余运粮军二千五百余人，众官面如土色，皆请弃城而逃。",
        dialogue: "「主公！司马大军距城不足二十里，城无大将，如何御之？」",
        options: [
          {
            id: "open_gates",
            label: "传令尽藏旌旗，大开四门各派老卒洒扫街道，于城楼焚香抚琴",
            style: "奇险",
            hint: "极险之局，以心理重创老辣统帅",
            nextSceneId: "act2a",
          },
          {
            id: "feint_banners",
            label: "令城内遍竖疑兵虚旗，鸣鼓震天作将伏击之状",
            style: "疑阵",
            hint: "以虚声夺人，稳健阻滞敌锋",
            nextSceneId: "act2b",
          },
        ],
      },
      act2a: {
        id: "act2a",
        actLabel: "第二幕 · 琴断心弦",
        speaker: "司马懿",
        mood: "勒马凝望",
        narration: "司马懿兵至城下，见城楼上一名羽扇纶巾者笑容可掬，左右仅二童子捧剑持拂，琴音清越而不乱，不由惊疑万分。",
        dialogue: "「平生谨慎之人，今反大开城门，城内必有重兵埋伏！莫要中其诱敌之计！」",
        options: [
          {
            id: "play_calmly",
            label: "弦音越发从容，甚至失笑挑弦，待其自溃",
            style: "攻心",
            hint: "司马大骇退军，我方趁势反制敌前哨",
            nextSceneId: "act3a",
          },
          {
            id: "ambush_rear",
            label: "暗传偏师尾随鼓噪，放大敌军惊慌退却",
            style: "反击",
            hint: "敌退散遗弃大量器械粮秣",
            nextSceneId: "act3b",
          },
        ],
      },
      act2b: {
        id: "act2b",
        actLabel: "第二幕 · 旌旗疑阵",
        speaker: "司马昭",
        mood: "迟疑观望",
        narration: "城上鼓角连天、旌旗密布，敌先锋忌惮山险伏兵，不敢贸然攀城，原地扎营试探。",
        dialogue: "「父亲！莫非空城虚张声势？孩儿愿领一哨试探虚实。」",
        options: [
          {
            id: "fire_dummy",
            label: "乘夜点燃预设柴草疑阵，制造数路伏兵假象",
            style: "虚实",
            hint: "守全城军民并保重粮草",
            nextSceneId: "act3a",
          },
          {
            id: "counter_scouts",
            label: "遣百余锐士夜袭敌哨，抓舌头乱其军情",
            style: "奇袭",
            hint: "截获密函并动摇敌阵",
            nextSceneId: "act3b",
          },
        ],
      },
      act3a: {
        id: "act3a",
        actLabel: "第三幕 · 抚掌大笑",
        speaker: "诸葛亮",
        mood: "拭汗长笑",
        narration: "敌十五万大军果真倒退数十里，众官始服神机妙算。各镇守军守心从此坚如磐石。",
        dialogue: "「非吾好险也，盖不得不行耳！司马见疑，此城乃全。」",
        options: [
          {
            id: "master_stratagem",
            label: "梳理疑兵战例编入兵书，全军受惠",
            style: "兵圣",
            hint: "声望 +10 · 科技点 +40 · 全军防御 +14%（6季）",
            effects: {
              reputation: 10,
              techPoints: 40,
              buff: { kind: "defense", value: 0.14, duration: 6, label: "空城御敌" },
              annal: "【西城空城计】一曲清音退却大军，妙算传为兵家绝唱。",
            },
          },
        ],
      },
      act3b: {
        id: "act3b",
        actLabel: "第三幕 · 乘虚收利",
        speaker: "姜维",
        mood: "追击报捷",
        narration: "敌大军仓皇北退时沿途丢弃大量弩矢与屯粮，近郊敌城守将闻之莫不震骇。",
        dialogue: "「丞相神机！敌前军自相践踏，丢下许多粮秣辎重！」",
        options: [
          {
            id: "harvest_retreat",
            label: "尽收敌弃辎重，散布敌军退怯流言",
            style: "夺势",
            hint: "粮草 +280 · 科技点 +24 · 计略火攻 +15%（5季）· 敌边城动摇",
            effects: {
              grain: 280,
              techPoints: 24,
              rumorEnemy: true,
              buff: { kind: "fire", value: 0.15, duration: 5, label: "奇谋震敌" },
              annal: "【西城空城计】疑兵退敌后乘势收缴粮重，敌境边城军心动摇。",
            },
          },
        ],
      },
    },
  },
  {
    id: "wuchao",
    title: "火烧乌巢 · 奇袭断粮",
    subtitle: "换敌旗号夜渡官渡，一炬焚尽袁军根本",
    badge: "火攻名篇",
    cast: "曹操 · 许攸 · 淳于琼",
    summary: "两军相峙粮尽兵疲，忽得降将献密：敌军万里粮秣尽屯乌巢。敢孤军冒敌旗夜奔百里吗？",
    totalSteps: 3,
    scenes: {
      act1: {
        id: "act1",
        actLabel: "第一幕 · 夜半密献",
        speaker: "许攸",
        mood: "叩营急陈",
        narration: "夜色如墨，账内仅有三日军粮。许子远连夜投奔，指出乌巢囤积百万斛粮谷而守将昏醉无备。",
        dialogue: "「主公尚有几何粮？若不急袭乌巢，不出十日，大军不战自溃！」",
        options: [
          {
            id: "disguise_raid",
            label: "亲率五千步骑，衔枚裹马蹄、假借敌军旗号星夜驰奔",
            style: "奇袭",
            hint: "险中求胜，火势摧城拔寨",
            nextSceneId: "act2a",
          },
          {
            id: "pincer_plan",
            label: "分兵正面佯攻官渡大营牵制，偏师绕袭乌巢外围",
            style: "合围",
            hint: "稳健分进，减少前线破绽",
            nextSceneId: "act2b",
          },
        ],
      },
      act2a: {
        id: "act2a",
        actLabel: "第二幕 · 围火四合",
        speaker: "荀攸",
        mood: "决断传令",
        narration: "大军赶到乌巢，沿途逢袁军哨骑皆称「蒋奇护粮」，及至营外忽传「大军追至身后！」，诸将色变请分兵拒后。",
        dialogue: "「贼在背后，至营当绝战！岂可回首自乱！」",
        options: [
          {
            id: "all_in_fire",
            label: "厉喝「贼在背后，乃可破贼！」纵死士四面抛火入粮垛",
            style: "破釜",
            hint: "乌巢化作火海，攻势达至巅峰",
            nextSceneId: "act3a",
          },
          {
            id: "loot_before_burn",
            label: "先抢运精粮千石，再焚其连营粮山",
            style: "实利",
            hint: "兼收大量粮草与府库战利品",
            nextSceneId: "act3b",
          },
        ],
      },
      act2b: {
        id: "act2b",
        actLabel: "第二幕 · 声东击西",
        speaker: "张辽",
        mood: "甲胄待发",
        narration: "正面官渡鼓声撼地，敌主力误以为决战已启，浑然不知乌巢后方已被我轻骑切入。",
        dialogue: "「前阵喊杀正酣，正是偏师纵火断粮的绝佳良机！」",
        options: [
          {
            id: "burn_depot_clean",
            label: "火箭齐发焚毁仓廪，切断敌阵补给",
            style: "断粮",
            hint: "提升我方攻城与计略威力",
            nextSceneId: "act3a",
          },
          {
            id: "seize_convoy",
            label: "截留转运车队而还，充实本军府库",
            style: "劫粮",
            hint: "粮草大增且扩充前敌军势",
            nextSceneId: "act3b",
          },
        ],
      },
      act3a: {
        id: "act3a",
        actLabel: "第三幕 · 烈焰定局",
        speaker: "曹操",
        mood: "火光映甲",
        narration: "赤焰冲天，百里之外皆见乌巢火光，敌军前线闻粮绝而大溃，千古奇袭名垂青史。",
        dialogue: "「此战非力胜，乃断敌咽喉之智胜也！」",
        options: [
          {
            id: "flame_victory",
            label: "全军趁势衔尾猛攻，火计连城",
            style: "火威",
            hint: "声望 +8 · 计略火攻 +18%（5季）· 全军攻势 +10%（5季）· 敌边城动摇",
            effects: {
              reputation: 8,
              rumorEnemy: true,
              buff: { kind: "fire", value: 0.18, duration: 5, label: "乌巢炬火" },
              extraBuff: { kind: "attack", value: 0.1, duration: 5, label: "断粮追击" },
              annal: "【火烧乌巢】夜袭断敌粮草根本，烈焰冲天，敌众大溃。",
            },
          },
        ],
      },
      act3b: {
        id: "act3b",
        actLabel: "第三幕 · 因粮于敌",
        speaker: "许攸",
        mood: "抚掌欣慰",
        narration: "我军转危为安，军粮满仓、甲马肥壮，更有多员敌将望风来降。",
        dialogue: "「所谓因粮于敌，此之谓也！今国库充足，可图进取！」",
        options: [
          {
            id: "feast_army",
            label: "大犒三军并补充精兵与粮饷",
            style: "富足",
            hint: "府库 +180 · 粮草 +360 · 增兵 +650 · 攻势 +8%（4季）",
            effects: {
              treasury: 180,
              grain: 360,
              troopBoost: 650,
              buff: { kind: "attack", value: 0.08, duration: 4, label: "因粮于敌" },
              annal: "【火烧乌巢】奇袭获敌大宗军粮，兵精粮足，士气大振。",
            },
          },
        ],
      },
    },
  },
  {
    id: "menghuo",
    title: "七擒孟获 · 攻心南中",
    subtitle: "百战不杀，令蛮王俯首心服「南人不复反」",
    badge: "平南名篇",
    cast: "诸葛亮 · 孟获 · 祝融",
    summary: "南中险远多毒瘴，擒住孟获容易，要令南境永不复反却难。如何用兵并服其心？",
    totalSteps: 3,
    scenes: {
      act1: {
        id: "act1",
        actLabel: "第一幕 · 南蛮初擒",
        speaker: "孟获",
        mood: "怒目不服",
        narration: "险山恶水之间初擒蛮王孟获。帐下刀斧手请斩以立威，孟获却昂首不跪，称若非误入深谷绝不肯服。",
        dialogue: "「汉人多诈，趁吾山径失察乃得擒吾！敢放我回去再排阵列战否？」",
        options: [
          {
            id: "release_show_camp",
            label: "解绑设宴，亲引其遍观我军营垒器械而后纵归再战",
            style: "攻心",
            hint: "示以坦荡王师之威，走攻心长略",
            nextSceneId: "act2a",
          },
          {
            id: "use_fire_vines",
            label: "以铁甲火攻破其藤甲与兽阵，令其知天威难犯",
            style: "兵威",
            hint: "先挫其锋芒，再谈归化之事",
            nextSceneId: "act2b",
          },
        ],
      },
      act2a: {
        id: "act2a",
        actLabel: "第二幕 · 七擒七纵",
        speaker: "马谡",
        mood: "从旁进策",
        narration: "孟获几度诈降、几度复叛，乃至请来秃龙洞毒泉与乌戈藤甲，最终却在盘蛇谷与大营屡次落入掌握却仍被礼遇释放。",
        dialogue: "「主公！此番第七次纵之，蛮中酋豪无不震悚，唯孟获垂泣而立。」",
        options: [
          {
            id: "teach_farming",
            label: "赐其耕牛盐铁农书，令南人与中原一体共治",
            style: "怀柔",
            hint: "永靖后方，大增声望与民生粮产",
            nextSceneId: "act3a",
          },
          {
            id: "recruit_warriors",
            label: "编练无当飞军与象兵藤甲精锐，纳入王师",
            style: "强兵",
            hint: "南中精兵归心，增兵力与攻势",
            nextSceneId: "act3b",
          },
        ],
      },
      act2b: {
        id: "act2b",
        actLabel: "第二幕 · 火焚盘蛇",
        speaker: "孟获",
        mood: "肝胆俱寒",
        narration: "黑油火箭与猛兽火牛破尽南蛮锐气，孟获脱冠散发出降，仍惊悸不已。",
        dialogue: "「天威如此！我等蛮人若再敢举兵，天必灭之！」",
        options: [
          {
            id: "stabilize_south",
            label: "安抚部族、兴修山道，保边境长久安靖",
            style: "定疆",
            hint: "后方稳固、粮产兴旺",
            nextSceneId: "act3a",
          },
          {
            id: "arm_wudang",
            label: "收编藤甲与山地飞军为先登",
            style: "精兵",
            hint: "强化战力并补充大量兵力",
            nextSceneId: "act3b",
          },
        ],
      },
      act3a: {
        id: "act3a",
        actLabel: "第三幕 · 南人不反",
        speaker: "孟获",
        mood: "稽首泪流",
        narration: "「公，天威也，南人不复反矣！」自此南中金银丹漆耕牛源源输往前线，再无后顾之忧。",
        dialogue: "「愿世世恭顺王化，永奉大军北定中原！」",
        options: [
          {
            id: "settle_nanzhong",
            label: "设官屯田、通好百越各部",
            style: "安南",
            hint: "声望 +12 · 府库 +220 · 粮草 +260 · 全城士气 +10",
            effects: {
              reputation: 12,
              treasury: 220,
              grain: 260,
              moraleBoost: 10,
              annal: "【七擒孟获】攻心为上，蛮王涕泣心服，南境永安且输粮百万。",
            },
          },
        ],
      },
      act3b: {
        id: "act3b",
        actLabel: "第三幕 · 无当成军",
        speaker: "王平",
        mood: "检阅新旅",
        narration: "南中精勇选拔成军，善履险阻、勇冠三军，更有祝融、带来等部族头人献方物投效。",
        dialogue: "「山地劲旅既成，无论登高涉险，皆可先登破敌！」",
        options: [
          {
            id: "form_vanguard",
            label: "整编南中劲旅随军北伐",
            style: "劲旅",
            hint: "声望 +8 · 增兵 +900 · 全军攻势 +11%（5季）· 若未招王平则访得",
            effects: {
              reputation: 8,
              troopBoost: 900,
              buff: { kind: "attack", value: 0.11, duration: 5, label: "无当劲旅" },
              inviteTalentId: "wang_ping",
              annal: "【七擒孟获】收服南中精锐编成劲旅，兵力与野战锐气大增。",
            },
          },
        ],
      },
    },
  },
  {
    id: "baidi",
    title: "白帝托孤 · 君臣肝胆",
    subtitle: "永安宫夜灯如豆，一纸遗诏见古今至诚",
    badge: "家国名篇",
    cast: "先主 · 诸葛亮 · 赵云",
    summary: "永安病笃之际，面对鞠躬尽瘁之辅臣与尚待整顿的朝局，将留下怎样的遗命与盟约？",
    totalSteps: 3,
    scenes: {
      act1: {
        id: "act1",
        actLabel: "第一幕 · 永安寝殿",
        speaker: "先主",
        mood: "握腕垂涕",
        narration: "永安宫内香烟袅袅，三峡夜涛隐隐传响。百官屏息阶外，唯重臣伏跪榻前，汗流遍体。",
        dialogue: "「君才十倍曹丕，必能安国，终定大事。若嗣子可辅，辅之；如其不才，君可自取！」",
        options: [
          {
            id: "swear_loyalty",
            label: "叩头流血泣言：「臣敢竭股肱之力，效忠贞之节，继之以死！」",
            style: "至忠",
            hint: "千古君臣大义，朝堂内外人心铁板一块",
            nextSceneId: "act2a",
          },
          {
            id: "forge_institution",
            label: "当廷请立严明法度与军机共议之制，杜绝内耗",
            style: "法治",
            hint: "以制度稳固社稷与科研积淀",
            nextSceneId: "act2b",
          },
        ],
      },
      act2a: {
        id: "act2a",
        actLabel: "第二幕 · 泣受遗诏",
        speaker: "赵云",
        mood: "按剑肃立",
        narration: "殿外宿将赵云等亲闻君臣托付之言，皆感泣伏地，誓死拱卫朝纲与四方疆土。",
        dialogue: "「主公安心！内有贤相，外有宿将，四境必安如泰山！」",
        options: [
          {
            id: "amnesty_morale",
            label: "颁布大赦与抚恤烈士遗孤令，凝聚万民",
            style: "仁政",
            hint: "声望与全国士气大幅提升",
            nextSceneId: "act3a",
          },
          {
            id: "defend_borders",
            label: "急颁守御诸关令，固防待变",
            style: "固国",
            hint: "防御与城防保障拉满",
            nextSceneId: "act3b",
          },
        ],
      },
      act2b: {
        id: "act2b",
        actLabel: "第二幕 · 纲纪重整",
        speaker: "诸葛亮",
        mood: "执笔定章",
        narration: "永安之夜，君臣共拟《出师》《理政》条章，赏罚无私，清简官署节省大批府库之用。",
        dialogue: "「宫中府中，俱为一体，陟罚臧否，不宜异同。」",
        options: [
          {
            id: "reform_state",
            label: "裁减冗费、劝农讲武，厉精图治",
            style: "清政",
            hint: "兼得国库、粮草与科技突破",
            nextSceneId: "act3b",
          },
          {
            id: "inspire_scholars",
            label: "召天下名士共议兴复大业",
            style: "集贤",
            hint: "声望高涨并获科技支持",
            nextSceneId: "act3a",
          },
        ],
      },
      act3a: {
        id: "act3a",
        actLabel: "第三幕 · 肝胆相照",
        speaker: "诸葛亮",
        mood: "瞻拜北望",
        narration: "白帝托孤之诚感格天地，全境军民上下一心、士气绝伦，再无叛离之虞。",
        dialogue: "「先帝遗命在耳，臣虽死不辱使命！」",
        options: [
          {
            id: "unify_hearts",
            label: "上下同心共御外侮，振兴朝纲",
            style: "万众",
            hint: "声望 +15 · 全军防御 +14%（6季）· 全城士气 +14",
            effects: {
              reputation: 15,
              moraleBoost: 14,
              buff: { kind: "defense", value: 0.14, duration: 6, label: "托孤忠贞" },
              annal: "【白帝托孤】君臣至诚感动天下，全境军心归附，士气高昂。",
            },
          },
        ],
      },
      act3b: {
        id: "act3b",
        actLabel: "第三幕 · 休养国力",
        speaker: "诸葛亮",
        mood: "筹策远图",
        narration: "政令既清、农桑大兴，各郡府库逐季丰盈，工械营造有条不紊。",
        dialogue: "「务农殖谷，闭关息民，而后可以待时而动。」",
        options: [
          {
            id: "enrich_state",
            label: "兴修农桑府库，积蓄科技实底",
            style: "富强",
            hint: "声望 +8 · 府库 +220 · 粮草 +260 · 科技点 +36",
            effects: {
              reputation: 8,
              treasury: 220,
              grain: 260,
              techPoints: 36,
              annal: "【白帝托孤】整饬朝纲法度，节省冗费劝农桑，国用骤充。",
            },
          },
        ],
      },
    },
  },
  {
    id: "shezhan",
    title: "舌战江东 · 联吴抗曹",
    subtitle: "一介书生直面江东群儒，立盟约于唇枪舌剑间",
    badge: "纵横名篇",
    cast: "使节 · 张昭 · 鲁肃 · 周瑜",
    summary: "北师压境，江东诸儒主降声甚高。独自踏入柴桑大堂，如何以一人之舌压倒群臣促成联盟？",
    totalSteps: 3,
    scenes: {
      act1: {
        id: "act1",
        actLabel: "第一幕 · 群儒发难",
        speaker: "张昭",
        mood: "连珠逼问",
        narration: "柴桑厅上儒士二十余人列坐。张子布抚须冷笑，质疑我方既败于长坂、兵不过万，何敢轻言联手抗敌？",
        dialogue: "「今新败失土，不审先生自比管仲乐毅，然亦能存一隅之地乎？」",
        options: [
          {
            id: "sharp_rebuttal",
            label: "肃然反诘：「避其凶锋以待时，岂如堂上诸君坐议降表、唯图保妻子之私！」",
            style: "凌厉",
            hint: "正面驳倒主降派，直击江东士人痛处",
            nextSceneId: "act2a",
          },
          {
            id: "cool_analysis",
            label: "笑展舆图，细数北军水土不服、后患尚存之四大隐忧",
            style: "理析",
            hint: "以实势打动中间派与鲁肃",
            nextSceneId: "act2b",
          },
        ],
      },
      act2a: {
        id: "act2a",
        actLabel: "第二幕 · 激将公瑾",
        speaker: "周瑜",
        mood: "按剑起身",
        narration: "群儒尽皆辞穷。入内见水军大都督周瑜，公瑾故意作色言「降敌亦可享富贵」，试探我方真实决心。",
        dialogue: "「操众号百万，水陆并进，足下何以教瑜必破之策？」",
        options: [
          {
            id: "ignite_pride",
            label: "妙言铜雀台与二乔故事，激起江东上下雪耻雄心",
            style: "奇谋",
            hint: "周瑜怒起誓师，战意全开",
            nextSceneId: "act3a",
          },
          {
            id: "joint_fire",
            label: "直陈「万事俱备、唯待顺风」之火攻水战方略",
            style: "协同",
            hint: "双军合练水战火计",
            nextSceneId: "act3b",
          },
        ],
      },
      act2b: {
        id: "act2b",
        actLabel: "第二幕 · 合纵定盟",
        speaker: "鲁肃",
        mood: "击节称善",
        narration: "席间众儒渐为精辟地缘分析折服，鲁肃趁势引见江东实权将校，共议水陆互援与军需调拨。",
        dialogue: "「先生之论胜于百万之师！请速议盟约条款与军资互助之数。」",
        options: [
          {
            id: "aid_gold_grain",
            label: "促成江东借船运粮，支援我方军费与科技工匠",
            style: "盟援",
            hint: "府库、科技点与友军支持",
            nextSceneId: "act3b",
          },
          {
            id: "joint_assault",
            label: "相约水陆并举，约定合围攻势",
            style: "联兵",
            hint: "提升声望与攻城突破力",
            nextSceneId: "act3a",
          },
        ],
      },
      act3a: {
        id: "act3a",
        actLabel: "第三幕 · 破釜决战",
        speaker: "周瑜",
        mood: "拔剑砍案",
        narration: "周瑜拔剑砍去桌案一角：「再敢言降者，与此案同！」两家同盟固若金汤，水陆火攻之策大行。",
        dialogue: "「请君回营整备，不日共燃连环战船于大江之上！」",
        options: [
          {
            id: "seal_chibi",
            label: "立盟誓师，共习连环火攻与攻城",
            style: "合盟",
            hint: "声望 +10 · 计略火攻 +16%（5季）· 攻城器械 +12%（5季）",
            effects: {
              reputation: 10,
              buff: { kind: "fire", value: 0.16, duration: 5, label: "江东联火" },
              extraBuff: { kind: "siege", value: 0.12, duration: 5, label: "楼船共进" },
              annal: "【舌战江东】一人之力折服群儒、激将定盟，两家合纵之势已成。",
            },
          },
        ],
      },
      act3b: {
        id: "act3b",
        actLabel: "第三幕 · 唇齿相依",
        speaker: "鲁肃",
        mood: "举杯祝捷",
        narration: "江东工匠与艨艟图纸随使节团回赠，双方互换粮资信使，友邻敌城皆闻盟声而戒惧。",
        dialogue: "「自此唇齿相依，北军虽众，不足惧也！」",
        options: [
          {
            id: "collect_aid",
            label: "收纳盟邦军资图纸，整训战船",
            style: "富盟",
            hint: "声望 +8 · 府库 +220 · 科技点 +32 · 攻势 +9%（4季）",
            effects: {
              reputation: 8,
              treasury: 220,
              techPoints: 32,
              buff: { kind: "attack", value: 0.09, duration: 4, label: "江东协援" },
              annal: "【舌战江东】凭明辩促成战资互援，得盟邦艨艟图纸与钱粮相助。",
            },
          },
        ],
      },
    },
  },
];

/**
 * 列出全 8 幕演义名剧及其在本局中的演绎状态
 */
export function listDramaPlays(state) {
  const played = new Set(state?.saga?.dramasPlayed || []);
  const available = Boolean(state?.century);
  return DRAMA_PLAYS.map((play) => ({
    ...play,
    played: played.has(play.id),
    playable: available && !played.has(play.id),
  }));
}

/**
 * 统计当前可演绎的未演剧目数（非史诗模式返回 0）
 */
export function unplayedDramaCount(state) {
  if (!state?.century) return 0;
  const played = new Set(state?.saga?.dramasPlayed || []);
  return DRAMA_PLAYS.filter((p) => !played.has(p.id)).length;
}

/**
 * 开演一部指定演义剧目
 */
export function startDramaPlay(playId) {
  const play = DRAMA_PLAYS.find((p) => p.id === playId) || DRAMA_PLAYS[0];
  return {
    playId: play.id,
    title: play.title,
    subtitle: play.subtitle,
    cast: play.cast,
    sceneId: "act1",
    step: 1,
    totalSteps: play.totalSteps || 3,
    choices: [],
    history: [],
    done: false,
    resultSummary: "",
  };
}

export function currentDramaScene(session) {
  if (!session) return null;
  const play = DRAMA_PLAYS.find((p) => p.id === session.playId);
  if (!play) return null;
  return play.scenes[session.sceneId] || null;
}

function applyDramaEffects(state, effects) {
  if (!state?.century || !effects) return [];
  const saga = ensureSaga(state);
  const player = state.player;
  const faction = state.factions?.[player];
  const notes = [];

  if (typeof effects.reputation === "number" && saga) {
    saga.reputation = clamp((saga.reputation ?? 50) + effects.reputation, 0, 100);
    notes.push(`声望 ${effects.reputation > 0 ? `+${effects.reputation}` : effects.reputation}`);
  }
  if (typeof effects.treasury === "number" && faction) {
    faction.treasury = Math.max(0, Math.round((faction.treasury ?? 0) + effects.treasury));
    notes.push(`府库 +${effects.treasury}`);
  }
  if (typeof effects.grain === "number" && faction) {
    faction.grain = Math.max(0, Math.round((faction.grain ?? 0) + effects.grain));
    notes.push(`粮草 +${effects.grain}`);
  }
  if (typeof effects.techPoints === "number" && saga) {
    saga.tech ??= { points: 0, unlocked: [] };
    saga.tech.points = Math.min(9999, (saga.tech.points ?? 0) + effects.techPoints);
    notes.push(`兵技点 +${effects.techPoints}`);
  }
  if (effects.buff) {
    addSagaBuff(state, { ...effects.buff, faction: player });
    notes.push(`${effects.buff.label}（${effects.buff.duration}季）`);
  }
  if (effects.extraBuff) {
    addSagaBuff(state, { ...effects.extraBuff, faction: player });
    notes.push(`${effects.extraBuff.label}（${effects.extraBuff.duration}季）`);
  }
  if (typeof effects.troopBoost === "number" && effects.troopBoost > 0) {
    const owned = Object.entries(state.cities || {}).filter(([, c]) => c?.owner === player);
    if (owned.length) {
      owned.sort((a, b) => (b[1].troops ?? 0) - (a[1].troops ?? 0));
      const [capKey, capCity] = owned[0];
      capCity.troops = Math.min(60000, Math.round((capCity.troops ?? 0) + effects.troopBoost));
      notes.push(`「${capKey}」增兵 +${effects.troopBoost}`);
    }
  }
  if (typeof effects.moraleBoost === "number" && effects.moraleBoost > 0) {
    for (const city of Object.values(state.cities || {})) {
      if (city?.owner === player) {
        city.morale = clamp((city.morale ?? 70) + effects.moraleBoost, 0, 100);
      }
    }
    notes.push(`全境士气 +${effects.moraleBoost}`);
  }
  if (effects.rumorEnemy && saga) {
    const enemyKeys = Object.entries(state.cities || {})
      .filter(([, c]) => c?.owner && c.owner !== player)
      .slice(0, 2)
      .map(([k]) => k);
    saga.rumors ??= {};
    for (const k of enemyKeys) {
      saga.rumors[k] = state.turn + 3;
    }
    if (enemyKeys.length) notes.push(`敌城「${enemyKeys.join("、")}」流言动摇 3 季`);
  }
  if (effects.inviteTalentId && saga) {
    const t = WILD_TALENT_POOL.find((w) => w.id === effects.inviteTalentId);
    const alreadyExists = t && (
      (saga.wildRecruits || []).some((r) => r.name === t.name)
      || (saga.wildPending || []).some((p) => p.name === t.name)
    );
    if (t && !alreadyExists && (saga.wildPending?.length ?? 0) < MAX_WILD_PENDING) {
      saga.wildPending = [...(saga.wildPending ?? []), {
        id: t.id,
        name: t.name,
        title: t.title,
        governance: t.governance,
        command: t.command,
        fee: Math.max(10, Math.round(t.fee * 0.6)),
        turn: state.turn,
      }].slice(-MAX_WILD_PENDING);
      notes.push(`贤士「${t.name}」已候征召`);
    }
  }
  if (effects.annal) {
    recordAnnal(state, "演义剧场", effects.annal);
  }
  return notes;
}

/**
 * 推进剧情分支并在剧终落幕时写回真实天下状态
 */
export function chooseDramaOption(state, session, optionId) {
  const play = DRAMA_PLAYS.find((p) => p.id === session?.playId);
  const scene = currentDramaScene(session);
  if (!play || !scene || session.done) {
    return { state, session, completed: false, notes: [] };
  }
  const chosen = scene.options.find((o) => o.id === optionId) || scene.options[0];
  if (!chosen) return { state, session, completed: false, notes: [] };

  const nextSession = structuredClone(session);
  nextSession.choices.push({ sceneId: scene.id, optionId: chosen.id, label: chosen.label });
  nextSession.history.push(`${scene.actLabel}：选择「${chosen.label}」`);

  if (chosen.nextSceneId && play.scenes[chosen.nextSceneId]) {
    nextSession.sceneId = chosen.nextSceneId;
    nextSession.step = Math.min(nextSession.totalSteps, nextSession.step + 1);
    return { state, session: nextSession, completed: false, notes: [] };
  }

  // 终幕落定：在非只读且未演过本剧时写回史诗天下状态
  nextSession.done = true;
  let nextState = state;
  let notes = [];
  const alreadyPlayed = Boolean(state?.saga?.dramasPlayed?.includes(play.id));
  if (state?.century && !alreadyPlayed) {
    nextState = structuredClone(state);
    const saga = ensureSaga(nextState);
    saga.dramasPlayed = [...new Set([...(saga.dramasPlayed ?? []), play.id])].slice(-16);
    notes = applyDramaEffects(nextState, chosen.effects);
  } else if (alreadyPlayed) {
    notes = ["本剧此前已演毕，仅回味剧情而不重复计赏"];
  }
  nextSession.resultSummary = notes.length ? notes.join(" · ") : "名戏落幕";
  return { state: nextState, session: nextSession, completed: true, notes };
}
