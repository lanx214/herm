import { test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { EikonGallery } from "../src/tabs/EikonGallery"
import { EIKON_TAB, SUB_TABS, TAB_SLASH } from "../src/app/tabs"

test("Eikon sub-tabs put Gallery before Studio and preserve slash routes", () => {
  expect(SUB_TABS[EIKON_TAB]).toEqual(["Gallery", "Studio"])
  expect(TAB_SLASH.gallery).toEqual({ tab: EIKON_TAB, sub: 0 })
  expect(TAB_SLASH.studio).toEqual({ tab: EIKON_TAB, sub: 1 })
})

test("Access Web Gallery is keyboard navigable and mouse clickable", async () => {
  const hits: string[] = []
  await using t = await mountNode(
    <EikonGallery focused opener={(url: string) => { hits.push(url); return true }} />,
    { width: 160, height: 48 },
  )
  await until(t, () => t.frame().includes("Access Web Gallery"))

  expect(t.frame()).toContain("▸ [ Access Web Gallery ]")
  act(() => t.keys.pressArrow("down")); await t.settle()
  expect(t.frame()).toContain("  [ Access Web Gallery ]")
  act(() => t.keys.pressArrow("up")); await t.settle()
  expect(t.frame()).toContain("▸ [ Access Web Gallery ]")

  act(() => t.keys.pressEnter()); await t.settle()
  expect(hits).toEqual(["https://eikon.liftaris.dev"])

  const lines = t.frame().split("\n")
  const y = lines.findIndex(l => l.includes("Access Web Gallery"))
  expect(y).toBeGreaterThanOrEqual(0)
  await act(async () => { await t.mouse.pressDown(lines[y]!.indexOf("Access Web Gallery") + 1, y) })
  await t.settle()
  expect(hits).toEqual(["https://eikon.liftaris.dev", "https://eikon.liftaris.dev"])
})

test("Gallery title remains readable beside web action at narrow widths", async () => {
  await using t = await mountNode(
    <EikonGallery focused opener={() => true} />,
    { width: 80, height: 32 },
  )
  await until(t, () => t.frame().includes("Access Web Gallery"))

  const row = t.frame().split("\n").find(l => l.includes("Access Web Gallery")) ?? ""
  expect(row).toContain("Gallery (")
})
