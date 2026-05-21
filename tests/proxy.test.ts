import { describe, expect, it } from "bun:test";

import { __test__ } from "../src/lib/proxy.js";

describe("proxy helpers", () => {
  describe("stripSessionIdFromPath", () => {
    it("extracts sessionId + remainder", () => {
      expect(__test__.stripSessionIdFromPath("/plan/abc-123/api/plan")).toEqual(
        {
          sessionId: "abc-123",
          remainder: "/api/plan",
        },
      );
    });

    it("defaults remainder to /", () => {
      expect(__test__.stripSessionIdFromPath("/plan/abc")).toEqual({
        sessionId: "abc",
        remainder: "/",
      });
    });

    it("returns null sessionId for /plan", () => {
      expect(__test__.stripSessionIdFromPath("/plan")).toEqual({
        sessionId: null,
        remainder: "/plan",
      });
    });
  });

  describe("timingSafeEqual", () => {
    it("returns true for equal strings", () => {
      expect(__test__.timingSafeEqual("abcdef", "abcdef")).toBe(true);
    });

    it("returns false for unequal strings", () => {
      expect(__test__.timingSafeEqual("abcdef", "abcdee")).toBe(false);
    });

    it("returns false for different lengths", () => {
      expect(__test__.timingSafeEqual("abc", "abcd")).toBe(false);
    });
  });
});
