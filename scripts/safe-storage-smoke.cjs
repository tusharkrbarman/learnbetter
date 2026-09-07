const assert = require("node:assert/strict");
const { app, safeStorage } = require("electron");
const { decryptNotionSecrets, encryptNotionSecrets } = require("../src/main/notion-secrets");

app.whenReady().then(() => {
  assert.equal(safeStorage.isEncryptionAvailable(), true);
  const secrets = {
    notionToken: "learnbetter-smoke-test",
    notionOAuthClientSecret: "",
    notionOAuthRefreshToken: ""
  };
  const encrypted = encryptNotionSecrets(secrets, safeStorage);
  assert.equal(encrypted.includes(secrets.notionToken), false);
  assert.deepEqual(decryptNotionSecrets(encrypted, safeStorage), secrets);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
