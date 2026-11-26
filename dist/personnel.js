import { redCliffScenario } from "./scenario208.js";
import { grandScenarios } from "./grand-scenarios.js";
import { heroesAssemblyScenario } from "./scenario251.js";

// The starting roster and ratings are gameplay data for each scenario.
const early = {
  cao: [
    ["曹操", 93, 94], ["荀攸", 92, 63], ["郭嘉", 83, 61], ["程昱", 84, 74],
    ["贾诩", 86, 67], ["张辽", 63, 91], ["于禁", 59, 85], ["乐进", 56, 81],
    ["李典", 71, 78], ["许褚", 32, 79], ["满宠", 85, 80], ["刘晔", 87, 61],
    ["毛玠", 87, 48], ["任峻", 90, 47], ["钟繇", 91, 58], ["曹洪", 49, 82],
    ["夏侯渊", 54, 88], ["徐晃", 65, 87], ["董昭", 86, 56],
  ],
  yuan: [
    ["袁绍", 79, 84], ["田丰", 87, 62], ["审配", 81, 79], ["许攸", 76, 58],
    ["逢纪", 73, 54], ["文丑", 43, 87], ["张郃", 61, 91], ["高览", 52, 80],
    ["淳于琼", 48, 72], ["蒋义渠", 61, 73], ["辛评", 80, 52], ["陈琳", 75, 38],
  ],
  biao: [
    ["刘表", 86, 64], ["蒯良", 88, 54], ["文聘", 65, 87], ["伊籍", 77, 48],
    ["韩嵩", 78, 43], ["刘先", 76, 50], ["苏飞", 50, 74], ["张允", 51, 68],
  ],
  zhang: [
    ["刘璋", 72, 56], ["严颜", 58, 84], ["张松", 84, 47], ["董和", 90, 53],
    ["庞羲", 70, 68], ["吴懿", 65, 80], ["刘璝", 52, 73], ["高沛", 43, 72], ["杨怀", 49, 74],
  ],
  ce: [
    ["孙策", 73, 95], ["张纮", 92, 48], ["太史慈", 54, 88], ["黄盖", 56, 85],
    ["韩当", 55, 83], ["朱治", 82, 77], ["吕范", 83, 74], ["周泰", 46, 84],
    ["蒋钦", 53, 78], ["陈武", 46, 76], ["董袭", 44, 77], ["凌操", 43, 77],
  ],
  ma: [["马腾", 70, 85], ["韩遂", 77, 83], ["阎行", 49, 84], ["杨秋", 55, 74]],
  gongsun: [["公孙度", 75, 81], ["柳毅", 57, 73], ["阳仪", 63, 69]],
  lu: [["张鲁", 79, 69], ["杨任", 50, 78], ["杨昂", 47, 73]],
  shi: [["士燮", 85, 62], ["士䵋", 65, 52]],
};

const northern = {
  sima_yan: ["司马炎", 80, 67], wang_xiang: ["王祥", 91, 47], wang_shen: ["王沈", 82, 55],
  jia_chong: ["贾充", 86, 60], pei_xiu: ["裴秀", 89, 55], shi_bao: ["石苞", 80, 85],
  sima_wang: ["司马望", 77, 82], hu_fen: ["胡奋", 67, 82], hu_lie: ["胡烈", 63, 81],
  he_zeng: ["何曾", 83, 48], chen_qian: ["陈骞", 81, 85], wang_jun: ["王濬", 78, 87],
  sima_zhou: ["司马伷", 75, 83], qian_hong: ["牵弘", 64, 78], wang_hun: ["王浑", 79, 85],
  wen_yang: ["文鸯", 44, 90], wei_guan: ["卫瓘", 85, 78],
};
const eastern = {
  shi_ji: ["施绩", 72, 84], bu_xie: ["步协", 67, 74], bu_chan: ["步阐", 63, 73],
  wan_yu: ["万彧", 80, 51], zhongli_mu: ["钟离牧", 82, 81], tao_huang: ["陶璜", 81, 83],
  xue_xu: ["薛珝", 75, 73], he_shao: ["贺邵", 88, 52], wei_zhao: ["韦昭", 82, 37],
  hua_he: ["华覈", 86, 44],
};
const shu = [
  ["刘禅", 67, 39], ["诸葛瞻", 83, 68], ["张翼", 67, 83], ["黄崇", 72, 65],
  ["霍弋", 79, 83], ["罗宪", 78, 84], ["郤正", 87, 46], ["阎宇", 63, 79],
  ["宗预", 83, 53], ["樊建", 83, 50], ["谯周", 79, 40], ["傅佥", 50, 78],
  ["张遵", 56, 72], ["蒋斌", 68, 70], ["蒋显", 70, 53],
];

