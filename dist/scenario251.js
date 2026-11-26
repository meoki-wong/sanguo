/**
 * 「251 英雄集结」全时代跨时空 11 势力 44 城群雄大乱斗剧本
 * Reference: Romance of the Three Kingdoms XI — Heroes Assembly (英雄集结).
 */

const FACTIONS_251 = {
  cao: {
    name: "曹操",
    trait: "雄略中原",
    capital: "xu",
    stats: [145, 145, 76],
    cities: ["xu", "chenliu", "puyang", "runan"],
    officers: [
      ["曹操", 93, 94, "xu"], ["荀彧", 96, 56, "xu"], ["郭嘉", 84, 62, "xu"],
      ["夏侯惇", 72, 88, "chenliu"], ["张辽", 66, 94, "puyang"], ["徐晃", 65, 89, "runan"],
      ["许褚", 36, 84, "xu"], ["典韦", 32, 83, "chenliu"], ["荀攸", 92, 64, "puyang"],
      ["曹仁", 75, 90, "runan"], ["夏侯渊", 58, 89, "xu"], ["张郃", 64, 91, "puyang"],
      ["程昱", 86, 74, "chenliu"],
    ],
  },
  liu: {
    name: "刘备",
    trait: "仁德兴汉",
    capital: "chengdu",
    stats: [140, 150, 80],
    cities: ["chengdu", "zitong", "jiangzhou", "yufu"],
    officers: [
      ["刘备", 86, 82, "chengdu"], ["诸葛亮", 98, 93, "chengdu"], ["关羽", 74, 96, "yufu"],
      ["张飞", 52, 92, "zitong"], ["赵云", 76, 93, "jiangzhou"], ["庞统", 90, 84, "chengdu"],
      ["黄忠", 56, 89, "zitong"], ["魏延", 60, 89, "yufu"], ["法正", 88, 84, "jiangzhou"],
      ["姜维", 82, 91, "zitong"], ["徐庶", 85, 82, "chengdu"], ["马良", 88, 62, "jiangzhou"],
    ],
  },
  wu: {
    name: "孙策·孙权",
    trait: "江东水师",
    capital: "moling",
    stats: [150, 145, 78],
    cities: ["moling", "wu", "shanyin", "lujiang", "chaisang"],
    officers: [
      ["孙策", 76, 95, "moling"], ["孙权", 88, 78, "wu"], ["周瑜", 90, 96, "chaisang"],
      ["鲁肃", 93, 76, "moling"], ["吕蒙", 78, 91, "lujiang"], ["陆逊", 89, 94, "shanyin"],
      ["陆抗", 88, 92, "chaisang"], ["太史慈", 58, 90, "lujiang"], ["甘宁", 54, 91, "chaisang"],
      ["黄盖", 62, 85, "wu"], ["周泰", 50, 86, "shanyin"], ["程普", 72, 86, "moling"],
      ["张昭", 92, 50, "wu"],
    ],
  },
  lvbu: {
    name: "吕布",
    trait: "飞将无双",
    capital: "xiapi",
    stats: [135, 138, 78],
    cities: ["xiapi", "xiaopei", "beihai", "shouchun"],
    officers: [
      ["吕布", 48, 97, "xiapi"], ["陈宫", 87, 82, "xiapi"], ["高顺", 62, 90, "xiaopei"],
      ["张绣", 60, 84, "shouchun"], ["臧霸", 67, 82, "beihai"], ["魏续", 54, 76, "xiaopei"],
      ["宋宪", 52, 74, "beihai"], ["郝萌", 48, 75, "shouchun"],
    ],
  },
  yuan: {
    name: "袁绍",
    trait: "四世三公",
    capital: "ye",
    stats: [152, 148, 74],
    cities: ["ye", "nanpi", "pingyuan", "jinyang"],
    officers: [
      ["袁绍", 82, 84, "ye"], ["田丰", 90, 68, "ye"], ["沮授", 90, 76, "nanpi"],
      ["颜良", 46, 91, "pingyuan"], ["文丑", 45, 90, "jinyang"], ["审配", 82, 82, "ye"],
      ["许攸", 78, 60, "nanpi"], ["高览", 56, 82, "pingyuan"], ["逢纪", 74, 58, "jinyang"],
    ],
  },
  sima: {
    name: "司马懿",
    trait: "鹰视狼顾",
    capital: "wan",
    stats: [148, 145, 76],
    cities: ["wan", "xinye", "shangyong", "nanzheng"],
    officers: [
      ["司马懿", 95, 94, "wan"], ["司马师", 88, 86, "wan"], ["司马昭", 92, 87, "xinye"],
      ["邓艾", 89, 91, "nanzheng"], ["钟会", 88, 84, "shangyong"], ["杜预", 92, 89, "xinye"],
      ["羊祜", 91, 88, "wan"], ["王濬", 80, 88, "shangyong"], ["文鸯", 48, 91, "nanzheng"],
      ["郭淮", 80, 86, "xinye"],
    ],
  },
  dong: {
    name: "董卓",
    trait: "雄踞关洛",
    capital: "luoyang",
    stats: [158, 152, 72],
    cities: ["luoyang", "changan"],
    officers: [
      ["董卓", 64, 88, "luoyang"], ["贾诩", 91, 74, "changan"], ["李儒", 88, 72, "luoyang"],
      ["华雄", 44, 86, "luoyang"], ["徐荣", 64, 85, "changan"], ["李傕", 52, 78, "changan"],
      ["郭汜", 48, 77, "luoyang"],
    ],
  },
  ma: {
    name: "马腾",
    trait: "西凉铁骑",
    capital: "tianshui",
    stats: [130, 136, 77],
    cities: ["tianshui", "anding", "guzang"],
    officers: [
      ["马腾", 72, 86, "tianshui"], ["马超", 58, 95, "tianshui"], ["庞德", 60, 89, "anding"],
      ["韩遂", 78, 83, "guzang"], ["马岱", 62, 83, "anding"], ["阎行", 54, 84, "guzang"],
    ],
  },
  biao: {
    name: "刘表",
    trait: "跨蹈荆襄",
    capital: "xiangyang",
    stats: [146, 152, 74],
    cities: ["xiangyang", "jiangxia", "jiangling", "linxiang", "linyuan", "quanling", "guiyang"],
    officers: [
      ["刘表", 86, 66, "xiangyang"], ["文聘", 68, 88, "xiangyang"], ["蒯良", 88, 56, "jiangling"],
      ["蒯越", 86, 64, "jiangxia"], ["蔡瑁", 64, 80, "jiangling"], ["霍弋", 79, 84, "linxiang"],
      ["罗宪", 78, 85, "linyuan"], ["黄祖", 58, 76, "jiangxia"], ["伊籍", 80, 52, "quanling"],
      ["苏飞", 56, 75, "guiyang"],
    ],
  },
  yellow: {
    name: "张角·公孙",
    trait: "北疆义从",
    capital: "ji",
    stats: [136, 144, 78],
    cities: ["ji", "beiping", "xiangping"],
    officers: [
      ["张角", 86, 82, "ji"], ["公孙瓒", 68, 88, "beiping"], ["张宝", 70, 78, "ji"],
      ["张梁", 66, 81, "beiping"], ["田豫", 84, 84, "xiangping"], ["公孙度", 76, 80, "xiangping"],
      ["波才", 58, 77, "ji"],
    ],
  },
  shi: {
    name: "士燮·南中",
    trait: "岭南蛮骑",
    capital: "panyu",
    stats: [132, 144, 76],
    cities: ["panyu", "jiaozhi", "jianning", "yunnan"],
    officers: [
      ["士燮", 88, 66, "panyu"], ["孟获", 56, 88, "yunnan"], ["祝融", 52, 85, "jianning"],
      ["陶璜", 82, 84, "jiaozhi"], ["步骘", 86, 74, "panyu"], ["士壹", 78, 62, "jiaozhi"],
      ["士武", 68, 72, "jianning"],
    ],
  },
};

