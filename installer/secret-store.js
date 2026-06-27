const { app, safeStorage } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

async function saveApiKey(rawSettings = {}) {
  const apiKey = String(rawSettings.apiKey || "").trim();
  if (!apiKey) return { saved: false, available: safeStorage.isEncryptionAvailable() };

  if (!safeStorage.isEncryptionAvailable()) {
    return {
      saved: false,
      available: false,
      warning: "OS encryption is not available; API key was not persisted.",
    };
  }

  const secrets = await readSecretsFile();
  secrets[secretId(rawSettings)] = {
    provider: String(rawSettings.cloudProvider || "openrouter"),
    installPath: String(rawSettings.installPath || ""),
    encrypted: safeStorage.encryptString(apiKey).toString("base64"),
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(secretsPath()), { recursive: true });
  await fs.writeFile(secretsPath(), `${JSON.stringify(secrets, null, 2)}\n`, "utf8");

  return { saved: true, available: true };
}

async function readApiKey(rawSettings = {}) {
  if (!safeStorage.isEncryptionAvailable()) return "";

  const secrets = await readSecretsFile();
  const entry = secrets[secretId(rawSettings)];
  if (!entry?.encrypted) return "";

  try {
    return safeStorage.decryptString(Buffer.from(entry.encrypted, "base64"));
  } catch {
    return "";
  }
}

async function getSecretStatus(rawSettings = {}) {
  const secrets = await readSecretsFile();
  const entry = secrets[secretId(rawSettings)];
  return {
    available: safeStorage.isEncryptionAvailable(),
    hasStoredApiKey: Boolean(entry?.encrypted),
    updatedAt: entry?.updatedAt ?? null,
  };
}

async function readSecretsFile() {
  try {
    return JSON.parse(await fs.readFile(secretsPath(), "utf8"));
  } catch {
    return {};
  }
}

function secretsPath() {
  return path.join(app.getPath("userData"), "secrets.json");
}

function secretId(rawSettings = {}) {
  const provider = String(rawSettings.cloudProvider || "openrouter").trim();
  const installPath = path.resolve(String(rawSettings.installPath || "")).toLowerCase();
  return crypto
    .createHash("sha256")
    .update(`${provider}:${installPath}`)
    .digest("hex");
}

module.exports = {
  getSecretStatus,
  readApiKey,
  saveApiKey,
};
