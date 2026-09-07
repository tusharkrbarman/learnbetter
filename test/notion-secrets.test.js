const assert = require("node:assert/strict");
const test = require("node:test");

const {
  decryptNotionSecrets,
  encryptNotionSecrets,
  migrateNotionSecrets,
  readNotionSettings,
  splitNotionSecrets
} = require("../src/main/notion-secrets");

const availableStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`encrypted:${text}`),
  decryptString: (buffer) => buffer.toString().replace(/^encrypted:/, "")
};

test("removes Notion secrets from settings stored as JSON", () => {
  const { settings, secrets } = splitNotionSecrets({
    notionToken: "secret_token",
    notionOAuthClientSecret: "client_secret",
    notionOAuthRefreshToken: "refresh_token",
    notionPageId: "page-id"
  });

  assert.deepEqual(settings, { notionPageId: "page-id" });
  assert.deepEqual(secrets, {
    notionToken: "secret_token",
    notionOAuthClientSecret: "client_secret",
    notionOAuthRefreshToken: "refresh_token"
  });
});

test("recovers encrypted Notion secrets", () => {
  const secrets = {
    notionToken: "secret_token",
    notionOAuthClientSecret: "client_secret",
    notionOAuthRefreshToken: "refresh_token"
  };

  const encrypted = encryptNotionSecrets(secrets, availableStorage);

  assert.deepEqual(decryptNotionSecrets(encrypted, availableStorage), secrets);
});

test("refuses to persist secrets when operating-system encryption is unavailable", () => {
  assert.throws(
    () => encryptNotionSecrets({ notionToken: "secret_token" }, { isEncryptionAvailable: () => false }),
    /Windows credential encryption is unavailable/
  );
});

test("migrates legacy plaintext credentials without changing other stored data", () => {
  const migrated = migrateNotionSecrets({
    settings: {
      notionToken: "secret_token",
      notionPageId: "page-id"
    },
    highlights: [{ hash: "highlight-1" }]
  }, availableStorage);

  assert.deepEqual(migrated.settings, { notionPageId: "page-id" });
  assert.deepEqual(migrated.highlights, [{ hash: "highlight-1" }]);
  assert.equal(JSON.stringify(migrated).includes("secret_token"), false);
  assert.equal(decryptNotionSecrets(migrated.notionSecrets, availableStorage).notionToken, "secret_token");
});

test("returns reconnect guidance instead of exposing corrupt saved credentials", () => {
  const result = readNotionSettings(
    { notionPageId: "page-id" },
    "corrupt-ciphertext",
    {
      isEncryptionAvailable: () => true,
      decryptString: () => { throw new Error("decrypt failed"); }
    }
  );

  assert.equal(result.settings.notionToken, "");
  assert.match(result.error, /reconnect Notion/i);
});
