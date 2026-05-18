import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"
import { readFileSync } from "fs"

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=")
      return [l.slice(0, i), l.slice(i + 1).replace(/^"(.*)"$/, "$1")]
    }),
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data, error } = await supabase
  .from("api_tokens")
  .select("service, token_encrypted")
  .eq("service", "meta")
  .single()

if (error) {
  console.error(error)
  process.exit(1)
}

const [ivHex, tagHex, encryptedHex] = data.token_encrypted.split(":")
const decipher = crypto.createDecipheriv(
  "aes-256-gcm",
  Buffer.from(env.ENCRYPTION_KEY, "hex"),
  Buffer.from(ivHex, "hex"),
)
decipher.setAuthTag(Buffer.from(tagHex, "hex"))
const plaintext = Buffer.concat([
  decipher.update(Buffer.from(encryptedHex, "hex")),
  decipher.final(),
]).toString("utf8")

console.log(plaintext)
