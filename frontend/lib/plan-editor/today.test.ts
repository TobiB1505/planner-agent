import { describe, expect, it } from "vitest";
import { todayIso } from "./today";

describe("todayIso", () => {
  it("liefert ein ISO-Datum (YYYY-MM-DD)", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("stimmt mit dem lokalen Kalendertag überein", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    expect(todayIso()).toBe(expected);
  });
});
