"""Exercise the 6.0 map and battle controls through Chromium."""
import json
import os
import runpy
import subprocess
from pathlib import Path
from tempfile import gettempdir

from playwright.sync_api import sync_playwright


shared = runpy.run_path(str(Path(__file__).with_name("campaign-smoke.py")))


def theater_seed():
    code = """
import fs from 'node:fs';
import {enrichWorld} from './dist/personnel.js';
import {createGame} from './dist/engine.js';
import {prepareConvoy} from './dist/landscape-economy.js';
const world = enrichWorld(JSON.parse(fs.readFileSync('dist/assets/world.json')));
let state = createGame(world, 199, 'cao', {frontline:true});
const unit = state.armies.find(a=>a.faction==='cao');
Object.assign(unit,{location:'luoyang',depot:'luoyang',target:'luoyang',route:['luoyang']});
state.cities.ye.troops=260;
state.cities.ye.defense=0;
const rival=state.armies.find(a=>a.faction==='yuan');
Object.assign(rival,{location:'nanpi',depot:'nanpi',target:'nanpi',route:['nanpi']});
state = prepareConvoy(world, state, {from:'xu',to:'luoyang',mode:'land',cargo:'grain',amount:12});
console.log(JSON.stringify({state,selected:'luoyang'}));
"""
    return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", code], cwd=shared["ROOT"], encoding="utf-8"))


def verify(browser, address, viewport):
    mobile = viewport[0] < 800
    page, errors = shared["new_page"](browser, address, viewport, theater_seed(), mobile=mobile)
    dialog = page.locator("#frontline-dialog")
    use = lambda locator: locator.tap() if mobile else locator.click()
    assert int(page.locator("#map-stage").get_attribute("data-garrisons")) >= 8
    sprite = page.locator(".troop-pin[data-army-officer^='cao']:not([hidden])").first
    sprite.wait_for(state="visible")
    wagon = page.locator("[data-visual-kind='wagon']:not([hidden])").first
    wagon.wait_for(state="visible")
    use(page.locator('[data-map-layer="factions"]'))
    assert sprite.get_attribute("data-far") == "true"
    use(page.locator('[data-map-layer="cities"]'))
    assert sprite.get_attribute("data-far") == "false"
    if viewport in ((1440, 900), (390, 844)):
        page.screenshot(path=str(Path(gettempdir()) / f"san-frontline-{viewport[0]}-map.png"))
    use(sprite)
    assert dialog.get_by_text("轮换整补", exact=True).is_visible()
    shared["fit"](page, "#frontline-dialog")
    use(dialog.get_by_role("button", name="返回地图"))
    use(page.locator("#open-frontline-map"))
    dialog.locator('[data-battle="objective"]').select_option("ye")
    dialog.locator('[data-battle="mode"]').select_option("direct")
    dialog.locator('[data-battle^="unit-"]').first.select_option("advance")
    assert dialog.locator(".frontline-scene").is_visible()
    use(dialog.get_by_role("button", name="授权会战"))
    assert shared["saved"](page)["frontline"]["plans"][0]["units"][0]["role"] == "advance"
    shared["fit"](page, "#frontline-dialog")
    if viewport in ((1440, 900), (390, 844)):
        page.screenshot(path=str(Path(gettempdir()) / f"san-frontline-{viewport[0]}-plan.png"))
    use(dialog.get_by_role("button", name="推进一季"))
    state = shared["wait_for_turn"](page, 1)
    assert state["cities"]["ye"]["owner"] == "cao"
    assert state["landscape"]["convoys"][0]["status"] == "delivered"
    use(page.locator("#open-frontline-map"))
    use(dialog.get_by_role("button", name="战报回看"))
    use(dialog.get_by_role("button", name="接战", exact=True))
    assert dialog.get_by_text("战力", exact=False).count() == 2
    use(dialog.get_by_role("button", name="战果", exact=True))
    assert dialog.get_by_text("曹操占优。").is_visible()
    shared["fit"](page, "#frontline-dialog")
    if viewport in ((1440, 900), (390, 844)):
        page.screenshot(path=str(Path(gettempdir()) / f"san-frontline-{viewport[0]}-replay.png"))
    use(dialog.get_by_role("button", name="返回地图"))
    shared["fit"](page, "html")
    page.reload()
    assert shared["saved"](page)["frontline"]["battles"]
    assert not errors, errors
    page.close()
    print(f"{viewport}: 地图军团与粮车、手动主攻、占领、回放、读档通过", flush=True)


def main():
    edge = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe"
    browser_path = os.getenv("SAN_CHROMIUM_PATH") or (str(edge) if edge.is_file() else None)
    with shared["isolated_game"]() as address, sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=browser_path, headless=True)
        for viewport in ((1440, 900), (390, 844), (320, 360), (568, 320)):
            verify(browser, address, viewport)
        browser.close()


if __name__ == "__main__":
    main()
