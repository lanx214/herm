import { describe, expect, test } from "bun:test"
import { agentsNudge, agentsNudgeEnabled, isAgentsSurface, TEXT } from "../src/app/agentsNudge"

describe("agents nudge", () => {
  test("defaults display.tui_agents_nudge on unless explicitly disabled", () => {
    expect(agentsNudgeEnabled({ display: { tui_agents_nudge: true } })).toBe(true)
    expect(agentsNudgeEnabled({ display: { tui_agents_nudge: false } })).toBe(false)
    expect(agentsNudgeEnabled({ display: {} })).toBe(true)
    expect(agentsNudgeEnabled({})).toBe(true)
    expect(agentsNudgeEnabled(null)).toBe(true)
  })

  test("fires once for first subagent event and resets on message.start", () => {
    const state = { shown: false }
    const opts = { enabled: true, agentsSurface: false }

    expect(agentsNudge(state, { type: "subagent.start" }, opts)).toBe(true)
    expect(agentsNudge(state, { type: "subagent.spawn_requested" }, opts)).toBe(false)
    expect(agentsNudge(state, { type: "message.start" }, opts)).toBe(false)
    expect(agentsNudge(state, { type: "subagent.spawn_requested" }, opts)).toBe(true)
  })

  test("suppresses when disabled or already on Agents", () => {
    expect(agentsNudge({ shown: false }, { type: "subagent.start" }, { enabled: false, agentsSurface: false })).toBe(false)
    expect(agentsNudge({ shown: false }, { type: "subagent.start" }, { enabled: true, agentsSurface: true })).toBe(false)
  })

  test("uses the Herm-native hint text and Agents surface predicate", () => {
    expect(TEXT).toBe("subagents working · /agents to watch live")
    expect(isAgentsSurface(2, 1, 2, 1)).toBe(true)
    expect(isAgentsSurface(2, 0, 2, 1)).toBe(false)
  })
})
