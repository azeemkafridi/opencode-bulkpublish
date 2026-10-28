// Main process: keeps the API key (encrypted with the system keychain when it
// can be) and makes every request to BulkPublish for the windows.
import { safeStorage } from "electron"
import { readFile, stat } from "node:fs/promises"
import { Schema } from "effect"
import type { Plugin } from "@opencode/plugin/gui"
import { normalizeApiBase } from "../lib/core"
import { Service, type KeyStore } from "../lib/service"
import { BulkPublish } from "./contract"

export const main: Plugin.MainSetup = (ctx) => {
  const stored = ctx.storage.store("apiKey", {
    schema: Schema.Struct({ value: Schema.String, encrypted: Schema.Boolean }),
    initial: { value: "", encrypted: false },
  })
  const keys: KeyStore = {
    get() {
      const { value, encrypted } = stored.value
      if (!value) return null
      try {
        return encrypted ? safeStorage.decryptString(Buffer.from(value, "base64")) : value
      } catch {
        return null
      }
    },
    set(key) {
      if (!key) return stored.set({ value: "", encrypted: false })
      const encrypted = safeStorage.isEncryptionAvailable()
      stored.set({
        value: encrypted ? safeStorage.encryptString(key).toString("base64") : key,
        encrypted,
      })
    },
  }

  const service = new Service({
    keys,
    base: normalizeApiBase(ctx.options.apiBase),
    readFile: async (p) => new Uint8Array(await readFile(p)),
    fileSize: async (p) => (await stat(p)).size,
  })

  const provider = ctx.provide(BulkPublish, {
    state: () => ({ signedIn: service.signedIn() }),
    setKey: async (key) => {
      await service.setKey(key)
      provider.changed()
    },
    signOut: () => {
      service.signOut()
      provider.changed()
    },
    channels: () => service.channels(),
    posts: () => service.posts(),
    send: (input) => service.send(input),
    retry: (id) => service.retry(id),
  })
}
