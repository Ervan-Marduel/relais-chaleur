import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Chiffrement applicatif des pièces jointes sensibles (scans de bons signés, photos de constat).
 * AES-256-GCM, clé de 32 octets en base64 dans FILE_ENCRYPTION_KEY (générer : openssl rand -base64 32).
 * Format stocké : iv (12 o) ‖ tag (16 o) ‖ chiffré. Colonne `encryption` = "aes-256-gcm:v1".
 * Sans clé : stockage en clair dans PostgreSQL (chiffré au repos par l'hébergeur) et l'admin le signale.
 * La perte de la clé rend les fichiers illisibles : la conserver dans le gestionnaire de secrets de l'entreprise.
 */
export const ENCRYPTION_TAG = "aes-256-gcm:v1";

function key(): Buffer | null {
  const raw = process.env.FILE_ENCRYPTION_KEY;
  if (!raw) return null;
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("FILE_ENCRYPTION_KEY doit faire 32 octets (base64)");
  return k;
}

export function fileEncryptionEnabled() {
  try {
    return key() !== null;
  } catch {
    return false;
  }
}

export function encryptFile(plain: Buffer): { content: Buffer; encryption: string | null } {
  const k = key();
  if (!k) return { content: plain, encryption: null };
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return { content: Buffer.concat([iv, c.getAuthTag(), body]), encryption: ENCRYPTION_TAG };
}

export function decryptFile(stored: Buffer, encryption: string | null): Buffer {
  if (!encryption) return stored;
  if (encryption !== ENCRYPTION_TAG) throw new Error(`Format de chiffrement inconnu : ${encryption}`);
  const k = key();
  if (!k) throw new Error("Fichier chiffré : FILE_ENCRYPTION_KEY absente");
  const d = createDecipheriv("aes-256-gcm", k, stored.subarray(0, 12));
  d.setAuthTag(stored.subarray(12, 28));
  return Buffer.concat([d.update(stored.subarray(28)), d.final()]);
}
