import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The published build has no backend to find.
 *
 * Left alone it probes /api/health, /api/device, and /api/models twelve times
 * over fourteen seconds — requests that can only 404 on a static host — and
 * then reports that a local server is stopped, to a visitor who never started
 * one. Both halves are pinned here: no request may be made, and the message may
 * not describe a server the reader does not have.
 */

const ORIGINAL = import.meta.env.VITE_PUBLIC_BUILD;

async function loadClient() {
  vi.resetModules();
  return import("../src/api/inferenceClient");
}

describe("browser-only build", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error("no network in this test")));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    import.meta.env.VITE_PUBLIC_BUILD = ORIGINAL;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("makes no request at all when the build knows there is no backend", async () => {
    import.meta.env.VITE_PUBLIC_BUILD = "1";
    const { detectLocalBackend } = await loadClient();

    const connection = await detectLocalBackend();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connection.state).toBe("browser");
  });

  it("reports a reason that stops the retry schedule", async () => {
    // useBackendConnection retries only while the reason is "unreachable", so
    // a distinct reason is what prevents twelve doomed probes.
    import.meta.env.VITE_PUBLIC_BUILD = "1";
    const { detectLocalBackend } = await loadClient();

    const connection = await detectLocalBackend();

    expect(connection).toMatchObject({ state: "browser", reason: "browser-only" });
  });

  it("does not tell a visitor that a server they never ran has stopped", async () => {
    import.meta.env.VITE_PUBLIC_BUILD = "1";
    const { detectLocalBackend } = await loadClient();

    const connection = await detectLocalBackend();
    const message = connection.state === "browser" ? connection.message : "";

    expect(message).not.toContain("停止");
    expect(message).not.toContain("ローカルAIサーバー");
    expect(message).toContain("ブラウザ");
  });

  it("still probes, and still explains a stopped server, in a normal build", async () => {
    // The local Docker and native setups depend on this: a user who forgot to
    // start the backend is told exactly that.
    import.meta.env.VITE_PUBLIC_BUILD = "";
    const { detectLocalBackend } = await loadClient();

    const connection = await detectLocalBackend();

    expect(fetchSpy).toHaveBeenCalled();
    expect(connection).toMatchObject({ state: "browser", reason: "unreachable" });
    const message = connection.state === "browser" ? connection.message : "";
    expect(message).toContain("ローカルAIサーバー");
  });
});
