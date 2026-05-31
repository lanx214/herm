import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"
import * as homeMod from "../src/home"
import type { HermesConfig } from "../src/service/hermes-home"
import type { GatewayEvent } from "../src/context/wire"

const cfg = (on: boolean): HermesConfig => ({
  source: { file: "config.yaml", label: "config.yaml", relative: "config.yaml" },
  model: { default: "", provider: "", base_url: "" },
  agent: { max_turns: 60, reasoning_effort: "" },
  compression: { enabled: true, threshold: 0.5, target_ratio: 0.2, protect_last_n: 20, summary_model: "" },
  memory: {
    memory_enabled: true, user_profile_enabled: true, memory_char_limit: 2200,
    user_char_limit: 1375, provider: "", nudge_interval: 10, flush_min_turns: 6,
  },
  display: { personality: "", skin: "", show_cost: false, tui_agents_nudge: on },
  curator: { enabled: true, interval_hours: 168, stale_after_days: 30, archive_after_days: 90 },
  approvals: { destructive_slash_confirm: true },
  gateway: { platforms: {} },
})

const subagent = (type: "subagent.start" | "subagent.spawn_requested", task_index = 0): GatewayEvent => ({
  type,
  payload: { task_index, goal: "inspect" },
})

async function setup(on: boolean) {
  const prev = homeMod.home.get("config")
  homeMod.home.setForTest("config", cfg(on))
  const gw = new MockGateway({ "commands.catalog": () => ({ pairs: [["/agents", "Open Agents"]] }) })
  const t = await mount({ gw, width: 160, height: 48 })
  await until(t, () => t.frame().includes("Ready"))
  return { t, gw, restore: () => homeMod.home.setForTest("config", prev) }
}

describe("Agents nudge app integration", () => {
  test("appears only once per turn and resets on message.start", async () => {
    const { t, gw, restore } = await setup(true)
    try {
      act(() => gw.push(subagent("subagent.start")))
      await until(t, () => t.frame().includes("subagents working · /agents to watch live"))
      act(() => gw.push(subagent("subagent.start", 2)))
      await t.settle()
      expect(t.frame().match(/subagents working · \/agents to watch live/g)?.length).toBe(1)

      act(() => gw.push({ type: "message.start" }))
      await t.settle()
      act(() => gw.push({ type: "message.complete", payload: { text: "" } }))
      await t.settle()
      act(() => gw.push(subagent("subagent.spawn_requested", 1)))
      await t.settle()
      expect(t.frame().match(/subagents working · \/agents to watch live/g)?.length).toBe(2)
    } finally {
      restore()
      t.destroy()
    }
  })

  test("is suppressed when config is disabled or Agents is active", async () => {
    const off = await setup(false)
    try {
      act(() => off.gw.push(subagent("subagent.start")))
      await off.t.settle()
      expect(off.t.frame()).not.toContain("subagents working")
    } finally {
      off.restore()
      off.t.destroy()
    }

    const on = await setup(true)
    try {
      await act(async () => { await on.t.keys.typeText("/agents") })
      act(() => on.t.keys.pressEnter())
      await until(on.t, () => on.t.frame().includes("Profiles") && on.t.frame().includes("Delegation"))
      act(() => on.gw.push(subagent("subagent.start")))
      await on.t.settle()
      expect(on.t.frame()).not.toContain("subagents working")
    } finally {
      on.restore()
      on.t.destroy()
    }
  })
})
