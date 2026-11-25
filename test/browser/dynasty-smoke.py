"""Play the 8.0 national flow, map drill-down, battle, and save on both layouts."""
import runpy
import sys
from pathlib import Path
from tempfile import gettempdir
from os import environ

from playwright.sync_api import sync_playwright

here = Path(__file__).resolve()
shared = runpy.run_path(str(here.with_name("campaign-smoke.py")))
war = runpy.run_path(str(here.with_name("high-command-smoke.py")))


def play(browser, address, viewport, exercise_battle):
    setup = war["seed"]()
    setup["state"]["factions"]["cao"].update(treasury=350, grain=350)
    setup["state"]["grand"]["depots"]["xu"] = 52
    mobile = viewport[0] < 800
    page, errors = shared["new_page"](browser, address, viewport, setup, mobile=mobile)
    desk = page.locator("#dynasty-dialog")
    use = lambda control: control.tap() if mobile else control.click()
    action = lambda key: desk.locator(f'[data-dynasty-action="{key}"]')
    field = lambda label: desk.get_by_label(label, exact=True)
    save = lambda: shared["saved"](page)
    fit = lambda: shared["fit"](page, "#dynasty-dialog")
    entry = lambda: use(page.locator("#open-frontline-map"))
    close = lambda: use(desk.get_by_role("button", name="返回地图"))

    use(page.locator("#open-menu"))
    use(page.locator("#open-dynasty-menu"))
    use(action("upgrade"))
    migrated = save()
    assert migrated.pop("dynasty")["since"] == 0
    assert migrated == setup["state"]
    fit()
    use(action("delegate-realm"))
    assert len(save()["dynasty"]["mandates"]["cao"]) >= 2
    use(action("programs"))
    field("实施城市").select_option("luoyang")
    use(action("new-project"))
    project = save()["dynasty"]["programs"][0]["id"]
    use(action("budget"))
    field("每季拨钱").fill("48")
    use(action("forecast"))
    assert desk.locator(".dynasty-forecast p").count() == 4
    fit()
    use(action("apply-forecast"))
    assert save()["dynasty"]["policies"]["cao"]["money"] == 48
    use(action("local"))
    field("州牧").select_option(index=1)
    use(action("delegate"))
    field("地方处置").select_option("charter")
    use(action("jurisdiction"))
    fit()
    state = save()
    assert state["dynasty"]["mandates"]["cao"]
    assert any(item["pending"] == "charter" for item in state["dynasty"]["provinces"]["cao"].values())
    use(action("court"))
    field("继承人").select_option(index=1)
    use(action("succession"))
    assert save()["polity"]["courts"]["cao"]["heir"]
    fit()
    use(action("supply"))
    field("本方城市").select_option("luoyang")
    use(action("dispatch"))
    assert save()["dynasty"]["convoys"][0]["status"] == "march"
    use(action("supply-map"))
    assert page.locator(".dynasty-freight-pin:not([hidden])").count() == 1
    city = page.locator('.city-pin[data-city-pin="luoyang"]:not([hidden])')
    use(city)
    assert desk.get_by_role("heading", name="在途补给").count() == 1
    fit()
    close()
    use(page.locator("#dynasty-map-return"))

    entry()
    use(action("treaties"))
    field("交涉势力").select_option("biao")
    field("季付钱").fill("18")
    use(action("propose"))
    accord = save()["dynasty"]["treaties"][0]["id"]
    field("和约档案").select_option(str(accord))
    assert desk.get_by_text("待答复", exact=False).count() >= 1
    fit()
    use(action("summary"))
    if viewport in ((1440, 900), (390, 844)):
        page.screenshot(path=str(Path(gettempdir()) / f"san8-dynasty-{viewport[0]}.png"))
    if exercise_battle:
        use(action("military"))
        council = page.locator("#high-command-dialog")
        command = lambda key: council.locator(f'[data-command="{key}"]')
        use(command("new-campaign"))
        command("target").select_option("changan:luoyang")
        use(command("authorize"))
        use(command("battlefield"))
        battle = page.locator("#frontline-dialog")
        battle.locator('.frontline-scene[data-unit-art="formations"][data-terrain-art="pass"]').wait_for(state="visible")
        use(battle.locator("[data-field-formation]").first)
        use(battle.locator('[data-field-role="advance"]'))
        use(battle.get_by_role("button", name="更新调令"))
        shared["fit"](page, "#frontline-dialog")
        page.screenshot(path=str(Path(gettempdir()) / f"san8-battle-{viewport[0]}.png"))
        use(battle.get_by_role("button", name="返回地图"))
        entry()
        use(action("summary"))
    use(action("advance"))
    state = shared["wait_for_turn"](page, 1)
    assert state["dynasty"]["programs"][0]["id"] == project and state["dynasty"]["programs"][0]["made"] >= 1
    assert state["dynasty"]["treaties"][0]["status"] == "active"
    assert state["history"][0]["finance"]["dynasty"]["budget"]["treasury"] > 0
    if exercise_battle:
        assert state["sandtable"]["posts"]["changan:luoyang"]["owner"] == "cao"
    shared["advance"](page, 2)
    assert save()["dynasty"]["treaties"][0]["paid"] == 18
    entry()
    use(action("history"))
    field("纪事时点").select_option("1")
    use(action("replay-map"))
    assert page.locator("#map-stage").get_attribute("data-dynasty-replay") == "true"
    use(page.locator("#dynasty-map-return"))
    original = save()
    page.reload()
    page.locator("#open-frontline-map").wait_for(state="visible")
    assert save() == original
    shared["fit"](page, "html")
    assert not errors, errors
    page.close()
    print(f"{viewport}: 旧档、立项、四季推演、州牧、继嗣、粮运、和约履约、回看及重读" + ("、实际会战" if exercise_battle else ""), flush=True)


def main():
    edge = Path(environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe"
    path = environ.get("SAN_CHROMIUM_PATH") or (str(edge) if edge.is_file() else None)
    with shared["isolated_game"]() as address, sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=path, headless=True)
        for viewport in ((1440, 900), (390, 844), (320, 360), (568, 320)):
            if len(sys.argv) == 1 or str(viewport[0]) in sys.argv[1:]:
                play(browser, address, viewport, viewport[0] in (1440, 390))
        browser.close()


if __name__ == "__main__":
    main()
