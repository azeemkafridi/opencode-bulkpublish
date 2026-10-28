import { describe, expect, it } from "vitest"
import { Service, type KeyStore } from "../src/lib/service"
import { canRetry, statusLabel } from "../src/lib/view"

const KEY = "bp_abcdefghijklmnop1234"

function setup(routes: Record<string, (body: any) => [number, unknown]>, key: string | null = KEY) {
  let stored = key
  const calls: { key: string; body: any; auth: string | null }[] = []
  const keys: KeyStore = { get: () => stored, set: (k) => void (stored = k) }
  const fetch = (async (url: string, init: RequestInit) => {
    const k = `${init.method} ${new URL(url).pathname}`
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body
    calls.push({ key: k, body, auth: new Headers(init.headers).get("authorization") })
    const [status, out] = (routes[k] ?? (() => [404, { error: "nope" }]))(body)
    return new Response(JSON.stringify(out), { status })
  }) as typeof globalThis.fetch
  const files: Record<string, Uint8Array> = { "/tmp/a.png": new Uint8Array([1, 2, 3]), "/tmp/a.txt": new Uint8Array([1]) }
  const service = new Service({
    keys,
    base: "https://app.example.com",
    fetch,
    readFile: async (p) => files[p],
    fileSize: async (p) => files[p].length,
  })
  return { service, calls, stored: () => stored }
}

const channels = {
  channels: [
    { id: 1, platform: "x", accountName: "me" },
    { id: 2, platform: "instagram", accountName: "gram" },
    { id: 3, platform: "linkedin", accountName: "li", needsReconnect: true },
  ],
}

describe("key", () => {
  it("checks a key against the API before keeping it", async () => {
    const t = setup({ "GET /api/channels": () => [200, channels] }, null)
    expect(t.service.signedIn()).toBe(false)
    await t.service.setKey(`  ${KEY} `)
    expect(t.stored()).toBe(KEY)
    expect(t.calls[0].auth).toBe(`Bearer ${KEY}`)
    t.service.signOut()
    expect(t.service.signedIn()).toBe(false)
  })

  it("refuses a malformed key without a request, and a rejected key without keeping it", async () => {
    const t = setup({ "GET /api/channels": () => [401, { error: "bad" }] }, null)
    await expect(t.service.setKey("nope")).rejects.toThrow(/bp_/)
    expect(t.calls).toHaveLength(0)
    await expect(t.service.setKey(KEY)).rejects.toThrow(/didn't accept/)
    expect(t.stored()).toBeNull()
  })

  it("asks to connect before any call", async () => {
    await expect(setup({}, null).service.channels()).rejects.toThrow(/Connect/)
  })
})

describe("send", () => {
  const ok = {
    "GET /api/channels": () => [200, channels] as [number, unknown],
    "POST /api/posts": () => [200, { id: 77 }] as [number, unknown],
    "POST /api/posts/77/publish": () => [200, {}] as [number, unknown],
    "POST /api/media": () => [200, { file: { id: 9 } }] as [number, unknown],
  }

  it("publishes now to usable channels and reports the skipped ones", async () => {
    const t = setup(ok)
    const r = await t.service.send({ content: "hi", channelIds: [1, 2, 3], mode: "now" })
    expect(r.id).toBe(77)
    expect(r.skipped.map((s) => s.name)).toEqual(["gram", "li"])
    const post = t.calls.find((c) => c.key === "POST /api/posts")!.body
    expect(post.status).toBe("draft")
    expect(post.channels).toEqual([{ channelId: 1, platform: "x" }])
    expect(t.calls.map((c) => c.key)).toContain("POST /api/posts/77/publish")
  })

  it("uploads an attachment read from disk and sends it with the post", async () => {
    const t = setup(ok)
    await t.service.send({ content: "pic", channelIds: [1, 2], file: "/tmp/a.png", mode: "draft" })
    const post = t.calls.find((c) => c.key === "POST /api/posts")!.body
    expect(post.mediaFiles).toEqual([9])
    expect(post.channels.map((c: any) => c.platform)).toEqual(["x", "instagram"])
    expect(t.calls.map((c) => c.key)).not.toContain("POST /api/posts/77/publish")
  })

  it("schedules in the given zone and refuses a past or missing time", async () => {
    const t = setup(ok)
    await t.service.send({ content: "later", channelIds: [1], mode: "schedule", scheduledAt: "2099-01-02T09:30", timezone: "Asia/Karachi" })
    const post = t.calls.find((c) => c.key === "POST /api/posts")!.body
    expect(post).toMatchObject({ status: "scheduled", scheduledAt: "2099-01-02T04:30:00.000Z", timezone: "Asia/Karachi" })
    await expect(t.service.send({ content: "x", channelIds: [1], mode: "schedule" })).rejects.toThrow(/date/)
    await expect(t.service.send({ content: "x", channelIds: [1], mode: "schedule", scheduledAt: "2001-01-01T00:00", timezone: "UTC" })).rejects.toThrow(/future/)
  })

  it("refuses empty input, unsupported files, and a post no channel can take", async () => {
    const t = setup(ok)
    await expect(t.service.send({ content: " ", channelIds: [1], mode: "draft" })).rejects.toThrow(/caption/)
    await expect(t.service.send({ content: "a", channelIds: [], mode: "draft" })).rejects.toThrow(/channel/)
    await expect(t.service.send({ content: "a", channelIds: [1], file: "/tmp/a.txt", mode: "draft" })).rejects.toThrow(/image/)
    await expect(t.service.send({ content: "a", channelIds: [2], mode: "draft" })).rejects.toThrow(/gram needs/)
    expect(t.calls.map((c) => c.key)).not.toContain("POST /api/posts")
  })
})

describe("posts list", () => {
  it("retries with POST /retry", async () => {
    const t = setup({ "POST /api/posts/5/retry": () => [200, {}] })
    await t.service.retry(5)
    expect(t.calls[0].key).toBe("POST /api/posts/5/retry")
  })

  it("labels every status and offers retry only for failed or partial", () => {
    expect(statusLabel("partial")).toBe("Partly published")
    expect(statusLabel("processing")).toBe("Processing")
    expect(statusLabel("some_new")).toBe("Some new")
    expect(["failed", "partial", "published", "processing"].filter(canRetry)).toEqual(["failed", "partial"])
  })
})