export function heroesAssemblyScenario(world, baseline) {
  const positions = new Map(world.cities.map(({ key, position }) => [key, position]));
  const ownership = {};
  const capitals = {};
  const factions = [];
  const officers = [];

  for (const [key, cfg] of Object.entries(FACTIONS_251)) {
    for (const city of cfg.cities) {
      if (!positions.has(city) || ownership[city]) {
        throw new Error(`251 英雄集结城池配置冲突: ${city}`);
      }
      ownership[city] = key;
    }
    capitals[key] = cfg.capital;
    factions.push({
      key,
      name: cfg.name,
      trait: cfg.trait,
      stats: [...cfg.stats],
      position: positions.get(cfg.capital),
      path: cfg.cities.map((c) => baseline.zones[c]).join(" "),
    });
    for (const [index, [name, governance, command, home]] of cfg.officers.entries()) {
      officers.push({
        key: `${key}-251-${index}`,
        faction: key,
        name,
        governance,
        command,
        home: home || cfg.capital,
      });
    }
  }

  if (Object.keys(ownership).length !== world.cities.length) {
    throw new Error(`251 英雄集结未覆盖全部 ${world.cities.length} 城`);
  }

  return {
    year: 251,
    title: "英雄集结",
    ownership,
    capitals,
    factions,
    officers,
    zones: baseline.zones,
    periodNames: { ...baseline.periodNames },
  };
}
