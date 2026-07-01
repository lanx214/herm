import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, mountNode, MockGateway, until } from "./harness"
import { Journey, buildJourneyRows } from "../src/tabs/Journey"
import { TAB_SLASH } from "../src/app/tabs"
import { resolve, LOCAL_COMMANDS } from "../src/app/slashCommands"
import type { LearningFramesResponse } from "../src/context/wire"

const frames = (): LearningFramesResponse => ({
  frames: [{
    reveal: 1,
    date: "2026-06-30",
    visible: 2,
    grid: [[
      ["╭", "dim"],
      ["●", "memory"],
      ["─", "dim"],
      ["◆", "skill"],
      ["╯", "dim"],
    ]],
    labels: [],
  }],
  legend: [{ glyph: "●", style: "memory", label: "memory" }],
  categories: [{ glyph: "◆", color: "#00ffff", label: "skills" }],
  buckets: [{
    index: 0,
    label: "Jun 30",
    date: "2026-06-30",
    skills: 1,
    memories: 1,
    total: 2,
    category: "recent",
    color: "#00ffff",
    nodes: [
      { id: "skill-a", glyph: "◆", label: "Skill", fullLabel: "Skill A", meta: "skill", body: "", style: "skill" },
      { id: "memory:memory:0", glyph: "●", label: "Memory", fullLabel: "Memory card", meta: "MEMORY.md", body: "remember me", style: "memory" },
    ],
  }],
  summary: ["2 learned items"],
  axis: { start: "2026-06-30", end: "2026-06-30" },
  count: 2,
  cols: 80,
  rows: 8,
})

const oldFrames = (): LearningFramesResponse => ({
  ...frames(),
  buckets: [
    frames().buckets![0],
    { ...frames().buckets![0], index: 1, label: "Jul 01", nodes: [
      { id: "memory:memory:1", glyph: "●", label: "New", fullLabel: "Newest memory", meta: "MEMORY.md", body: "new", style: "memory" },
    ] },
  ],
  count: 3,
})

describe("Journey", () => {
  test("builds chronological slice and item rows with gaps", () => {
    const data = frames()
    const rows = buildJourneyRows([data.buckets![0], { ...data.buckets![0], index: 1, label: "Jul 01" }])
    expect(rows.map(r => r.kind)).toEqual(["slice", "node", "node", "gap", "slice", "node", "node"])
  })

  test("renders learning frames and opens detail through RPC", async () => {
    const gw = new MockGateway({
      "learning.frames": () => frames(),
      "learning.detail": p => ({ ok: true, kind: "memory", id: p.id, label: "Memory card", content: "full memory body" }),
    })
    await using t = await mountNode(<Journey focused />, { gw, width: 120, height: 36 })
    await until(t, () => t.frame().includes("Journey · 2 learned items"))

    expect(t.frame()).toContain("Jun 30")
    expect(t.frame()).toContain("Memory card")
    expect(t.gw.last("learning.frames")?.params.frames).toBe(2)

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("full memory body"))
    expect(t.gw.last("learning.detail")?.params.id).toBe("memory:memory:0")
  })

  test("opens on the newest learned node", async () => {
    const gw = new MockGateway({
      "learning.frames": () => oldFrames(),
      "learning.detail": p => ({ ok: true, kind: "memory", id: p.id, label: "Newest memory", content: "newest detail" }),
    })
    await using t = await mountNode(<Journey focused />, { gw, width: 120, height: 36 })
    await until(t, () => t.frame().includes("Newest memory"))

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("newest detail"))
    expect(t.gw.last("learning.detail")?.params.id).toBe("memory:memory:1")
  })

  test("shows empty and RPC-error states", async () => {
    await using empty = await mountNode(<Journey focused />, {
      gw: new MockGateway({ "learning.frames": () => ({ ...frames(), count: 0, buckets: [] }) }),
    })
    await until(empty, () => empty.frame().includes("No learning yet"))

    await using fail = await mountNode(<Journey focused />, {
      gw: new MockGateway({ "learning.frames": () => { throw new Error("learning.frames failed") } }),
    })
    await until(fail, () => fail.frame().includes("learning.frames failed"))
  })

  test("delete uses confirm dialog and refreshes after mutation", async () => {
    let n = 0
    const gw = new MockGateway({
      "learning.frames": () => { n++; return frames() },
      "learning.delete": p => ({ ok: true, message: `deleted ${p.id}` }),
    })
    await using t = await mountNode(<Journey focused />, { gw })
    await until(t, () => t.frame().includes("Memory card"))

    act(() => t.keys.pressKey("d"))
    await until(t, () => t.frame().includes("Delete Memory?"))
    act(() => t.keys.pressKey("y"))
    await until(t, () => n > 1)
    expect(t.gw.last("learning.delete")?.params.id).toBe("memory:memory:0")
  })

  test("slash aliases route to the native Journey surface", async () => {
    expect(TAB_SLASH.journey).toEqual({ tab: 1, sub: 3 })
    expect(TAB_SLASH.learning).toEqual({ tab: 1, sub: 3 })
    expect(TAB_SLASH["memory-graph"]).toEqual({ tab: 1, sub: 3 })
    expect(resolve(LOCAL_COMMANDS, "learning")).toMatchObject({ hit: { name: "journey" } })
    expect(resolve(LOCAL_COMMANDS, "journey")).toMatchObject({ hit: { target: "local" } })

    await using t = await mount({
      handlers: { "learning.frames": () => frames() },
      width: 130,
      height: 40,
    })
    await until(t, () => t.frame().includes("Ready"))
    await act(async () => { await t.keys.typeText("/journey") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Journey · 2 learned items"))
    expect(t.gw.last("slash.exec")).toBeUndefined()
  })
})
