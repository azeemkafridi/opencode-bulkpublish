// What the main process does for a window: hold the key, call the API, read
// attachments from disk. No Electron or opencode imports, so it is unit-tested.
import { BulkPublishClient, send, type PostSummary } from "./api"
import { looksLikeKey, mediaKindOf, mimeFromName, planTargets, type Channel, type Skipped, zonedToUtcIso } from "./core"

export interface KeyStore {
  get(): string | null
  set(key: string | null): void
}

export interface SendRequest {
  content: string
  channelIds: readonly number[]
  file?: string
  mode: "now" | "schedule" | "draft"
  scheduledAt?: string
  timezone?: string
}

/** Largest attachment we read into memory before sending. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024

export interface Deps {
  keys: KeyStore
  base: string
  readFile(path: string): Promise<Uint8Array>
  fileSize(path: string): Promise<number>
  fetch?: typeof fetch
}

export class Service {
  constructor(private d: Deps) {}

  signedIn() {
    return !!this.d.keys.get()
  }

  private client() {
    const key = this.d.keys.get()
    if (!key) throw new Error("Connect your BulkPublish API key first.")
    return new BulkPublishClient(this.d.base, key, this.d.fetch)
  }

  /** Checks the key against the API before keeping it. */
  async setKey(raw: string) {
    const key = raw.trim()
    if (!looksLikeKey(key)) throw new Error("That doesn't look like a BulkPublish API key. Keys start with bp_.")
    await new BulkPublishClient(this.d.base, key, this.d.fetch).channels()
    this.d.keys.set(key)
  }

  signOut() {
    this.d.keys.set(null)
  }

  async channels(): Promise<Channel[]> {
    return this.client().channels()
  }

  async posts(): Promise<PostSummary[]> {
    return this.client().recentPosts(20)
  }

  async retry(id: number) {
    await this.client().retry(id)
  }

  async send(r: SendRequest): Promise<{ id: number; skipped: Skipped[] }> {
    const content = r.content.trim()
    if (!content) throw new Error("Write a caption first.")
    if (!r.channelIds.length) throw new Error("Choose at least one channel.")
    const client = this.client()

    let file: { bytes: Uint8Array; filename: string; mimeType: string } | undefined
    if (r.file) {
      const filename = r.file.split(/[\\/]/).pop() ?? "file"
      const mimeType = mimeFromName(filename)
      if (!mimeType) throw new Error("Attach an image (PNG, JPEG, GIF, WebP) or a video (MP4, MOV, WebM).")
      if ((await this.d.fileSize(r.file)) > MAX_FILE_BYTES) throw new Error("Attach a file under 100 MB.")
      file = { bytes: await this.d.readFile(r.file), filename, mimeType }
    }
    const media = mediaKindOf(file?.mimeType)

    let schedule: { scheduledAt: string; timezone: string } | undefined
    if (r.mode === "schedule") {
      const timezone = r.timezone || "UTC"
      const at = r.scheduledAt ? zonedToUtcIso(r.scheduledAt, timezone) : null
      if (!at) throw new Error("Pick a date and time to schedule for.")
      if (Date.parse(at) <= Date.now()) throw new Error("Pick a time in the future.")
      schedule = { scheduledAt: at, timezone }
    }

    const { targets, skipped } = planTargets(await client.channels(), [...r.channelIds], media)
    if (!targets.length) {
      throw new Error(skipped.map((s) => `${s.name} ${s.reason}.`).join(" ") || "None of those channels can take this post.")
    }
    const id = await send(client, { content, targets, file, media, mode: r.mode, schedule })
    return { id, skipped }
  }
}
