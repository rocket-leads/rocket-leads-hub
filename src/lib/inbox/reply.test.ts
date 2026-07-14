import { describe, it, expect } from "vitest"
import { sanitizeWaTemplateParam, resolveWaSessionMessageId } from "./reply"

describe("sanitizeWaTemplateParam", () => {
  it("returns empty input unchanged", () => {
    expect(sanitizeWaTemplateParam("")).toBe("")
  })

  it("flattens paragraph breaks to single space", () => {
    expect(sanitizeWaTemplateParam("First line.\n\nSecond line.")).toBe(
      "First line. Second line.",
    )
  })

  it("inlines bullet lists with ' • '", () => {
    const input = "Header:\n• Item 1\n• Item 2"
    expect(sanitizeWaTemplateParam(input)).toBe("Header: • Item 1 • Item 2")
  })

  it("handles dash and asterisk bullet markers too", () => {
    expect(sanitizeWaTemplateParam("a\n- one\n* two")).toBe("a • one • two")
  })

  it("strips tabs and carriage returns", () => {
    expect(sanitizeWaTemplateParam("a\tb\r\nc")).toBe("a b c")
  })

  it("collapses runs of spaces", () => {
    expect(sanitizeWaTemplateParam("a    b     c")).toBe("a b c")
  })

  it("is idempotent on already-sanitised input", () => {
    const once = sanitizeWaTemplateParam("a\n\nb\n• c")
    expect(sanitizeWaTemplateParam(once)).toBe(once)
  })

  it("flattens a realistic Client Update body to one line", () => {
    const input = [
      "Bram!",
      "",
      "Korte intro tekst.",
      "",
      "📊 KPI block deze week:",
      "• CPL: €11.42",
      "• Spend: €450",
      "",
      "✅ Wat we deze week gaan doen:",
      "• Nieuwe varianten testen",
      "• Doelgroep verfijnen",
    ].join("\n")
    const out = sanitizeWaTemplateParam(input)
    expect(out).not.toMatch(/[\n\r\t]/)
    expect(out).not.toMatch(/ {2,}/)
    expect(out).toContain("Bram!")
    expect(out).toContain("• CPL: €11.42")
    expect(out).toContain("• Nieuwe varianten testen")
  })
})

describe("resolveWaSessionMessageId", () => {
  // The real-world regression: Trengo's wa_sessions success body nests the
  // created message under `message.id`. The phone-template helper used to
  // ignore that key, so a delivered WhatsApp update threw "returned no id -
  // keys: message" and the audit stamp was skipped.
  it("reads the id from a nested message object (the send-error regression)", () => {
    expect(resolveWaSessionMessageId({ message: { id: 987 } })).toBe(987)
  })

  it("reads a top-level message_id", () => {
    expect(resolveWaSessionMessageId({ message_id: "abc" })).toBe("abc")
  })

  it("reads a top-level id", () => {
    expect(resolveWaSessionMessageId({ id: 42 })).toBe(42)
  })

  it("reads a nested data.message_id", () => {
    expect(resolveWaSessionMessageId({ data: { message_id: 7 } })).toBe(7)
  })

  it("returns null when message is an error string (genuine failure)", () => {
    expect(resolveWaSessionMessageId({ message: "The given data was invalid." })).toBeNull()
  })

  it("returns null on an empty body", () => {
    expect(resolveWaSessionMessageId({})).toBeNull()
  })
})
