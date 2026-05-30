import { describe, expect, test } from "bun:test"
import { Idle } from "../src/app/idle"

class Renderer {
  currentControlState = "auto_started"
  isDestroyed = false
  suspends = 0
  resumes = 0
  inputs: Array<(seq: string) => boolean> = []

  suspend() { this.suspends++ }
  resume() { this.resumes++ }
  prependInputHandler(fn: (seq: string) => boolean) { this.inputs.unshift(fn) }
  removeInputHandler(fn: (seq: string) => boolean) {
    this.inputs = this.inputs.filter(x => x !== fn)
  }
  write(seq: string) { this.inputs.forEach(fn => fn(seq)) }
}

describe("Idle", () => {
  test("suspends after idle timeout", async () => {
    const r = new Renderer()
    const idle = new Idle(r, { ms: 100 })

    idle.start()
    await Bun.sleep(110)

    expect(r.suspends).toBe(1)
    expect(r.resumes).toBe(0)
    idle.stop()
  })

  test("keyboard activity resumes before callers continue", async () => {
    const r = new Renderer()
    const idle = new Idle(r, { ms: 100 })

    idle.start()
    await Bun.sleep(110)
    r.write("a")

    expect(r.suspends).toBe(1)
    expect(r.resumes).toBe(1)
    idle.stop()
  })

  test("mouse activity resumes before target handlers run", async () => {
    const r = new Renderer()
    const order: string[] = []
    const idle = new Idle(r, { ms: 100 })

    idle.start()
    r.inputs.push(() => { order.push(r.resumes === 1 ? "resumed" : "suspended"); return false })
    await Bun.sleep(110)
    r.write("\x1B[<0;1;1M")

    expect(r.suspends).toBe(1)
    expect(r.resumes).toBe(1)
    expect(order).toEqual(["resumed"])
    idle.stop()
  })

  test("activity postpones suspend", async () => {
    const r = new Renderer()
    const idle = new Idle(r, { ms: 100 })

    idle.start()
    await Bun.sleep(60)
    r.write("a")
    await Bun.sleep(60)
    expect(r.suspends).toBe(0)
    await Bun.sleep(55)
    expect(r.suspends).toBe(1)
    idle.stop()
  })

  test("stop cleans timer and resumes if suspended", async () => {
    const r = new Renderer()
    const idle = new Idle(r, { ms: 100 })

    idle.start()
    await Bun.sleep(110)
    idle.stop()
    await Bun.sleep(110)

    expect(r.suspends).toBe(1)
    expect(r.resumes).toBe(1)
  })

  test("shutdown prevents suspend and resume", async () => {
    const r = new Renderer()
    const idle = new Idle(r, { ms: 100 })

    idle.start()
    idle.shutdown()
    await Bun.sleep(110)
    r.write("a")

    expect(r.suspends).toBe(0)
    expect(r.resumes).toBe(0)
  })
})
