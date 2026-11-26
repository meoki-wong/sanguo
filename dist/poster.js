// v20.0 — 一键生成高清古风战报海报（原生 Canvas 2D，零外部依赖）

import { evaluateCampaignGrade } from "./achievements.js";
import { getCeremonyState } from "./dynasty-ceremony.js";
import { listCorps } from "./corps.js";
import { factionOwnedWonders } from "./buildings.js";

/**
 * 构建战报海报结构化数据（纯函数，便于单测验证）
 */
export function buildPosterData(world, era, state) {
  const player = state.player;
  const grade = evaluateCampaignGrade(world, state);
  const ceremony = getCeremonyState(state);
  const custom = state.saga?.custom;
  const ownedCities = Object.entries(state.cities || {}).filter(([, c]) => c.owner === player);
  const totalTroops = ownedCities.reduce((sum, [, c]) => sum + (c.troops ?? 0), 0);
  const factionName = (Array.isArray(era?.factions) ? era.factions.find((f) => f.key === player)?.name : era?.factions?.[player]?.name) || player;
  const titleName = ceremony.dynastyName || custom?.stateName || factionName;
  const rulerTitle = ceremony.eraName ? `${ceremony.eraName}年间 · ${titleName}` : `${(state.year ?? 208) + Math.floor(((state.turn ?? 1) - 1) / 4)} 年 · ${titleName}`;
  const annals = (state.saga?.annals || []).slice(-4).map((a) => `${a.year}年 · ${a.title}：${a.text}`);

  return {
    titleName,
    rulerTitle,
    edict: ceremony.edict || `经略天下，以${ownedCities.length}城之势纵横九州`,
    grade: grade.grade,
    verdict: grade.verdict,
    score: grade.score,
    ownedCount: ownedCities.length,
    totalCities: world?.cities?.length || 44,
    totalTroops,
    treasury: state.factions?.[player]?.treasury ?? 0,
    grain: state.factions?.[player]?.grain ?? 0,
    duelWins: state.saga?.duelWins ?? 0,
    corpsCount: listCorps(state).length,
    wondersCount: factionOwnedWonders(state, player).length,
    annals,
  };
}

/**
 * 在浏览器端绘制 900×1280 高清暗金宣纸古风战报海报并返回 PNG dataURL
 */
