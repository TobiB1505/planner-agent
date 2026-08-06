import { describe, expect, it } from "vitest";
import { BackendUrlConfigError, backendRewriteDestination, resolveBackendUrl } from "./backend-url";

describe("resolveBackendUrl", () => {
  it("falls back to localhost when APP_ENV and BACKEND_INTERNAL_URL are both unset (local default)", () => {
    expect(resolveBackendUrl({})).toBe("http://127.0.0.1:8000");
  });

  it("falls back to localhost when APP_ENV=local and BACKEND_INTERNAL_URL is unset", () => {
    expect(resolveBackendUrl({ APP_ENV: "local" })).toBe("http://127.0.0.1:8000");
  });

  it("accepts a valid https URL unchanged", () => {
    expect(
      resolveBackendUrl({ APP_ENV: "production", BACKEND_INTERNAL_URL: "https://backend.example.invalid" }),
    ).toBe("https://backend.example.invalid");
  });

  it("normalizes a trailing slash", () => {
    expect(resolveBackendUrl({ BACKEND_INTERNAL_URL: "https://backend.example.invalid/" })).toBe(
      "https://backend.example.invalid",
    );
  });

  it("normalizes multiple trailing slashes", () => {
    expect(resolveBackendUrl({ BACKEND_INTERNAL_URL: "https://backend.example.invalid///" })).toBe(
      "https://backend.example.invalid",
    );
  });

  it("throws when APP_ENV=production and BACKEND_INTERNAL_URL is missing", () => {
    expect(() => resolveBackendUrl({ APP_ENV: "production" })).toThrow(BackendUrlConfigError);
  });

  it("throws when APP_ENV=preview and BACKEND_INTERNAL_URL is missing", () => {
    expect(() => resolveBackendUrl({ APP_ENV: "preview" })).toThrow(BackendUrlConfigError);
  });

  it("throws on an invalid protocol", () => {
    expect(() =>
      resolveBackendUrl({ APP_ENV: "production", BACKEND_INTERNAL_URL: "ftp://backend.example.invalid" }),
    ).toThrow(BackendUrlConfigError);
  });

  it("throws on a malformed URL", () => {
    expect(() => resolveBackendUrl({ BACKEND_INTERNAL_URL: "not a url" })).toThrow(BackendUrlConfigError);
  });
});

describe("backendRewriteDestination", () => {
  it("appends /api/:path* exactly once", () => {
    expect(backendRewriteDestination({ BACKEND_INTERNAL_URL: "https://backend.example.invalid/" })).toBe(
      "https://backend.example.invalid/api/:path*",
    );
  });

  it("uses the local default when unset", () => {
    expect(backendRewriteDestination({})).toBe("http://127.0.0.1:8000/api/:path*");
  });
});