// Append to indexed lists to preserve existing officer IDs in saves.
const indexed = (people) => Object.fromEntries(people.map((person, index) => [index, person]));
const rosters = {
  199: Object.fromEntries(Object.entries(early).map(([faction, people]) => [faction, indexed(people)])),
  262: {
    wei: {
      ...northern, sima_zhao: ["司马昭", 93, 87], xun_xu: ["荀勖", 88, 57], yang_hu: ["羊祜", 91, 88],
      du_yu: ["杜预", 87, 86], shi_zuan: ["师纂", 62, 75], tian_xu: ["田续", 54, 76], zhuge_xu: ["诸葛绪", 63, 79],
    },
    shu: indexed(shu),
    wu: { ...eastern, puyang_xing: ["濮阳兴", 86, 60], zhang_bu: ["张布", 78, 66], sun_xiu: ["孙休", 77, 52] },
  },
  265: {
    jin: {
      ...northern, zhang_hua: ["张华", 93, 63], fu_xuan: ["傅玄", 88, 44], liu_yi: ["刘毅", 88, 57],
      shan_tao: ["山涛", 90, 47], wang_rong: ["王戎", 80, 52], ren_kai: ["任恺", 85, 46],
      yu_chun: ["庾纯", 81, 51], pei_kai: ["裴楷", 88, 49], sima_you: ["司马攸", 85, 75],
    },
    wu: { ...eastern, sun_hao: ["孙皓", 63, 58] },
  },
};

const candidates = {
  cao: ["程谦", "许峻"], yuan: ["韩整", "郭济"], zhang: ["任修", "杨威"], biao: ["蔡宏", "蒯平"],
  lu: ["阎绥", "杨毅"], ce: ["陆修", "顾晏"], ma: ["程允", "梁丰"], gongsun: ["柳合", "田朔"],
  shi: ["桓邻", "程秉"],
  wei: ["陈珣", "辛捷"], shu: ["费钧", "赵骞"], wu: ["朱恭", "丁誉"], jin: ["卫珂", "杜安"],
  liu: ["傅恭", "陈升"], han: ["胡靖", "周逊"], lvbu: ["侯成", "曹性"], sima: ["陈泰", "石苞"],
};

export function knownOfficer(state, person) {
  return !person.reserve || state.recruitedOfficers?.includes(person.key);
}

export function enrichWorld(world) {
  const scenarios = [...world.scenarios];
  const earlier = scenarios.find(({ year }) => year === 199);
  if (earlier && !scenarios.some(({ year }) => year === 208)) scenarios.push(redCliffScenario(world, earlier));
  if (earlier) scenarios.push(...grandScenarios(world, earlier).filter(({ year }) => !scenarios.some((era) => era.year === year)));
  if (earlier && !scenarios.some(({ year }) => year === 251)) scenarios.push(heroesAssemblyScenario(world, earlier));
  return {
    ...world,
    scenarios: scenarios.map((era) => {
      const additions = Object.entries(rosters[era.year] || {}).flatMap(([faction, people]) =>
        Object.entries(people).map(([id, [name, governance, command]]) => ({
          key: faction + "-roster-" + id, faction, name, governance, command,
        })));
      const reserves = era.factions.flatMap(({ key: faction }) => (candidates[faction] ?? []).map((name, index) => ({
        key: faction + "-talent-" + index, faction, name,
        governance: index ? 60 : 82, command: index ? 82 : 56, reserve: { turn: index ? 8 : 4, fee: index ? 44 : 32 },
      })));
      return { ...era, officers: [...era.officers, ...additions, ...reserves] };
    }),
  };
}
