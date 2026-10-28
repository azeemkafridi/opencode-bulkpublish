// Runs only with BP_API_URL and BP_TEST_KEY set, against a real BulkPublish app:
//   BP_API_URL=http://localhost:4322 BP_TEST_KEY=bp_… npm test
// It saves a draft and schedules a post far in the future, then deletes both.
// Nothing is published.
import { readFile, stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { BulkPublishClient } from "../src/lib/api"
import { normalizeApiBase } from "../src/lib/core"
import { Service } from "../src/lib/service"

const base = process.env.BP_API_URL
const key = process.env.BP_TEST_KEY

describe.skipIf(!base || !key)("live API", () => {
  let stored: string | null = null
  const service = new Service({
    keys: { get: () => stored, set: (k) => void (stored = k) },
    base: normalizeApiBase(base),
    readFile: async (p) => new Uint8Array(await readFile(p)),
    fileSize: async (p) => (await stat(p)).size,
  })
  const client = () => new BulkPublishClient(normalizeApiBase(base), key!)

  it("connects, lists, drafts, schedules with an image, lists, cleans up", async () => {
    await service.setKey(key!)
    const channels = await service.channels()
    expect(channels.length).toBeGreaterThan(0)
    const x = channels.find((c) => c.usable && c.platform !== "x") ?? channels.find((c) => c.usable)
    expect(x).toBeTruthy()

    const made: number[] = []
    const draft = await service.send({ content: "opencode plugin live test (draft)", channelIds: [x!.id], mode: "draft" })
    made.push(draft.id)
      try {
      const later = await service.send({
        content: "opencode plugin live test (scheduled)",
        channelIds: [x!.id],
        file: fileURLToPath(new URL("./fixtures/pixel.png", import.meta.url)),
        mode: "schedule",
        scheduledAt: "2099-06-01T09:00",
        timezone: "UTC",
      })
    made.push(later.id)
      const posts = await service.posts()
      const byId = new Map(posts.map((p) => [p.id, p]))
      expect(byId.get(draft.id)?.status).toBe("draft")
      expect(byId.get(later.id)?.status).toBe("scheduled")
      expect(byId.get(later.id)?.scheduledAt).toMatch(/^2099-06-01T09:00/)
      // Retry is for failed posts; on a draft the API refuses, and the refusal reads as a sentence.
      await expect(service.retry(draft.id)).rejects.toThrow(/\w+ \w+/)
    } finally {
      for (const id of made) await client().deletePost(id).catch(() => {})
    }
  }, 60_000)
})
