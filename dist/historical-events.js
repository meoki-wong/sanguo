import { eraByYear, forceTotals, gameOutcome } from "./engine.js";
import { hanEmperorStatus, proclaimImperialChoice } from "./imperial.js";
import { livingSide } from "./polities-data.js";
import { treatyTerms } from "./diplomacy.js";
import { addSagaBuff, ensureSaga, MAX_FIRED_EVENTS, recordAnnal } from "./saga.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function ownedBy(state, faction, cityKey) {
  return state.cities?.[cityKey]?.owner === faction;
}

export const HISTORICAL_EVENTS = [
  // ---------- Dynamic Imperial & Destiny Chain ----------
  {
    id: "imperial_capture_emperor",
    tag: "迎奉大统",
    title: "天子銮驾入幕 · 奉主号令四方",
    trigger(world, era, state) {
      const han = hanEmperorStatus(state);
      return han.active && han.patron === state.player && state.year !== 184
        && (state.year !== 190 || state.player !== "dong")
        && (state.year !== 199 || state.player !== "cao")
        && (state.year !== 208 || state.player !== "cao");
    },
    build(world, era, state) {
      const han = hanEmperorStatus(state);
      const cityLabel = han.cityKey === "xu" ? "许昌" : han.cityKey === "changan" ? "长安" : "洛阳";
      return {
        tag: "迎奉大统",
        title: `迎奉${han.name} · 控扼正朔`,
        body: `${han.name}驻跸${cityLabel}，今銮驾已在掌握。若移驾兴礼、奉天子以令不臣，可号召海内名士归附。`,
        choices: [
          {
            id: "honor",
            label: "礼奉圣驾 · 设官兴礼（声望+10 · 钱+25 · 全军攻势+8%）",
            tone: "primary",
            apply(w, e, next) {
              next.factions[next.player].treasury += 25;
              next.saga.reputation = clamp(next.saga.reputation + 10, 0, 100);
              next.factions[next.player].morale = clamp(next.factions[next.player].morale + 5, 15, 100);
              addSagaBuff(next, { kind: "attack", faction: next.player, value: 0.08, duration: 4, label: "奉天子征讨" });
              return "已礼奉圣驾！海内名望大振（声望 +10，全军攻势 +8% 持续 4 季）。";
            },
          },
          {
            id: "levy",
            label: "矫诏调赋 · 急筹军实（国库+40 · 储粮+40 · 声望-6）",
            tone: "quiet",
            apply(w, e, next) {
              next.factions[next.player].treasury += 40;
              next.factions[next.player].grain += 40;
              next.saga.reputation = clamp(next.saga.reputation - 6, 0, 100);
              return "已借诏书急征钱粮（国库 +40，储粮 +40，声望 -6）。";
            },
          },
        ],
      };
    },
  },
  {
    id: "imperial_king_petition",
    tag: "进爵称王",
    title: "群臣上表请进魏吴之爵",
    trigger(world, era, state) {
      return state.year <= 219
        && !["wei", "shu", "wu", "jin"].includes(state.player)
        && forceTotals(state, state.player).cities >= 14;
    },
    build(world, era, state) {
      return {
        tag: "进爵称王",
        title: "功盖天下 · 群僚请进封王国",
        body: "今大军兼领州郡十四城以上，幕府僚佐联名请依汉初故事受封大王、置百官参赞军务。",
        choices: [
          {
            id: "accept_king",
            label: "顺应众议 · 进爵称王（士气+6 · 国库+30 · 声望-3）",
            tone: "primary",
            apply(w, e, next) {
              next.factions[next.player].treasury += 30;
              next.factions[next.player].morale = clamp(next.factions[next.player].morale + 6, 15, 100);
              next.saga.reputation = clamp(next.saga.reputation - 3, 0, 100);
              addSagaBuff(next, { kind: "attack", faction: next.player, value: 0.06, duration: 4, label: "王师伐叛" });
              return "已建王府仪制，三军威势大张（全军攻势 +6% 持续 4 季）。";
            },
          },
          {
            id: "decline_king",
            label: "逊让不居 · 广结海内（声望+8 · 储粮+30）",
            tone: "quiet",
            apply(w, e, next) {
              next.factions[next.player].grain += 30;
              next.saga.reputation = clamp(next.saga.reputation + 8, 0, 100);
              return "谦辞王爵以安反侧，声望大增（声望 +8，储粮 +30）。";
            },
          },
        ],
      };
    },
  },
  {
    id: "imperial_emperor_petition",
    tag: "禅代大议",
    title: "受禅登极或誓扶汉室",
    trigger(world, era, state) {
      return state.year <= 219
        && !state.imperialChoice
        && forceTotals(state, state.player).cities >= 18;
    },
    build(world, era, state) {
      return {
        tag: "天命大议",
        title: "九锡已备 · 禅代称帝抑或扶汉？",
        body: "麾下已统摄十八城以上，文武皆请登基称帝、改正朔立国号；抑或恪守臣节、以王佐之名统御四海（在野义士礼聘礼金减半）。",
        choices: [
          {
            id: "claim",
            label: "受禅登极 · 建朝称帝（礼制升朝廷 · 攻防+8% · 声望-8）",
            tone: "primary",
            apply(w, e, next) {
              Object.assign(next, proclaimImperialChoice(w, next, "emperor"));
              next.saga.reputation = clamp(next.saga.reputation - 8, 0, 100);
              next.factions[next.player].morale = clamp(next.factions[next.player].morale + 8, 15, 100);
              addSagaBuff(next, { kind: "attack", faction: next.player, value: 0.08, duration: 6, label: "受命天子" });
              return "受禅登基！礼制已升为正统朝廷，全军攻势 +8% 持续 6 季。";
            },
          },
          {
            id: "loyal",
            label: "誓扶汉室 · 恪守臣节（声望+12 · 礼聘半价 · 守防+8%）",
            tone: "quiet",
            apply(w, e, next) {
              Object.assign(next, proclaimImperialChoice(w, next, "loyalist"));
              next.saga.reputation = clamp(next.saga.reputation + 12, 0, 100);
              addSagaBuff(next, { kind: "defense", faction: next.player, value: 0.08, duration: 6, label: "义声感众" });
              return "誓扶汉室！声望 +12，此后礼聘在野名士礼金减半。";
            },
          },
        ],
      };
    },
  },
  {
    id: "imperial_unification_eve",
    tag: "大业将成",
    title: "传檄天下 · 乘胜定鼎中原",
    trigger(world, era, state) {
      return forceTotals(state, state.player).cities >= 30;
    },
    build(world, era, state) {
      return {
        tag: "大业将成",
        title: "一统在望 · 颁檄文招抚四方",
        body: "版图已逾三十城，余部闻风丧胆。此刻正可大开招降之门，或重赏三军一鼓作气平定余孽。",
        choices: [
          {
            id: "proclaim",
            label: "颁布招降诏 · 大赦州郡（声望+10 · 钱+20 · 军威+10%）",
            tone: "primary",
            apply(w, e, next) {
              next.saga.reputation = clamp(next.saga.reputation + 10, 0, 100);
              next.factions[next.player].treasury += 20;
              addSagaBuff(next, { kind: "attack", faction: next.player, value: 0.1, duration: 4, label: "王师一统" });
              return "四方传檄响应，攻城军威 +10%，高声望更利劝降！";
            },
          },
        ],
      };
    },
  },

  // ---------- Era-Specific Historical Events ----------
  {
    id: "ev_184_guangzong",
    tag: "平定广宗",
    title: "广宗火攻破黄巾",
    trigger(world, era, state) {
      return state.year === 184 && state.turn >= 2 && state.turn <= 10 && livingSide(state, "yellow");
    },
    build(world, era, state) {
      const isYellow = state.player === "yellow";
      return {
        tag: "苍天黄天",
        title: isYellow ? "广宗被围 · 大贤良师重整教众" : "皇甫嵩夜袭广宗 · 火起连营",
        body: isYellow
          ? "官军步步紧逼冀州腹地，渠帅急请安抚流民、死守广宗。"
          : "前线报黄巾连营多枯草，若运火器夜袭可一战挫敌锐气；亦可先赈灾招抚流民。",
        choices: [
          {
            id: "a",
            label: isYellow ? "焚舟死守 · 固保冀南（防+10% · 士气+6）" : "顺风火攻 · 直取广宗（火攻奇袭+14% · 钱-10）",
            tone: "primary",
            apply(w, e, next) {
              if (isYellow) {
                next.factions.yellow.morale = clamp(next.factions.yellow.morale + 6, 15, 100);
                addSagaBuff(next, { kind: "defense", faction: "yellow", value: 0.1, duration: 4, label: "太平道众死战" });
                return "教众同仇敌忾，守城战力 +10% 持续 4 季！";
              }
              next.factions[next.player].treasury = Math.max(0, next.factions[next.player].treasury - 10);
              addSagaBuff(next, { kind: "fire", faction: next.player, value: 0.14, duration: 4, label: "广宗火计" });
              return "三军备足火攻器械，「火攻奇袭」威力 +14% 持续 4 季！";
            },
          },
          {
            id: "b",
            label: "开仓招抚流民 · 减耗兴农（粮+35 · 声望+5）",
            tone: "quiet",
            apply(w, e, next) {
              next.factions[next.player].grain += 35;
              next.saga.reputation = clamp(next.saga.reputation + 5, 0, 100);
              return "开仓安民，获储粮 +35、声望 +5。";
            },
          },
        ],
      };
    },
  },
  {
    id: "ev_190_hulao",
    tag: "十八路联军",
    title: "虎牢关前战声震关东",
    trigger(world, era, state) {
      return state.year === 190 && state.turn >= 2 && state.turn <= 10 && livingSide(state, "dong");
    },
    build(world, era, state) {
      const isDong = state.player === "dong";
      return {
        tag: "讨董大义",
        title: isDong ? "盟军压境 · 坚壁关隘抑或迁都长安" : "会猎虎牢 · 共讨董卓",
        body: isDong
          ? "关东诸侯兵锋正盛，李儒建言固守虎牢险要或移跸长安以避锋芒。"
          : "盟军声威浩大，若趁势大募义兵、鼓舞士气，可借大义之名重创西凉兵马。",
        choices: [
          {
            id: "a",
            label: isDong ? "重赏西凉锐士 · 死守洛阳（钱-15 · 攻防+9%）" : "传檄讨贼 · 锐士先登（钱+20 · 全军攻势+10%）",
            tone: "primary",
            apply(w, e, next) {
              if (isDong) {
                next.factions.dong.treasury = Math.max(0, next.factions.dong.treasury - 15);
                addSagaBuff(next, { kind: "defense", faction: "dong", value: 0.09, duration: 4, label: "虎牢坚壁" });
                return "重赏西凉将校，守御战力 +9% 持续 4 季！";
              }
              next.factions[next.player].treasury += 20;
              next.saga.reputation = clamp(next.saga.reputation + 5, 0, 100);
              addSagaBuff(next, { kind: "attack", faction: next.player, value: 0.1, duration: 4, label: "讨董义师" });
              return "关东大义凛然！国库 +20、声望 +5、全军攻势 +10%。";
            },
          },
          {
            id: "b",
            label: "招纳河洛流散名士（声望+6 · 粮+30）",
            tone: "quiet",
            apply(w, e, next) {
              next.factions[next.player].grain += 30;
              next.saga.reputation = clamp(next.saga.reputation + 6, 0, 100);
              return "广布恩信收揽关洛人心（声望 +6，储粮 +30）。";
            },
          },
        ],
      };
    },
  },
  {
    id: "ev_199_wuchao",
    tag: "官渡风云",
    title: "夜袭乌巢 · 中原决战拐点",
    trigger(world, era, state) {
      return state.year === 199 && state.turn >= 2 && state.turn <= 12 && livingSide(state, "cao") && livingSide(state, "yuan");
    },
    build(world, era, state) {
      if (state.player === "cao") {
        return {
          tag: "官渡奇谋",
          title: "许攸来降 · 密报袁氏粮屯于乌巢！",
          body: "袁军屯粮重地乌巢防备空虚，淳于琼嗜酒少备。若亲自挑选轻骑夜袭焚粮，袁军十万之众不战自溃！",
          choices: [
            {
              id: "raid",
              label: "亲率五千轻骑焚乌巢（袁军粮-60士气-8 · 曹军奇袭+16%）",
              tone: "primary",
              apply(w, e, next) {
                next.factions.yuan.grain = Math.max(0, next.factions.yuan.grain - 60);
                next.factions.yuan.morale = clamp(next.factions.yuan.morale - 8, 15, 100);
                next.factions.cao.morale = clamp(next.factions.cao.morale + 5, 15, 100);
                addSagaBuff(next, { kind: "fire", faction: "cao", value: 0.16, duration: 4, label: "乌巢火威" });
                return "乌巢冲天大火照彻官渡！袁军缺粮士气大挫，曹军火攻奇袭 +16%。";
              },
            },
            {
              id: "steady",
              label: "深沟高垒 · 稳步屯粮耗敌（国库+25 · 储粮+45）",
              tone: "quiet",
              apply(w, e, next) {
                next.factions.cao.treasury += 25;
                next.factions.cao.grain += 45;
                return "稳扎官渡营垒，钱 +25、粮 +45，待敌自疲。";
              },
            },
          ],
        };
      }
      if (state.player === "yuan") {
        return {
          tag: "官渡决断",
          title: "田丰谏言持久 · 乌巢粮道告警",
          body: "田丰密奏：宜严守乌巢粮仓、避其锐气，令许昌自困；若孤注一掷恐中奇袭。",
          choices: [
            {
              id: "fortify",
              label: "从田丰计 · 增兵护粮固守（储粮+45 · 守御+10%）",
              tone: "primary",
              apply(w, e, next) {
                next.factions.yuan.grain += 45;
                next.saga.reputation = clamp(next.saga.reputation + 4, 0, 100);
                addSagaBuff(next, { kind: "defense", faction: "yuan", value: 0.1, duration: 4, label: "护粮固守" });
                return "重兵护住乌巢，粮草充盈，守军战力 +10%。";
              },
            },
            {
              id: "strike",
              label: "趁势大举南压 · 奇兵破壁（攻城破垒+12% · 粮-20）",
              tone: "quiet",
              apply(w, e, next) {
                next.factions.yuan.grain = Math.max(0, next.factions.yuan.grain - 20);
                addSagaBuff(next, { kind: "siege", faction: "yuan", value: 0.12, duration: 4, label: "河北雷霆" });
                return "四州主力并进，围城破垒威力 +12%！";
              },
            },
          ],
        };
      }
      return {
        tag: "天下大势",
        title: "曹袁对峙官渡 · 群雄趁隙布局",
        body: "中原两大强藩全神相持于官渡，正值四方蓄势整军、广积粮草之良机。",
        choices: [
          {
            id: "boom",
            label: "借机休整扩充国库（国库+28 · 储粮+28 · 声望+3）",
            tone: "primary",
            apply(w, e, next) {
              next.factions[next.player].treasury += 28;
              next.factions[next.player].grain += 28;
              next.saga.reputation = clamp(next.saga.reputation + 3, 0, 100);
              return "趁中原酣战厉兵蓄财（钱 +28，粮 +28，声望 +3）。";
            },
          },
        ],
      };
    },
  },
  {
    id: "ev_199_jiangdong",
    tag: "江东风云",
    title: "江东稳固水师 · 横绝大江",
    trigger(world, era, state) {
      return state.year === 199 && state.turn >= 5 && livingSide(state, "ce");
    },
    build(world, era, state) {
      const isCe = state.player === "ce";
      return {
        tag: "江东大势",
        title: isCe ? "张昭鲁肃安抚吴会 · 整训水师" : "江东楼船兴造 · 长江防务日固",
        body: isCe
          ? "外事不决问周瑜，内事不决问张昭，江东六郡渐呈定鼎气象。"
          : "孙策、周瑜连年操演水军于柴桑、秣陵，沿江守备日密。",
        choices: [
          {
            id: "navy",
            label: isCe ? "扩充楼船 · 增补江东钱粮（钱+25 · 攻势+8%）" : "筹备渡江冲车与粮秣（攻城+10% · 粮+30）",
            tone: "primary",
            apply(w, e, next) {
              if (isCe) {
                next.factions.ce.treasury += 25;
                addSagaBuff(next, { kind: "attack", faction: "ce", value: 0.08, duration: 4, label: "江东锐气" });
                return "江东国库 +25、全军攻势 +8% 持续 4 季！";
              }
              next.factions[next.player].grain += 30;
              addSagaBuff(next, { kind: "siege", faction: next.player, value: 0.1, duration: 4, label: "临江器械" });
              return "储粮 +30，围城破垒威力 +10%！";
            },
          },
        ],
      };
    },
  },
  {
    id: "ev_208_chibi_pact",
    tag: "隆中合纵",
    title: "诸葛亮舌战群儒 · 孙刘抗曹",
    trigger(world, era, state) {
      return state.year === 208 && state.turn >= 1 && state.turn <= 8 && livingSide(state, "liu") && livingSide(state, "wu") && livingSide(state, "cao");
    },
    build(world, era, state) {
      const pair = state.player === "liu" ? "wu" : state.player === "wu" ? "liu" : null;
      return {
        tag: "三分蓝图",
        title: pair ? "孙刘共盟以拒北师" : "江东群臣议战议降",
        body: pair
          ? `曹操数十万水步南下，唯孙刘通好并力，方能以火攻水战克敌于大江！`
          : "江南孙刘正秘密遣使联络，若不早定南征妙策恐使江东生变。",
        choices: [
          {
            id: "pact",
            label: pair ? `歃血缔结孙刘同盟（互签4季同盟 · 声望+5 · 火攻+12%）` : "加筑江夏舟师储备（钱+30 · 破垒+10%）",
            tone: "primary",
            apply(w, e, next) {
              if (pair) {
                const sides = [next.player, pair].sort();
                next.treaties = (next.treaties ?? []).filter((t) => !(t.sides.includes(sides[0]) && t.sides.includes(sides[1])));
                next.treaties.push({ kind: "alliance", sides, expires: next.turn + treatyTerms.alliance.seasons });
                next.saga.reputation = clamp(next.saga.reputation + 5, 0, 100);
                addSagaBuff(next, { kind: "fire", faction: next.player, value: 0.12, duration: 5, label: "东风火攻" });
                return `孙刘正式结盟（4季），「火攻奇袭」威力额外 +12%！`;
              }
              next.factions[next.player].treasury += 30;
              addSagaBuff(next, { kind: "siege", faction: next.player, value: 0.1, duration: 4, label: "北师楼船" });
              return "北军备足舟师，国库 +30、围城破垒 +10%！";
            },
          },
          {
            id: "reserve",
            label: "固本蓄锐 · 稳聚钱粮（钱+24 · 粮+30）",
            tone: "quiet",
            apply(w, e, next) {
              next.factions[next.player].treasury += 24;
              next.factions[next.player].grain += 30;
              return "已优先扩充钱粮储备。";
            },
          },
        ],
      };
    },
  },
  {
    id: "ev_208_east_wind",
    tag: "赤壁东风",
    title: "冬至东南风大起 · 黄盖火船连环",
    trigger(world, era, state) {
      return state.year === 208 && state.turn >= 4 && state.turn <= 14 && livingSide(state, "wu") && livingSide(state, "cao");
    },
    build(world, era, state) {
      const antiCao = state.player === "wu" || state.player === "liu";
      return {
        tag: "赤壁之战",
        title: antiCao ? "东南风劲吹 · 正宜放火破北营！" : "大江连环铁索 · 防备东吴火船",
        body: antiCao
          ? "曹军铁锁连舟难离，东南风骤起，正是火攻齐出、威震天下之时！"
          : "江面突然转吹东南风，军师急报慎防对岸火船诈降。",
        choices: [
          {
            id: "wind",
            label: antiCao ? "举火乘风破敌（全军奇袭+18% · 曹军士气-8）" : "急断铁索整肃水营（防+12% · 士气+4）",
            tone: "primary",
            apply(w, e, next) {
              if (antiCao) {
                next.factions.cao.morale = clamp(next.factions.cao.morale - 8, 15, 100);
                addSagaBuff(next, { kind: "fire", faction: next.player, value: 0.18, duration: 4, label: "赤壁东风" });
                return "赤壁烈焰腾空！北军士气大跌，己方「火攻奇袭」+18%！";
              }
              next.factions[next.player].morale = clamp(next.factions[next.player].morale + 4, 15, 100);
              addSagaBuff(next, { kind: "defense", faction: next.player, value: 0.12, duration: 4, label: "江防戒备" });
              return "及时疏散水寨避开火险，守御战力 +12%！";
            },
          },
        ],
      };
    },
  },
  {
    id: "ev_219_flood",
    tag: "襄樊暴雨",
    title: "汉水泛滥 · 水淹七军抑或白衣渡江",
    trigger(world, era, state) {
      return state.year === 219 && state.turn >= 2 && state.turn <= 12;
    },
    build(world, era, state) {
      return {
        tag: "荆襄风暴",
        title: state.player === "liu" ? "汉水暴涨 · 威震华夏" : state.player === "wu" ? "白衣渡江奇袭荆州" : "关羽水攻樊城 · 调兵解围",
        body: "秋雨连旬汉水暴涨，中原与江东战机骤至，正可借天时大举应变。",
        choices: [
          {
            id: "act",
            label: "趁势出奇决胜（奇袭与破垒+12% · 士气+5）",
            tone: "primary",
            apply(w, e, next) {
              next.factions[next.player].morale = clamp(next.factions[next.player].morale + 5, 15, 100);
              addSagaBuff(next, { kind: "attack", faction: next.player, value: 0.1, duration: 4, label: "襄樊锐气" });
              return "军势如虹！全军攻势 +10%、士气 +5。";
            },
          },
          {
            id: "supply",
            label: "赈灾保境 · 稳守城池（粮+35 · 声望+5）",
            tone: "quiet",
            apply(w, e, next) {
              next.factions[next.player].grain += 35;
              next.saga.reputation = clamp(next.saga.reputation + 5, 0, 100);
              return "加固堤防赈民，储粮 +35、声望 +5。";
            },
          },
        ],
      };
    },
  },
  {
    id: "ev_234_wuzhangyuan",
    tag: "五丈原星象",
    title: "木牛流马 · 雍凉持重决战",
    trigger(world, era, state) {
      return state.year === 234 && state.turn >= 2 && state.turn <= 12;
    },
    build(world, era, state) {
      return {
        tag: "北伐对峙",
        title: state.player === "shu" ? "兴造木牛流马 · 屯田渭滨" : "司马持重拒敌 · 积粮观变",
        body: "关陇山险路远，军需粮运乃胜负关键。",
        choices: [
          {
            id: "logistics",
            label: "整修粮道辎重（储粮+50 · 破垒+10%）",
            tone: "primary",
            apply(w, e, next) {
              next.factions[next.player].grain += 50;
              addSagaBuff(next, { kind: "siege", faction: next.player, value: 0.1, duration: 5, label: "木牛转运" });
              return "粮运畅达！储粮 +50、围城破垒 +10%。";
            },
          },
        ],
      };
    },
  },
  {
    id: "ev_262_yinping",
    tag: "剑阁阴平",
    title: "偷渡阴平 · 兵出蜀道奇谋",
    trigger(world, era, state) {
      return (state.year === 262 || state.year === 265) && state.turn >= 2 && state.turn <= 12;
    },
    build(world, era, state) {
      return {
        tag: "定鼎之略",
        title: state.year === 265 ? "王濬造大船伐吴" : "邓艾裹毡下阴平 · 姜维坚守剑阁",
        body: "天下大势趋于一统，奇兵与水师将成为破局利器。",
        choices: [
          {
            id: "bold",
            label: "奇兵急袭 · 破险克城（奇袭与攻势+12%）",
            tone: "primary",
            apply(w, e, next) {
              addSagaBuff(next, { kind: "attack", faction: next.player, value: 0.12, duration: 5, label: state.year === 265 ? "王濬楼船" : "阴平奇兵" });
              return "锐气大振！全军攻势 +12% 持续 5 季。";
            },
          },
          {
            id: "govern",
            label: "安集新附州郡（钱+30 · 声望+6）",
            tone: "quiet",
            apply(w, e, next) {
              next.factions[next.player].treasury += 30;
              next.saga.reputation = clamp(next.saga.reputation + 6, 0, 100);
              return "宽政安民，国库 +30、声望 +6。";
            },
          },
        ],
      };
    },
  },
];

