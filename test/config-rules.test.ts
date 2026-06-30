import { describe, expect, test } from "bun:test"
import { check, RULES } from "../src/config/rules"
import { SCHEMA } from "../src/config/schema"

describe("rules", () => {
  test("every rule key exists in schema", () => {
    const missing = Object.keys(RULES).filter(k => !SCHEMA[k])
    expect(missing).toEqual([])
  })

  test("every rule accepts its schema default", () => {
    for (const k of Object.keys(RULES)) {
      const def = SCHEMA[k].default
      const msg = check(k, String(def ?? ""))
      expect(msg, `${k} default '${def}' rejected: ${msg}`).toBeNull()
    }
  })

  test("int bounds reject out-of-range and non-integer", () => {
    expect(check("agent.max_turns", "0")).toMatch(/expected/)
    expect(check("agent.max_turns", "1")).toBeNull()
    expect(check("agent.max_turns", "90")).toBeNull()
    expect(check("agent.max_turns", "3.5")).toMatch(/integer/)
    expect(check("agent.max_turns", "abc")).toMatch(/integer/)
  })

  test("float bounds", () => {
    expect(check("compression.threshold", "0.5")).toBeNull()
    expect(check("compression.threshold", "0.05")).toMatch(/expected/)
    expect(check("compression.threshold", "0.99")).toMatch(/expected/)
    expect(check("compression.threshold", "nope")).toMatch(/number/)
  })

  test("oneOf enums", () => {
    expect(check("display.busy_input_mode", "queue")).toBeNull()
    expect(check("display.busy_input_mode", "panic")).toMatch(/one of/)
    expect(check("logging.level", "DEBUG")).toBeNull()
    expect(check("logging.level", "TRACE")).toMatch(/one of/)
  })

  test("nonNeg accepts 0", () => {
    expect(check("agent.gateway_timeout", "0")).toBeNull()
    expect(check("agent.gateway_timeout", "-1")).toMatch(/≥/)
  })

  test("delegation child timeout accepts upstream no-timeout default", () => {
    expect(check("delegation.child_timeout_seconds", "0")).toBeNull()
    expect(check("delegation.child_timeout_seconds", "30")).toBeNull()
    expect(check("delegation.child_timeout_seconds", "-1")).toMatch(/≥/)
  })

  test("duration pattern", () => {
    expect(check("prompt_caching.cache_ttl", "5m")).toBeNull()
    expect(check("prompt_caching.cache_ttl", "2h")).toBeNull()
    expect(check("prompt_caching.cache_ttl", "5")).toMatch(/duration/)
  })

  test("unknown key passes", () => {
    expect(check("nonexistent.key", "anything")).toBeNull()
  })
})
