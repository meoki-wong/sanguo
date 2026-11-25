"""Play the 10.0 national, military and post-victory flows on desktop and touch."""
import json
import os
import runpy
import subprocess
import sys
from pathlib import Path
from tempfile import gettempdir

from playwright.sync_api import sync_playwright

here = Path(__file__).resolve()
shared = runpy.run_path(str(here.with_name("campaign-smoke.py")))

foundation = """
import fs from 'node:fs';
import {enrichWorld} from './dist/personnel.js';
import {advanceQuarter,createGame,decodeSave,eraByYear,gameOutcome} from './dist/engine.js';
import {commissionProgram} from './dist/dynasty-economy.js';
import {charterFront9,publishStrategy9} from './dist/strategy-nine.js';
import {saveSuccession} from './dist/polity-governance.js';
import {proposePackage} from './dist/grand-diplomacy.js';
import {concludePeace,peaceCriteria} from './dist/polity.js';
import {publishReign,reignPolicy} from './dist/reign.js';
const w=enrichWorld(JSON.parse(fs.readFileSync('dist/assets/world.json')));
"""


def seed(stewardship=False):
    setup = """
let s=createGame(w,199,'cao',{strategic:true});
s.factions.cao.grain=350;
s.factions.cao.treasury=350;
s.grand.depots.luoyang=30;
const main=s.armies.find((a)=>a.faction==='cao');
Object.assign(main,{location:'luoyang',depot:'luoyang',target:'luoyang',route:['luoyang'],troops:3200,grain:80});
Object.assign(s.armies.find((a)=>a.faction==='ma'),{troops:470,grain:80});
s=commissionProgram(w,s,{city:'luoyang',kind:'fields',money:80,grain:40});
s=publishStrategy9(w,s,{primary:{kind:'corridor',key:'changan:luoyang'},secondary:{kind:'stability',key:'luoyang'},
  money:42,grain:60,manpower:1400,transport:3,negotiate:false});
s=charterFront9(w,s,{role:'diversion',target:'changan:luoyang',commander:main.officer,priority:5,retire:400,term:8});
""" if not stewardship else """
let s=createGame(w,199,'cao',{reign:true});
s=saveSuccession(w,eraByYear(w,s),s,{heir:'cao-0',regent:'cao-1',abdicate:true});
for (const to of ['yuan','ce']) s=proposePackage(w,s,{from:'cao',to,halt:true,pass:false,city:null,joint:null,grain:0,treasury:15});
while(!peaceCriteria(w,s).ready && gameOutcome(s)==='ongoing' && s.turn<45) s=advanceQuarter(w,s);
s=concludePeace(w,s);
"""
    script = foundation + setup + "decodeSave(w,JSON.stringify(s));console.log(JSON.stringify({state:s,selected:'luoyang'}));"
    return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script], cwd=shared["ROOT"], encoding="utf-8"))


def setup_inputs(browser, address, viewport, fixture):
    touch = viewport[0] < 800
    page, errors = shared["new_page"](browser, address, viewport, seed=fixture, mobile=touch)
    desk = page.locator("#reign-dialog")
    use = lambda target: target.tap() if touch else target.click()
    action = lambda key: desk.locator(f'[data-reign-action="{key}"]')
    field = lambda label: desk.get_by_label(label, exact=True)
    return page, errors, desk, use, action, field