export function evaluateHistoricalEvent(world, era, state) {
  const saga = ensureSaga(state);
  if (!saga || !saga.historicalEvents || saga.pendingEvent || state.turn < 1 || gameOutcome(state) !== "ongoing") return null;
  if ((saga.firedEvents?.length ?? 0) >= MAX_FIRED_EVENTS) return null;
  const fired = new Set(saga.firedEvents ?? []);
  for (const def of HISTORICAL_EVENTS) {
    if (fired.has(def.id)) continue;
    if (def.trigger(world, era, state)) {
      saga.firedEvents = [...(saga.firedEvents ?? []), def.id].slice(-MAX_FIRED_EVENTS);
      saga.pendingEvent = { id: def.id, turn: state.turn };
      return saga.pendingEvent;
    }
  }
  return null;
}

export function getPendingHistoricalEvent(world, state) {
  const pending = state?.saga?.pendingEvent;
  if (!pending) return null;
  const def = HISTORICAL_EVENTS.find((item) => item.id === pending.id);
  if (!def) return null;
  const era = eraByYear(world, state);
  const built = def.build(world, era, state);
  return { id: def.id, turn: pending.turn, ...built };
}

export function resolveHistoricalEvent(world, state, eventId, choiceId) {
  if (!state?.century || !state.saga?.pendingEvent || state.saga.pendingEvent.id !== eventId) {
    throw new Error("此史实事件已处置或不存在。");
  }
  const def = HISTORICAL_EVENTS.find((item) => item.id === eventId);
  if (!def) throw new Error("未找到史实事件定义。");
  const next = structuredClone(state);
  const era = eraByYear(world, next);
  const built = def.build(world, era, next);
  const choice = built.choices.find((c) => c.id === choiceId) ?? built.choices[0];
  if (!choice) throw new Error("选项无效。");
  const summary = choice.apply(world, era, next);
  next.saga.pendingEvent = null;
  recordAnnal(next, built.tag || "史事", `${built.title}：${summary}`);
  return { state: next, message: summary, eventTitle: built.title };
}