export function renderPosterCanvas(canvas, world, era, state) {
  const data = buildPosterData(world, era, state);
  const W = 900;
  const H = 1280;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // 1. 暗金宣纸背景渐变
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1c1712");
  bg.addColorStop(0.5, "#15110d");
  bg.addColorStop(1, "#0f0c09");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 2. 双层烫金卷轴边框
  ctx.strokeStyle = "rgba(218, 178, 96, 0.72)";
  ctx.lineWidth = 3;
  ctx.strokeRect(28, 28, W - 56, H - 56);
  ctx.strokeStyle = "rgba(218, 178, 96, 0.28)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(42, 42, W - 84, H - 84);

  // 3. 顶部朱红国号印章与大标题
  ctx.fillStyle = "#9c2d23";
  ctx.fillRect(72, 74, 82, 82);
  ctx.strokeStyle = "#f2cf88";
  ctx.lineWidth = 2;
  ctx.strokeRect(76, 78, 74, 74);
  ctx.fillStyle = "#fff3dc";
  ctx.font = "700 34px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(data.titleName.slice(0, 2), 113, 116);

  ctx.textAlign = "left";
  ctx.fillStyle = "#f4d38c";
  ctx.font = "700 44px serif";
  ctx.fillText(`经略三国 · ${data.titleName}战报`, 176, 102);
  ctx.fillStyle = "#c7b89c";
  ctx.font = "500 22px sans-serif";
  ctx.fillText(data.rulerTitle, 176, 144);

  // 右上史官大评级印
  ctx.fillStyle = "rgba(218, 178, 96, 0.14)";
  ctx.beginPath();
  ctx.arc(792, 118, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f0be5b";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = "#f7d484";
  ctx.font = "700 46px serif";
  ctx.textAlign = "center";
  ctx.fillText(data.grade, 792, 114);
  ctx.font = "600 14px sans-serif";
  ctx.fillText(`${data.score}分`, 792, 145);

  // 4. 中部疆域星图（按真实城池坐标绘制）
  const mapBox = { x: 72, y: 190, w: 756, h: 410 };
  ctx.fillStyle = "rgba(12, 10, 8, 0.72)";
  ctx.fillRect(mapBox.x, mapBox.y, mapBox.w, mapBox.h);
  ctx.strokeStyle = "rgba(218, 178, 96, 0.3)";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(mapBox.x, mapBox.y, mapBox.w, mapBox.h);

  const cities = world?.cities || [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of cities) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const project = (c) => [
    mapBox.x + 48 + ((c.x - minX) / spanX) * (mapBox.w - 96),
    mapBox.y + 42 + ((c.y - minY) / spanY) * (mapBox.h - 84),
  ];

  // 连线
  ctx.strokeStyle = "rgba(180, 155, 115, 0.16)";
  ctx.lineWidth = 1;
  const posMap = new Map(cities.map((c) => [c.key, project(c)]));
  for (const c of cities) {
    const p1 = posMap.get(c.key);
    for (const nb of c.links || []) {
      const p2 = posMap.get(nb);
      if (!p2) continue;
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.stroke();
    }
  }
  // 城池点
  for (const c of cities) {
    const [cx, cy] = posMap.get(c.key);
    const mine = state.cities?.[c.key]?.owner === state.player;
    ctx.beginPath();
    ctx.arc(cx, cy, mine ? 7.5 : 4.2, 0, Math.PI * 2);
    ctx.fillStyle = mine ? "#f2be54" : "rgba(145, 138, 126, 0.55)";
    ctx.fill();
    if (mine) {
      ctx.strokeStyle = "#fff3d6";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  // 5. 六格核心战绩数据卡片
  const metrics = [
    ["辖城疆域", `${data.ownedCount} / ${data.totalCities} 城`],
    ["三军总兵", `${data.totalTroops.toLocaleString()} 人`],
    ["国库 / 储粮", `${data.treasury} 金 · ${data.grain} 粮`],
    ["史官评语", data.verdict],
    ["军团 / 奇观", `${data.corpsCount} 军团 · ${data.wondersCount} 奇观`],
    ["阵前单挑", `${data.duelWins} 胜`],
  ];
  const cardW = 240;
  const cardH = 92;
  metrics.forEach(([k, v], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 72 + col * (cardW + 18);
    const y = 632 + row * (cardH + 16);
    ctx.fillStyle = "rgba(32, 26, 20, 0.88)";
    ctx.fillRect(x, y, cardW, cardH);
    ctx.strokeStyle = "rgba(218, 178, 96, 0.28)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, cardW, cardH);
    ctx.textAlign = "left";
    ctx.fillStyle = "#b5a68c";
    ctx.font = "500 16px sans-serif";
    ctx.fillText(k, x + 16, y + 30);
    ctx.fillStyle = "#f7e5be";
    ctx.font = "700 22px sans-serif";
    ctx.fillText(String(v).slice(0, 14), x + 16, y + 66);
  });

  // 6. 开国诏书 & 三国本纪铭文
  ctx.fillStyle = "#e8c477";
  ctx.font = "700 22px serif";
  ctx.textAlign = "left";
  ctx.fillText("【史官纪略】", 72, 886);
  ctx.fillStyle = "#e5d5b5";
  ctx.font = "500 19px serif";
  ctx.fillText(data.edict.slice(0, 38), 72, 924);

  const lines = data.annals.length ? data.annals : ["群雄逐鹿，铁马冰河，正待主公定鼎九州。"];
  ctx.fillStyle = "#c8bba1";
  ctx.font = "400 17px sans-serif";
  lines.forEach((line, idx) => {
    ctx.fillText(`• ${line.slice(0, 44)}`, 72, 972 + idx * 38);
  });

  // 7. 底部落款
  ctx.strokeStyle = "rgba(218, 178, 96, 0.28)";
  ctx.beginPath();
  ctx.moveTo(72, 1170);
  ctx.lineTo(828, 1170);
  ctx.stroke();
  ctx.fillStyle = "#a3947b";
  ctx.font = "500 16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("经略三国 v20.0 · 千秋一统 终极演义 · jinglue-sanguo.vercel.app", W / 2, 1212);

  return { data, dataUrl: canvas.toDataURL("image/png") };
}
