import { memo } from "react"
import { useTheme } from "../theme"
import { useTerminalDimensions } from "@opentui/react"

// Tab-footer hint line. One muted row below panes and above the
// composer; clips instead of wraps.
//
// Input shapes:
//   - `pairs`: structured [key, verb] list, rendered as `[key] verb`
//     separated by 2 spaces. The canonical shape.
//   - `suffix`: optional trailing status fragment appended after pairs
//     with a `  ·  ` separator — for live indicators like "● 3 unsaved"
//     or "● active" that sit alongside key hints but aren't bindings
//     themselves.
//   - `raw`: free-form passthrough. Used where the hint is pure status
//     text (breadcrumb, managed-by label) with no key bindings.
//
// When pairs overflow the terminal width, the tail is dropped (from
// the last pair backwards) so the earliest, most important bindings
// stay readable instead of a mid-string hard clip.

type Pair = readonly [string, string]

/** Approximate display width: East Asian wide/fullwidth chars count 2. */
const dwidth = (s: string): number =>
  [...s].reduce((n, c) => n + (c.codePointAt(0)! > 0x2e7f ? 2 : 1), 0)

export const HintBar = memo((props: { pairs?: readonly Pair[]; suffix?: string; raw?: string }) => {
  const theme = useTheme().theme
  const dims = useTerminalDimensions()
  let text = props.raw ?? ""
  if (props.pairs) {
    const parts = props.pairs.map(p => `[${p[0]}] ${p[1]}`)
    const MORE = "…  [F1] keys"
    const max = Math.max(20, dims.width - 4)
    // Greedy fit from the front (most important first); when a pair
    // can't fit, drop the rest and point at the full key reference
    // instead of a silent mid-string clip.
    text = parts[0] ?? ""
    for (let i = 1; i < parts.length; i++) {
      const cand = `${text}  ${parts[i]}`
      if (dwidth(cand) > max) {
        text += `  ${MORE}`
        break
      }
      text = cand
    }
    if (props.suffix) text += `  ·  ${props.suffix}`
  }
  return (
    <box height={1} flexShrink={0} paddingX={1} overflow="hidden">
      <text fg={theme.textMuted} wrapMode="none">{text}</text>
    </box>
  )
})
