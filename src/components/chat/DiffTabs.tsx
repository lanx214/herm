import { memo, useMemo, useState } from "react"
import type { MouseEvent } from "@opentui/core"
import type { ToolPart } from "../../types/message"
import { LEFT_BAR } from "../../ui/borders"
import { DiffBlock } from "./DiffBlock"
import { useTheme } from "../../theme"
import { useDialog } from "../../ui/dialog"
import { files } from "./diff-model"
import { openDiff } from "../../dialogs/diff"

export const DiffTabs = memo(({ tools }: { tools: ToolPart[] }) => {
  const theme = useTheme().theme
  const dialog = useDialog()
  const tabs = useMemo(() => files(tools), [tools])
  const [active, setActive] = useState(0)
  if (tabs.length === 0) return null
  const cur = tabs[Math.min(active, tabs.length - 1)]

  return (
    <box
      flexDirection="column" marginTop={1}
      border={["left"]} borderColor={theme.border} customBorderChars={LEFT_BAR}
      backgroundColor={theme.backgroundPanel} paddingLeft={1}
    >
      <box
        flexDirection="row" flexWrap="wrap"
        backgroundColor={theme.backgroundElement} paddingX={1}
      >
        {tabs.map((t, i) => {
          const on = i === active
          return (
            <box
              key={t.id} height={1} flexShrink={0} marginRight={1} paddingX={1}
              backgroundColor={on ? theme.backgroundPanel : undefined}
              onMouseDown={(e: MouseEvent) => { e.stopPropagation(); setActive(i) }}
            >
              <text fg={on ? theme.primary : theme.textMuted}>
                {on ? <strong>{t.label}</strong> : t.label}
              </text>
            </box>
          )
        })}
      </box>
      <box height={1} paddingX={1} flexDirection="row">
        <box height={1} paddingX={1} backgroundColor={theme.backgroundElement}
             onMouseDown={(e: MouseEvent) => { e.stopPropagation(); openDiff(dialog, tabs, active) }}>
          <text fg={theme.primary}>open split diff</text>
        </box>
        <box width={1} />
        <text>
          <span fg={theme.success}>+{cur.add}</span>
          <span fg={theme.textMuted}> / </span>
          <span fg={theme.error}>-{cur.del}</span>
          <span fg={theme.textMuted}>{` · ${cur.hunks.length} hunks`}</span>
        </text>
      </box>
      <box paddingX={1} paddingBottom={1}>
        <DiffBlock text={cur.diff} />
      </box>
    </box>
  )
})
