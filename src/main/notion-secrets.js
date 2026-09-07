const SECRET_KEYS = [
  "notionToken",
  "notionOAuthClientSecret",
  "notionOAuthRefreshToken"
];

function normalizeSecrets(secrets = {}) {
  return Object.fromEntries(SECRET_KEYS.map((key) => [key, String(secrets[key] || "")]));
}

function splitNotionSecrets(settings = {}) {
  const plainSettings = { ...settings };
  const secrets = normalizeSecrets(plainSettings);

  for (const key of SECRET_KEYS) {
    delete plainSettings[key];
  }

  return { settings: plainSettings, secrets };
}

function encryptNotionSecrets(secrets, safeStorage) {
  const normalized = normalizeSecrets(secrets);
  if (!Object.values(normalized).some(Boolean)) {
    return "";
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows credential encryption is unavailable. Notion credentials were not saved.");
  }

  return safeStorage.encryptString(JSON.stringify(normalized)).toString("base64");
}

function decryptNotionSecrets(encrypted, safeStorage) {
  if (!encrypted) {
    return normalizeSecrets();
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows credential encryption is unavailable.");
  }

  const decrypted = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  return normalizeSecrets(JSON.parse(decrypted));
}

function migrateNotionSecrets(snapshot = {}, safeStorage) {
  const { settings, secrets } = splitNotionSecrets(snapshot.settings);
  const migrated = { ...snapshot, settings };

  if (Object.values(secrets).some(Boolean)) {
    migrated.notionSecrets = encryptNotionSecrets(secrets, safeStorage);
  }

  return migrated;
}

function readNotionSettings(settings = {}, encrypted, safeStorage) {
  try {
    return {
      settings: { ...settings, ...decryptNotionSecrets(encrypted, safeStorage) },
      error: ""
    };
  } catch {
    return {
      settings: { ...settings, ...normalizeSecrets() },
      error: "Saved Notion credentials could not be decrypted. Reconnect Notion."
    };
  }
}

module.exports = {
  decryptNotionSecrets,
  encryptNotionSecrets,
  migrateNotionSecrets,
  readNotionSettings,
  splitNotionSecrets
};