def play(browser, address, viewport):
    prior = seed()
    page, errors, desk, use, action, field = setup_inputs(browser, address, viewport, prior)
    save = lambda: shared["saved"](page)
    fit = lambda: shared["fit"](page, "#reign-dialog")
    entry = lambda: use(page.locator("#open-frontline-map"))
    close = lambda: use(desk.get_by_role("button", name="返回地图"))
    use(page.locator("#open-menu"))
    use(page.locator("#open-reign-menu"))
    use(action("upgrade"))
    migrated = save()
    assert migrated.pop("reign")["since"] == 0 and migrated == prior["state"]
    fit()
    use(action("start-policy"))
    field("治理制度").select_option("central")
    use(action("to-authority"))
    field("地方目标库存").fill("18")
    use(action("review-policy"))
    fit()
    assert desk.get_by_role("heading", name="下一季预演").count() == 1
    use(action("policy-map"))
    assert page.locator("#map-stage").get_attribute("data-reign-lens") == "economy"
    use(page.locator("#reign-map-close"))
    entry()
    use(action("policy"))
    use(action("publish"))
    assert save()["reign"]["blueprint"]["stateForm"] == "central"
    assert save()["reign"]["seats"]
    fit()
    use(action("staff"))
    field("州郡").select_option("中原与淮北")
    use(action("province-grant"))
    fit()
    field("册任范围").select_option("offices")
    field("朝廷主官").select_option(index=1)
    use(action("court-grant"))
    assert save()["reign"]["offices"]["civil"]["lead"]
    fit()
    field("册任范围").select_option("commands")
    field("战区副手").select_option(index=1)
    use(action("command-grant"))
    assert save()["reign"]["deputies"]
    fit()
    use(action("markets"))
    field("粮政城市").select_option("luoyang")
    use(action("order-relief"))
    use(action("economy-map"))
    use(page.locator('[data-city-pin="luoyang"]:not([hidden])'))
    assert field("粮政城市").input_value() == "luoyang"
    fit()
    close()
    page.locator("#reign-map-lens").select_option("diplomacy")
    assert page.locator("#map-stage").get_attribute("data-reign-lens") == "diplomacy"
    use(page.locator("#reign-map-close"))
    entry()
    use(action("leagues"))
    field("共同目标").select_option("yuan")
    field("邀请主盟友").select_option("biao")
    use(action("summon"))
    assert save()["reign"]["leagues"][0]["invited"] == ["biao"]
    fit()
    use(action("summary"))
    use(action("advance"))
    state = shared["wait_for_turn"](page, 1)
    assert state["reign"]["leagues"][0]["status"] == "active"
    assert len(state["reign"]["markets"]) == 42
    assert state["reign"]["markets"]["luoyang"]["paid"] > 0
    assert state["reign"]["records"][0]["battles"]
    assert state["sandtable"]["posts"]["changan:luoyang"]["owner"] == "cao"
    assert state["dynasty"]["programs"][0]["made"] == 1
    entry()
    use(action("record"))
    use(action("timeline"))
    assert page.locator("#map-stage").get_attribute("data-dynasty-replay") == "true"
    use(page.locator("#dynasty-map-return"))
    entry()
    use(action("record"))
    use(action("replay"))
    battle = page.locator("#frontline-dialog")
    battle.locator(".frontline-scene[data-campaign-terrain][data-unit-art='formations']").wait_for(state="visible")
    use(battle.locator('[data-battle-step="2"]'))
    assert battle.locator(".battlefield-force").count() == 2
    shared["fit"](page, "#frontline-dialog")
    if viewport[0] in (390, 1440):
        page.screenshot(path=str(Path(gettempdir()) / f"san10-battle-{viewport[0]}.png"))
    use(battle.get_by_role("button", name="返回地图"))
    shared["advance"](page, 2)
    assert save()["reign"]["leagues"][0]["members"]["biao"]["paid"] == 4
    saved = save()
    page.reload()
    page.locator("#open-frontline-map").wait_for(state="visible")
    assert save() == saved, errors
    shared["fit"](page, "html")
    assert not errors, errors
    page.close()
    print(f"{viewport}: 9.0 迁移、三步国策、三级册任、粮政地图、集团履约、夺关回放与重读", flush=True)


def play_stewardship(browser, address, viewport):
    prior = seed(True)
    page, errors, desk, use, action, field = setup_inputs(browser, address, viewport, prior)
    save = lambda: shared["saved"](page)
    entry = lambda: use(page.locator("#open-frontline-map"))
    entry()
    use(action("continue"))
    assert save()["reign"]["stewardship"]["kind"] == "peace"
    use(action("armistice"))
    use(action("staff"))
    field("册任范围").select_option("succession")
    field("继任人").select_option(index=1)
    heir = field("继任人").input_value()
    field("下季交班").check()
    use(action("succession"))
    use(action("summary"))
    use(action("advance"))
    first = prior["state"]["turn"]
    state = shared["wait_for_turn"](page, first + 1)
    assert state["polity"]["courts"]["cao"]["head"] == heir
    for _ in range(18):
        if state["reign"]["stewardship"]["finished"] is not None:
            break
        shared["advance"](page, state["turn"] + 1)
        state = save()
    assert state["reign"]["stewardship"]["finished"] is not None
    outcome = page.locator("#outcome-dialog")
    outcome.get_by_role("heading", name="守成篇结卷").wait_for(state="visible")
    shared["fit"](page, "#outcome-dialog")
    assert not errors, errors
    page.close()
    print(f"{viewport}: 从真实承平结局继续，完成继位并结卷守成篇", flush=True)


def main():
    edge = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe"
    path = os.getenv("SAN_CHROMIUM_PATH") or (str(edge) if edge.is_file() else None)
    with shared["isolated_game"]() as address, sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=path, headless=True)
        for viewport in ((1440, 900), (390, 844), (320, 360), (568, 320)):
            if len(sys.argv) == 1 or str(viewport[0]) in sys.argv[1:]:
                play(browser, address, viewport)
                if viewport[0] in (1440, 390):
                    play_stewardship(browser, address, viewport)
        browser.close()


if __name__ == "__main__":
    main()
