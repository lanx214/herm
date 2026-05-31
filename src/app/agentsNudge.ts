import type { GatewayEvent } from "../context/wire"

export const TEXT = "subagents working · /agents to watch live"

export type AgentsNudgeConfig = {
  display?: {
    tui_agents_nudge?: boolean
  }
}

export type AgentsNudgeState = {
  shown: boolean
}

export function agentsNudgeEnabled(cfg: AgentsNudgeConfig | null | undefined): boolean {
  return cfg?.display?.tui_agents_nudge === true
}

export function isAgentsSurface(tab: number, sub: number, agentsTab: number, agentsSub: number): boolean {
  return tab === agentsTab && sub === agentsSub
}

export function agentsNudge(
  state: AgentsNudgeState,
  ev: Pick<GatewayEvent, "type">,
  opts: { enabled: boolean; agentsSurface: boolean },
): boolean {
  if (ev.type === "message.start") state.shown = false
  if (ev.type !== "subagent.start" && ev.type !== "subagent.spawn_requested") return false
  if (!opts.enabled || opts.agentsSurface || state.shown) return false
  state.shown = true
  return true
}
