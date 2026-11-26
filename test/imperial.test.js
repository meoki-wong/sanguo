import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createGame, decodeSave, eraByYear, forceTotals, previewOrders } from "../dist/engine.js";
import {
  HISTORICAL_PROVINCE, factionCourtProfile, hanEmperorStatus, historicalProvince, proclaimImperialChoice,
} from "../dist/imperial.js";
import { enrichWorld } from "../dist/personnel.js";
import { strategicPosts } from "../dist/sandtable-posts.js";
import { buildImperialMemorials } from "../dist/sovereign.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

test("all 44 cities map to Later Han / RTK11 13 historical provinces including Jiaozhou", () => {
  const validProvinces = new Set([
    "司隶", "幽州", "并州", "冀州", "青州", "兖州",
    "豫州", "徐州", "扬州", "荆州", "益州", "凉州", "交州",
  ]);
  assert.equal(world.cities.length, 44);
  assert.equal(Object.keys(HISTORICAL_PROVINCE).length, 44);
  for (const city of world.cities) {
    const prov = historicalProvince(city.key);
    assert.ok(validProvinces.has(prov), `${city.key} -> ${prov}`);
  }
  assert.equal(historicalProvince("luoyang"), "司隶");
  assert.equal(historicalProvince("xu"), "豫州");
  assert.equal(historicalProvince("wan"), "荆州");
  assert.equal(historicalProvince("moling"), "扬州");
  assert.equal(historicalProvince("panyu"), "交州");
  assert.equal(historicalProvince("jiaozhi"), "交州");
});

test("Shi Xie and Jiaozhou (Panyu/Jiaozhi) are playable across 184-208 and Wu-held in 219-265", () => {
  for (const year of [184, 190, 199, 208]) {
    const state = createGame(world, year, "shi");
    assert.equal(forceTotals(state, "shi").cities, 2);
    assert.equal(state.cities.panyu.owner, "shi");
    assert.equal(state.cities.jiaozhi.owner, "shi");
    const prof = factionCourtProfile(world, state, "shi");
    assert.equal(prof.tier, "warlord");
  }
  for (const year of [219, 234, 262, 265]) {
    const state = createGame(world, year, "wu");
    assert.equal(state.cities.panyu.owner, "wu");
    assert.equal(state.cities.jiaozhi.owner, "wu");
  }
});

test("RTK11 strategicPosts cover canonical passes and ports with valid links and unique keys", () => {
  assert.equal(strategicPosts.length, 48);
  const cityMap = new Map(world.cities.map((c) => [c.key, c]));
  const seenKeys = new Set();
  for (const post of strategicPosts) {
    assert.ok(!seenKeys.has(post.key), `duplicate key: ${post.key}`);
    seenKeys.add(post.key);
    assert.ok(cityMap.get(post.seat)?.links.includes(post.to), `${post.name} (${post.seat}-${post.to}) must be an existing road link`);
  }
  assert.equal(new Set(strategicPosts.map((p) => p.kind)).size, 5);
  const names = new Set(strategicPosts.map((p) => p.name));
  for (const required of [
    "虎牢关", "潼关", "函谷关", "壶关", "武关", "阳平关", "剑门关", "梅关",
    "白马港", "官渡港", "乌林港", "濡须口", "灵渠渡", "合浦港", "东冶港",
  ]) {
    assert.ok(names.has(required), `missing RTK11 landmark: ${required}`);
  }
});

