import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { DiffTabs } from "../src/components/chat/DiffTabs"
import type { ToolPart } from "../src/types/message"

const diff = [
  "--- a/src/foo.ts",
  "+++ b/src/foo.ts",
  "@@ -1,3 +1,3 @@",
  " keep",
  "-old one",
  "+new one",
  "@@ -8,2 +8,2 @@",
  "-old two",
  "+new two",
].join("\n")

const tool: ToolPart = {
  type: "tool", id: "patch-1", name: "patch", args: "",
  preview: "src/foo.ts", status: "done", duration: 5, diff,
}

describe("diff dialog", () => {
  test("opens split panes and sends hunk actions", async () => {
    const t = await mountNode(<DiffTabs tools={[tool]} />, { width: 150, height: 42 })
    await until(t, () => t.frame().includes("open split diff"))
    const rows = t.frame().split("\n")
    const y = rows.findIndex(l => l.includes("open split diff"))
    const x = rows[y].indexOf("open split diff")
    await act(async () => { await t.mouse.pressDown(x, y) })
    await until(t, () => t.frame().includes("old 1,3") && t.frame().includes("new 1,3"))
    expect(t.frame()).toContain("Diff · 1/1 files · 2 hunks")
    expect(t.frame()).toContain("a accept")
    expect(t.frame()).toContain("r reject")

    await act(async () => { t.keys.pressKey("a") })
    await until(t, () => !!t.gw.last("diff.hunk.respond"))
    expect(t.gw.last("diff.hunk.respond")?.params).toMatchObject({
      action: "accept",
      scope: "once",
      hunk_id: "patch-1:src/foo.ts:1:1:0",
      tool_id: "patch-1",
      path: "src/foo.ts",
      old_start: 1,
      new_start: 1,
    })
    expect(String(t.gw.last("diff.hunk.respond")?.params.patch)).toContain("-old one")
    t.destroy()
  })
})
