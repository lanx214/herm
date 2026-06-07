import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until } from "./harness"

describe("PDF attach slash command", () => {
  test("/pdf calls pdf.attach and renders returned page chips", async () => {
    const t = await mount({
      handlers: {
        "pdf.attach": params => ({
          attached: true,
          filename: "paper.pdf",
          pages_attached: 2,
          pages: [
            { path: "/tmp/paper-page-1.png", page: 1, name: "paper.pdf p.1", width: 900, height: 1200, token_estimate: 1500 },
            { path: "/tmp/paper-page-2.png", page: 2, width: 900, height: 1200, token_estimate: 1510 },
          ],
          count: 2,
          text: "[User attached PDF: paper.pdf (2 pages)]",
        }),
      },
    })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/pdf /tmp/paper.pdf") })
    act(() => t.keys.pressEnter())

    await until(t, () => t.gw.last("pdf.attach") !== undefined)
    expect(t.gw.last("pdf.attach")?.params).toMatchObject({ path: "/tmp/paper.pdf" })
    await until(t, () => t.frame().includes("paper.pdf p.1"))
    expect(t.frame()).toContain("paper.pdf p.2")
    expect(t.frame()).toContain("attached paper.pdf · 2 pages")
    t.destroy()
  })

  test("/pdf surfaces gateway failures without adding a chip", async () => {
    const t = await mount({
      handlers: {
        "pdf.attach": () => { throw new Error("pdftoppm not installed (poppler-utils package required)") },
      },
    })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/pdf /tmp/paper.pdf") })
    act(() => t.keys.pressEnter())

    await until(t, () => t.gw.last("pdf.attach") !== undefined)
    await until(t, () => t.frame().includes("pdftoppm not installed"))
    expect(t.frame()).not.toContain("⌫ to detach")
    t.destroy()
  })
})
