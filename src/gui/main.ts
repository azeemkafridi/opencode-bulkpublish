// Main process: keeps the API key (encrypted with the system keychain when it
// can be) and makes every request to BulkPublish for the windows.
import { safeStorage } from "electron"
import { readFile, stat } from "node:fs/promises"
import { Schema } from "effect"
import type { Plugin } from "@opencode/plugin/gui"
import { allowedApiBase, Service, type KeyStore } from "../lib/service"
import { BulkPublish } from "./contract"

export const main: Plugin.MainSetup = (ctx) => {
  const base = allowedApiBase(ctx.options.apiBase)
  const stored = ctx.storage.store("apiKey", {
    schema: Schema.Struct({ value: Schema.String, encrypted: Schema.Boolean, base: Schema.optional(Schema.String) }),
    initial: { value: "", encrypted: false },
  })
  const keys: KeyStore = {
    get() {
      const { value, encrypted, base: keptFor } = stored.value
      // A key is only ever sent to the address it was checked against.
      if (!value || keptFor !== base) return null
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
        base,
      })
    },
  }

  const service = new Service({
    keys,
    base,
    readFile: async (p) => new Uint8Array(await readFile(p)),
    fileSize: async (p) => (await stat(p)).size,
  })

  // Bumped whenever the key changes, so open views reload for the new account.
  let account = 1
  const provider = ctx.provide(BulkPublish, {
    state: () => ({ signedIn: service.signedIn(), account }),
    setKey: async (key) => {
      await service.setKey(key)
      account++
      provider.changed()
    },
    signOut: () => {
      service.signOut()
      account++
      provider.changed()
    },
    channels: () => service.channels(),
    posts: () => service.posts(),
    send: (input) => service.send(input),
    retry: (id) => service.retry(id),
  })
}
