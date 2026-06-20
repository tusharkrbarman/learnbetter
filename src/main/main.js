const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const http = require("node:http");
const Store = require("electron-store");
const { Client: NotionClient } = require("@notionhq/client");
const OpenAI = require("openai");

const APP_NAME = "LearnBetter";
const APP_ID = "com.tusharkrbarman.learnbetter";
const APP_ICON = path.join(__dirname, "../../assets/icons/icon.png");
const DEFAULT_NOTION_REDIRECT_URI = "http://127.0.0.1:45891/notion/callback";

const store = new Store({
  name: "learnbetter",
  defaults: {
    settings: {
      notionAuthMode: "token",
      notionToken: "",
      notionPageId: "",
      notionPageInput: "",
      notionOAuthClientId: "",
      notionOAuthClientSecret: "",
      notionOAuthRedirectUri: DEFAULT_NOTION_REDIRECT_URI,
      notionOAuthRefreshToken: "",
      notionOAuthBotId: "",
      notionOAuthWorkspaceName: "",
      aiProvider: "openai",
      openaiApiKey: "",
      openaiModel: "gpt-4o-mini",
      ollamaBaseUrl: "http://localhost:11434",
      ollamaModel: "llama3.1:8b",
      bookTitle: ""
    },
    highlights: [],
    queue: [],
    deleteQueue: []
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: APP_NAME,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  app.setName(APP_NAME);
  app.setAppUserModelId(APP_ID);
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: "Copyright (c) 2026 Tushar Barman",
    iconPath: APP_ICON
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function normalizeNotionPageId(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return "";
  }

  const compact = raw.replace(/-/g, "");
  const match = compact.match(/[0-9a-fA-F]{32}/);
  if (!match) {
    return "";
  }

  const id = match[0].toLowerCase();
  return [
    id.slice(0, 8),
    id.slice(8, 12),
    id.slice(12, 16),
    id.slice(16, 20),
    id.slice(20)
  ].join("-");
}

function getSettings() {
  return store.get("settings");
}

function getHighlights() {
  return store.get("highlights", []);
}

function getQueue() {
  return store.get("queue", []);
}

function getDeleteQueue() {
  return store.get("deleteQueue", []);
}

function publicSettings(settings = getSettings()) {
  return {
    notionAuthMode: settings.notionAuthMode || "token",
    notionPageInput: settings.notionPageInput || settings.notionPageId || "",
    notionPageId: settings.notionPageId || "",
    notionOAuthClientId: settings.notionOAuthClientId || "",
    notionOAuthRedirectUri: settings.notionOAuthRedirectUri || DEFAULT_NOTION_REDIRECT_URI,
    notionOAuthWorkspaceName: settings.notionOAuthWorkspaceName || "",
    aiProvider: settings.aiProvider || "openai",
    openaiModel: settings.openaiModel || "gpt-4o-mini",
    ollamaBaseUrl: settings.ollamaBaseUrl || "http://localhost:11434",
    ollamaModel: settings.ollamaModel || "llama3.1:8b",
    bookTitle: settings.bookTitle || "",
    hasNotionToken: Boolean(settings.notionToken),
    hasNotionOAuthSecret: Boolean(settings.notionOAuthClientSecret),
    hasNotionOAuthToken: Boolean(settings.notionToken && isOAuthMode(settings)),
    hasOpenaiApiKey: Boolean(settings.openaiApiKey)
  };
}

function hashHighlight({ pdfName, pageNumber, exactText }) {
  return crypto
    .createHash("sha256")
    .update(`${pdfName || ""}\n${pageNumber || ""}\n${exactText || ""}`)
    .digest("hex");
}

function clampRatio(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  return Math.min(Math.max(number, 0), 1);
}

function sanitizeHighlightRects(rects) {
  if (!Array.isArray(rects)) {
    return [];
  }

  return rects
    .map((rect) => {
      const pageNumber = Number(rect?.pageNumber);
      const leftRatio = clampRatio(rect?.leftRatio);
      const topRatio = clampRatio(rect?.topRatio);
      const rawWidthRatio = clampRatio(rect?.widthRatio);
      const rawHeightRatio = clampRatio(rect?.heightRatio);

      if (
        !Number.isInteger(pageNumber) ||
        pageNumber < 1 ||
        leftRatio === null ||
        topRatio === null ||
        rawWidthRatio === null ||
        rawHeightRatio === null
      ) {
        return null;
      }

      const widthRatio = Math.min(rawWidthRatio, 1 - leftRatio);
      const heightRatio = Math.min(rawHeightRatio, 1 - topRatio);

      if (widthRatio <= 0 || heightRatio <= 0) {
        return null;
      }

      return {
        pageNumber,
        leftRatio,
        topRatio,
        widthRatio,
        heightRatio
      };
    })
    .filter(Boolean);
}

function makeNotion(token) {
  return new NotionClient({ auth: token });
}

async function getSettingsForNotionRequest() {
  const settings = getSettings();
  if (!isOAuthMode(settings) || !settings.notionOAuthRefreshToken) {
    return settings;
  }

  return refreshNotionOAuthToken(settings);
}

function cleanBaseUrl(url, fallback = "http://localhost:11434") {
  const raw = String(url || "").trim() || fallback;
  return raw.replace(/\/+$/, "");
}

function cleanRedirectUri(value) {
  return String(value || DEFAULT_NOTION_REDIRECT_URI).trim() || DEFAULT_NOTION_REDIRECT_URI;
}

function isOAuthMode(settings = getSettings()) {
  return (settings.notionAuthMode || "token") === "oauth";
}

function encodeBasicAuth(clientId, clientSecret) {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

function getNotionOAuthCredentials(settings = getSettings()) {
  const clientId = String(settings.notionOAuthClientId || "").trim();
  const clientSecret = String(settings.notionOAuthClientSecret || "").trim();
  const redirectUri = cleanRedirectUri(settings.notionOAuthRedirectUri);

  if (!clientId) {
    throw new Error("Notion OAuth client ID is missing.");
  }

  if (!clientSecret) {
    throw new Error("Notion OAuth client secret is missing.");
  }

  return { clientId, clientSecret, redirectUri };
}

function getNotionAuthUrl({ clientId, redirectUri, state }) {
  const url = new URL("https://api.notion.com/v1/oauth/authorize");
  url.searchParams.set("owner", "user");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

async function requestNotionOAuthToken({ clientId, clientSecret, body }) {
  const response = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": `Basic ${encodeBasicAuth(clientId, clientSecret)}`
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(async () => ({
    error: await response.text().catch(() => "")
  }));

  if (!response.ok) {
    throw new Error(data.error_description || data.error || `Notion OAuth returned HTTP ${response.status}.`);
  }

  if (!data.access_token) {
    throw new Error("Notion OAuth did not return an access token.");
  }

  return data;
}

async function exchangeNotionOAuthCode({ code, clientId, clientSecret, redirectUri }) {
  return requestNotionOAuthToken({
    clientId,
    clientSecret,
    body: {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    }
  });
}

async function refreshNotionOAuthToken(settings = getSettings()) {
  if (!settings.notionOAuthRefreshToken) {
    return settings;
  }

  const { clientId, clientSecret } = getNotionOAuthCredentials(settings);
  const data = await requestNotionOAuthToken({
    clientId,
    clientSecret,
    body: {
      grant_type: "refresh_token",
      refresh_token: settings.notionOAuthRefreshToken
    }
  });

  const next = {
    ...settings,
    notionToken: data.access_token || settings.notionToken,
    notionOAuthRefreshToken: data.refresh_token || settings.notionOAuthRefreshToken,
    notionOAuthBotId: data.bot_id || settings.notionOAuthBotId,
    notionOAuthWorkspaceName: data.workspace_name || settings.notionOAuthWorkspaceName
  };

  store.set("settings", next);
  return next;
}

function respondToOAuthBrowser(response, title, body) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 48px; line-height: 1.5; color: #1f2328; }
      h1 { font-size: 22px; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>${body}</p>
  </body>
</html>`);
}

function waitForNotionOAuthCallback({ redirectUri, state }) {
  const parsed = new URL(redirectUri);
  const port = Number(parsed.port);
  const expectedPath = parsed.pathname || "/";

  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !Number.isInteger(port)) {
    throw new Error("Use a localhost redirect URI, for example http://127.0.0.1:45891/notion/callback.");
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Notion OAuth timed out before the callback arrived."));
    }, 120000);

    const server = http.createServer((request, response) => {
      const callbackUrl = new URL(request.url, redirectUri);

      if (callbackUrl.pathname !== expectedPath) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const callbackState = callbackUrl.searchParams.get("state");
      const code = callbackUrl.searchParams.get("code");
      const error = callbackUrl.searchParams.get("error");

      clearTimeout(timeout);
      server.close();

      if (callbackState !== state) {
        respondToOAuthBrowser(response, "LearnBetter", "OAuth state did not match. You can close this tab and try again.");
        reject(new Error("Notion OAuth state mismatch."));
        return;
      }

      if (error) {
        respondToOAuthBrowser(response, "LearnBetter", "Notion connection was cancelled. You can close this tab.");
        reject(new Error(`Notion OAuth failed: ${error}`));
        return;
      }

      if (!code) {
        respondToOAuthBrowser(response, "LearnBetter", "Notion did not return an authorization code. You can close this tab.");
        reject(new Error("Notion OAuth did not return an authorization code."));
        return;
      }

      respondToOAuthBrowser(response, "LearnBetter connected", "Return to LearnBetter to finish setup.");
      resolve(code);
    });

    server.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    server.listen(port, parsed.hostname);
  });
}

function getQuestionMessages(exactText) {
  return [
    {
      role: "system",
      content: [
        "You generate study questions from highlighted textbook passages.",
        "Return exactly one clear question.",
        "Do not answer the question.",
        "Do not quote, rewrite, summarize, or modify the source passage.",
        "Output only the question text."
      ].join(" ")
    },
    {
      role: "user",
      content: `Highlighted passage:\n${exactText}`
    }
  ];
}

function plainTextBlocks(text) {
  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];

  for (const line of lines) {
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: line
          ? [
              {
                type: "text",
                text: { content: line }
              }
            ]
          : []
      }
    });
  }

  return blocks.length > 0 ? blocks : [{
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [] }
  }];
}

function sourceBlock(bookTitle, pdfName, pageNumber) {
  const source = `Source: ${bookTitle || pdfName || "Untitled PDF"}, page ${pageNumber}`;

  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: { content: source },
          annotations: {
            italic: true,
            color: "gray"
          }
        }
      ]
    }
  };
}

function makeToggleBlock({ question, exactText, bookTitle, pdfName, pageNumber }) {
  return {
    object: "block",
    type: "toggle",
    toggle: {
      rich_text: [
        {
          type: "text",
          text: { content: question }
        }
      ],
      children: [
        ...plainTextBlocks(exactText),
        sourceBlock(bookTitle, pdfName, pageNumber)
      ]
    }
  };
}

async function generateQuestion({ exactText, settings }) {
  if ((settings.aiProvider || "openai") === "ollama") {
    return generateOllamaQuestion({ exactText, settings });
  }

  return generateOpenAIQuestion({ exactText, settings });
}

async function generateOpenAIQuestion({ exactText, settings }) {
  if (!settings.openaiApiKey) {
    throw new Error("OpenAI API key is missing.");
  }

  const client = new OpenAI({ apiKey: settings.openaiApiKey });
  const response = await client.chat.completions.create({
    model: settings.openaiModel || "gpt-4o-mini",
    temperature: 0.2,
    messages: getQuestionMessages(exactText)
  });

  const question = response.choices?.[0]?.message?.content?.trim();
  if (!question) {
    throw new Error("The AI did not return a question.");
  }

  return question;
}

async function generateOllamaQuestion({ exactText, settings }) {
  const model = String(settings.ollamaModel || "llama3.1:8b").trim();
  if (!model) {
    throw new Error("Ollama model is missing.");
  }

  const response = await fetch(`${cleanBaseUrl(settings.ollamaBaseUrl)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: getQuestionMessages(exactText),
      stream: false,
      options: {
        temperature: 0.2
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Ollama returned HTTP ${response.status}.`);
  }

  const data = await response.json();
  const question = data.message?.content?.trim();
  if (!question) {
    throw new Error("Ollama did not return a question.");
  }

  return question;
}

async function checkNotionConnection(settings) {
  if (isOAuthMode(settings) && settings.notionOAuthRefreshToken) {
    settings = await refreshNotionOAuthToken(settings);
  }

  if (!settings.notionToken) {
    return {
      status: "missing",
      message: isOAuthMode(settings) ? "OAuth not connected" : "Token missing"
    };
  }

  if (!settings.notionPageId) {
    return {
      status: "missing",
      message: "Page missing"
    };
  }

  try {
    const notion = makeNotion(settings.notionToken);
    await notion.blocks.children.list({
      block_id: settings.notionPageId,
      page_size: 1
    });

    return {
      status: "connected",
      message: "Connected"
    };
  } catch (error) {
    return {
      status: "error",
      message: error.message || String(error)
    };
  }
}

async function checkOpenAIConnection(settings) {
  if ((settings.aiProvider || "openai") === "ollama") {
    return checkOllamaConnection(settings);
  }

  if (!settings.openaiApiKey) {
    return {
      status: "missing",
      message: "API key missing"
    };
  }

  try {
    const client = new OpenAI({ apiKey: settings.openaiApiKey });
    await client.models.retrieve(settings.openaiModel || "gpt-4o-mini");

    return {
      status: "connected",
      message: "Connected"
    };
  } catch (error) {
    return {
      status: "error",
      message: error.message || String(error)
    };
  }
}

async function checkOllamaConnection(settings) {
  const model = String(settings.ollamaModel || "llama3.1:8b").trim();
  if (!model) {
    return {
      status: "missing",
      message: "Model missing",
      provider: "ollama"
    };
  }

  try {
    const response = await fetch(`${cleanBaseUrl(settings.ollamaBaseUrl)}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Ollama returned HTTP ${response.status}.`);
    }

    return {
      status: "connected",
      message: "Connected",
      provider: "ollama"
    };
  } catch (error) {
    return {
      status: "error",
      message: error.message || String(error),
      provider: "ollama"
    };
  }
}

async function getConnectionStatus() {
  const settings = getSettings();
  const [notion, openai] = await Promise.all([
    checkNotionConnection(settings),
    checkOpenAIConnection(settings)
  ]);

  return {
    notion,
    openai: {
      ...openai,
      provider: settings.aiProvider || "openai"
    },
    checkedAt: new Date().toISOString()
  };
}

async function appendToggleToNotion({ settings, question, exactText, pdfName, pageNumber }) {
  if (!settings.notionToken) {
    throw new Error("Notion integration token is missing.");
  }

  if (!settings.notionPageId) {
    throw new Error("Notion page ID is missing.");
  }

  const notion = makeNotion(settings.notionToken);
  const response = await notion.blocks.children.append({
    block_id: settings.notionPageId,
    children: [
      makeToggleBlock({
        question,
        exactText,
        bookTitle: settings.bookTitle,
        pdfName,
        pageNumber
      })
    ]
  });
  return response.results?.[0]?.id || "";
}

async function deleteNotionBlock({ settings, notionBlockId }) {
  if (!notionBlockId) {
    return;
  }

  if (!settings.notionToken) {
    throw new Error("Notion integration token is missing.");
  }

  const notion = makeNotion(settings.notionToken);
  await notion.blocks.delete({
    block_id: notionBlockId
  });
}

function saveHighlight(record) {
  const highlights = getHighlights();
  const next = [record, ...highlights.filter((item) => item.hash !== record.hash)].slice(0, 100);
  store.set("highlights", next);
  return next;
}

function saveQueue(record) {
  const queue = getQueue();
  const next = [record, ...queue.filter((item) => item.hash !== record.hash)];
  store.set("queue", next);
  return next;
}

function removeFromQueue(hash) {
  const next = getQueue().filter((item) => item.hash !== hash);
  store.set("queue", next);
  return next;
}

function saveDeleteQueue(record) {
  const queue = getDeleteQueue();
  const next = [record, ...queue.filter((item) => item.hash !== record.hash)];
  store.set("deleteQueue", next);
  return next;
}

function removeFromDeleteQueue(hash) {
  const next = getDeleteQueue().filter((item) => item.hash !== hash);
  store.set("deleteQueue", next);
  return next;
}

function removeHighlight(hash) {
  const highlights = getHighlights().filter((item) => item.hash !== hash);
  store.set("highlights", highlights);
  return highlights;
}

function updateHighlightStatus(hash, updates) {
  const highlights = getHighlights().map((item) => {
    if (item.hash !== hash) {
      return item;
    }
    return { ...item, ...updates };
  });
  store.set("highlights", highlights);
  return highlights;
}

async function processCapture(payload) {
  const settings = await getSettingsForNotionRequest();
  const exactText = String(payload.exactText || "");
  const pdfName = String(payload.pdfName || "Untitled PDF");
  const pageNumber = Number(payload.pageNumber || 1);
  const rects = sanitizeHighlightRects(payload.rects);
  const hash = hashHighlight({ pdfName, pageNumber, exactText });
  const now = new Date().toISOString();
  const existing = getHighlights().find((item) => item.hash === hash);

  if (existing?.status === "synced") {
    const hasStoredRects = Array.isArray(existing.rects) && existing.rects.length > 0;
    let record = existing;
    let highlights = getHighlights();

    if (!hasStoredRects && rects.length > 0) {
      record = {
        ...existing,
        rects,
        updatedAt: now
      };
      highlights = saveHighlight(record);
    }

    return {
      ok: true,
      duplicate: true,
      record,
      highlights,
      queue: getQueue()
    };
  }

  let record = {
    id: crypto.randomUUID(),
    hash,
    exactText,
    pdfName,
    pageNumber,
    rects: rects.length > 0 ? rects : existing?.rects || [],
    question: "",
    status: "pending",
    error: "",
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  saveHighlight(record);
  saveQueue(record);

  try {
    const question = existing?.question || await generateQuestion({ exactText, settings });
    const notionBlockId = existing?.notionBlockId || await appendToggleToNotion({ settings, question, exactText, pdfName, pageNumber });

    record = {
      ...record,
      question,
      notionBlockId,
      status: "synced",
      error: "",
      updatedAt: new Date().toISOString()
    };

    saveHighlight(record);
    removeFromQueue(hash);

    return {
      ok: true,
      duplicate: false,
      record,
      highlights: getHighlights(),
      queue: getQueue()
    };
  } catch (error) {
    record = {
      ...record,
      question: record.question || existing?.question || "",
      status: "failed",
      error: error.message || String(error),
      updatedAt: new Date().toISOString()
    };

    saveHighlight(record);
    saveQueue(record);

    return {
      ok: false,
      record,
      error: record.error,
      highlights: getHighlights(),
      queue: getQueue()
    };
  }
}

async function processDeleteCapture(hash) {
  const settings = await getSettingsForNotionRequest();
  const record = getHighlights().find((item) => item.hash === hash) || getDeleteQueue().find((item) => item.hash === hash);

  if (!record) {
    removeFromQueue(hash);
    removeFromDeleteQueue(hash);
    return {
      ok: true,
      missing: true,
      highlights: getHighlights(),
      queue: getQueue(),
      deleteQueue: getDeleteQueue()
    };
  }

  removeHighlight(hash);
  removeFromQueue(hash);

  if (!record.notionBlockId) {
    removeFromDeleteQueue(hash);
    return {
      ok: true,
      localOnly: true,
      record,
      warning: "Removed local highlight. This older capture has no saved Notion block ID.",
      highlights: getHighlights(),
      queue: getQueue(),
      deleteQueue: getDeleteQueue()
    };
  }

  try {
    await deleteNotionBlock({
      settings,
      notionBlockId: record.notionBlockId
    });
    removeFromDeleteQueue(hash);

    return {
      ok: true,
      record,
      highlights: getHighlights(),
      queue: getQueue(),
      deleteQueue: getDeleteQueue()
    };
  } catch (error) {
    const deleteRecord = {
      ...record,
      status: "delete_failed",
      error: error.message || String(error),
      updatedAt: new Date().toISOString()
    };
    saveDeleteQueue(deleteRecord);

    return {
      ok: false,
      record: deleteRecord,
      error: deleteRecord.error,
      highlights: getHighlights(),
      queue: getQueue(),
      deleteQueue: getDeleteQueue()
    };
  }
}

ipcMain.handle("settings:get", () => {
  return publicSettings();
});

ipcMain.handle("settings:save", async (_event, nextSettings) => {
  const current = getSettings();
  const notionPageInput = String(nextSettings.notionPageInput || "").trim();
  const notionPageId = normalizeNotionPageId(notionPageInput);
  const notionAuthMode = ["token", "oauth"].includes(nextSettings.notionAuthMode)
    ? nextSettings.notionAuthMode
    : current.notionAuthMode || "token";

  const merged = {
    ...current,
    notionAuthMode,
    notionToken: notionAuthMode === "token"
      ? String(nextSettings.notionToken || current.notionToken || "").trim()
      : current.notionToken || "",
    notionPageInput,
    notionPageId,
    notionOAuthClientId: String(nextSettings.notionOAuthClientId || current.notionOAuthClientId || "").trim(),
    notionOAuthClientSecret: String(nextSettings.notionOAuthClientSecret || current.notionOAuthClientSecret || "").trim(),
    notionOAuthRedirectUri: cleanRedirectUri(nextSettings.notionOAuthRedirectUri || current.notionOAuthRedirectUri),
    aiProvider: ["openai", "ollama"].includes(nextSettings.aiProvider) ? nextSettings.aiProvider : current.aiProvider || "openai",
    openaiApiKey: String(nextSettings.openaiApiKey || current.openaiApiKey || "").trim(),
    openaiModel: String(nextSettings.openaiModel || current.openaiModel || "gpt-4o-mini").trim(),
    ollamaBaseUrl: cleanBaseUrl(nextSettings.ollamaBaseUrl || current.ollamaBaseUrl),
    ollamaModel: String(nextSettings.ollamaModel || current.ollamaModel || "llama3.1:8b").trim(),
    bookTitle: String(nextSettings.bookTitle || "").trim()
  };

  store.set("settings", merged);
  return publicSettings(merged);
});

ipcMain.handle("settings:notion-oauth-start", async (_event, nextSettings) => {
  const current = getSettings();
  const notionPageInput = String(nextSettings?.notionPageInput || current.notionPageInput || "").trim();
  const settings = {
    ...current,
    notionAuthMode: "oauth",
    notionPageInput,
    notionPageId: normalizeNotionPageId(notionPageInput),
    notionOAuthClientId: String(nextSettings?.notionOAuthClientId || current.notionOAuthClientId || "").trim(),
    notionOAuthClientSecret: String(nextSettings?.notionOAuthClientSecret || current.notionOAuthClientSecret || "").trim(),
    notionOAuthRedirectUri: cleanRedirectUri(nextSettings?.notionOAuthRedirectUri || current.notionOAuthRedirectUri)
  };
  const { clientId, clientSecret, redirectUri } = getNotionOAuthCredentials(settings);
  const state = crypto.randomBytes(24).toString("hex");
  const callbackPromise = waitForNotionOAuthCallback({ redirectUri, state });
  const authUrl = getNotionAuthUrl({ clientId, redirectUri, state });

  store.set("settings", settings);
  await shell.openExternal(authUrl);

  const code = await callbackPromise;
  const data = await exchangeNotionOAuthCode({
    code,
    clientId,
    clientSecret,
    redirectUri
  });

  const next = {
    ...getSettings(),
    notionAuthMode: "oauth",
    notionToken: data.access_token || "",
    notionOAuthRefreshToken: data.refresh_token || "",
    notionOAuthBotId: data.bot_id || "",
    notionOAuthWorkspaceName: data.workspace_name || ""
  };

  if (!next.notionPageId && data.duplicated_template_id) {
    next.notionPageId = normalizeNotionPageId(data.duplicated_template_id);
    next.notionPageInput = next.notionPageId;
  }

  store.set("settings", next);
  return publicSettings(next);
});

ipcMain.handle("settings:notion-oauth-disconnect", async () => {
  const current = getSettings();
  const next = {
    ...current,
    notionToken: "",
    notionOAuthRefreshToken: "",
    notionOAuthBotId: "",
    notionOAuthWorkspaceName: ""
  };

  store.set("settings", next);
  return publicSettings(next);
});

ipcMain.handle("settings:validate", async () => {
  const result = await checkNotionConnection(getSettings());
  return result.status === "connected"
    ? { ok: true }
    : { ok: false, error: result.message };
});

ipcMain.handle("settings:connection-status", () => {
  return getConnectionStatus();
});

ipcMain.handle("pdf:open", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open PDF",
    filters: [{ name: "PDF files", extensions: ["pdf"] }],
    properties: ["openFile"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const data = await fs.readFile(filePath);

  return {
    name: path.basename(filePath),
    path: filePath,
    bytes: Array.from(data)
  };
});

ipcMain.handle("capture:create", async (_event, payload) => {
  const exactText = String(payload?.exactText || "");

  if (!exactText.trim()) {
    return {
      ok: false,
      error: "Select text before capturing a highlight.",
      highlights: getHighlights(),
      queue: getQueue(),
      deleteQueue: getDeleteQueue()
    };
  }

  return processCapture(payload);
});

ipcMain.handle("capture:list", () => {
  return {
    highlights: getHighlights(),
    queue: getQueue(),
    deleteQueue: getDeleteQueue()
  };
});

ipcMain.handle("capture:delete", async (_event, hash) => {
  const normalizedHash = String(hash || "");
  if (!normalizedHash) {
    return {
      ok: false,
      error: "Missing capture hash.",
      highlights: getHighlights(),
      queue: getQueue(),
      deleteQueue: getDeleteQueue()
    };
  }

  return processDeleteCapture(normalizedHash);
});

ipcMain.handle("queue:retry", async () => {
  const pending = getQueue();
  const pendingDeletes = getDeleteQueue();
  const results = [];
  const deleteResults = [];

  for (const item of pending) {
    updateHighlightStatus(item.hash, {
      status: "pending",
      error: "",
      updatedAt: new Date().toISOString()
    });
    results.push(await processCapture(item));
  }

  for (const item of pendingDeletes) {
    deleteResults.push(await processDeleteCapture(item.hash));
  }

  return {
    ok: results.every((result) => result.ok) && deleteResults.every((result) => result.ok),
    results,
    deleteResults,
    highlights: getHighlights(),
    queue: getQueue(),
    deleteQueue: getDeleteQueue()
  };
});