test("strict historical polity tiers separate Emperor courts from warlords and regents", () => {
  const g184 = createGame(world, 184, "jian");
  assert.equal(factionCourtProfile(world, g184, "han").tier, "imperial");
  assert.equal(factionCourtProfile(world, g184, "han").lexicon.org, "朝廷");
  assert.equal(factionCourtProfile(world, g184, "yellow").tier, "rebel");
  assert.equal(factionCourtProfile(world, g184, "yellow").lexicon.org, "天公府");
  assert.equal(factionCourtProfile(world, g184, "jian").tier, "warlord");
  assert.equal(factionCourtProfile(world, g184, "jian").lexicon.org, "幕府");

  const g190 = createGame(world, 190, "yuan");
  assert.equal(factionCourtProfile(world, g190, "dong").tier, "regent");
  assert.ok(factionCourtProfile(world, g190, "dong").holdsEmperor);
  assert.equal(factionCourtProfile(world, g190, "yuan").tier, "warlord");
  assert.equal(factionCourtProfile(world, g190, "yuan").lexicon.memorialsTitle, "幕府军报");

  const g199Cao = createGame(world, 199, "cao");
  const caoProfile = factionCourtProfile(world, g199Cao, "cao");
  assert.equal(caoProfile.tier, "regent");
  assert.equal(caoProfile.isImperial, false);
  assert.equal(caoProfile.holdsEmperor, true);
  assert.match(caoProfile.badge, /奉天子/);
  assert.equal(caoProfile.lexicon.org, "霸府");

  const g199Yuan = createGame(world, 199, "yuan");
  assert.equal(factionCourtProfile(world, g199Yuan, "yuan").tier, "warlord");
  assert.equal(factionCourtProfile(world, g199Yuan, "yuan").lexicon.org, "幕府");
  const yuanMem = buildImperialMemorials(world, g199Yuan, previewOrders(world, g199Yuan));
  const combinedText = JSON.stringify(yuanMem.memorials);
  assert.ok(!/朝廷|陛下|圣旨|准奏|御案/.test(combinedText), `warlord memorials leaked imperial terms: ${combinedText}`);

  const g219 = createGame(world, 219, "liu");
  assert.equal(factionCourtProfile(world, g219, "cao").tier, "royal");
  assert.equal(factionCourtProfile(world, g219, "liu").tier, "royal");
  assert.equal(factionCourtProfile(world, g219, "liu").lexicon.org, "王府");
  assert.equal(factionCourtProfile(world, g219, "wu").tier, "warlord");

  for (const [year, faction] of [[234, "wei"], [234, "shu"], [234, "wu"], [265, "jin"]]) {
    const state = createGame(world, year, faction);
    const prof = factionCourtProfile(world, state, faction);
    assert.equal(prof.tier, "imperial");
    assert.equal(prof.lexicon.org, "朝廷");
    assert.equal(prof.lexicon.memorialsTitle, "御案奏折");
    assert.equal(hanEmperorStatus(state).active, false);
  }
});

test("capturing Xuchang shifts Emperor custody, and proclaimImperialChoice persists natively in save JSON", () => {
  const g199Yuan = createGame(world, 199, "yuan");
  const era199 = eraByYear(world, g199Yuan);
  const transferCity = (st, cityKey, nextOwner) => {
    const city = st.cities[cityKey];
    city.owner = nextOwner;
    city.governor = null;
    city.commander = null;
    city.mode = "direct";
    for (const officer of era199.officers) {
      if (st.stations?.[officer.key] === cityKey && officer.faction !== nextOwner) {
        st.stations[officer.key] = null;
      }
    }
  };

  const capturedXu = structuredClone(g199Yuan);
  transferCity(capturedXu, "xu", "yuan");

  assert.equal(hanEmperorStatus(capturedXu).patron, "yuan");
  assert.equal(factionCourtProfile(world, capturedXu, "yuan").tier, "regent");
  assert.equal(factionCourtProfile(world, capturedXu, "yuan").holdsEmperor, true);
  assert.equal(factionCourtProfile(world, capturedXu, "cao").holdsEmperor, false);

  const grandYuan = structuredClone(capturedXu);
  let count = Object.values(grandYuan.cities).filter((c) => c.owner === "yuan").length;
  for (const cityKey of Object.keys(grandYuan.cities)) {
    if (count >= 18) break;
    if (grandYuan.cities[cityKey].owner !== "yuan") {
      transferCity(grandYuan, cityKey, "yuan");
      count += 1;
    }
  }
  const loyalProfile = factionCourtProfile(world, grandYuan, "yuan");
  assert.equal(loyalProfile.canClaimEmperor, true);
  assert.equal(loyalProfile.tier, "royal");
  const mem = buildImperialMemorials(world, grandYuan, previewOrders(world, grandYuan));
  assert.equal(mem.memorials[0].kind, "claim-emperor");

  const claimed = proclaimImperialChoice(world, grandYuan, "emperor");
  assert.equal(claimed.imperialChoice, "emperor");
  const roundTrip = decodeSave(world, JSON.stringify(claimed));
  assert.equal(roundTrip.imperialChoice, "emperor");

  const imperialProfile = factionCourtProfile(world, roundTrip, "yuan");
  assert.equal(imperialProfile.tier, "imperial");
  assert.equal(imperialProfile.lexicon.org, "朝廷");
  assert.equal(hanEmperorStatus(roundTrip).active, false);
});
