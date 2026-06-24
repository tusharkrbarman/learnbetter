const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const http = require("node:http");
const ElectronStore = require("electron-store");
const { Client: NotionClient } = require("@notionhq/client");

const APP_NAME = "LearnBetter";
const APP_ID = "com.tusharkrbarman.learnbetter";
const APP_ICON = path.join(__dirname, "../../assets/icons/icon.png");
const DEFAULT_NOTION_REDIRECT_URI = "http://127.0.0.1:45891/notion/callback";
const DEFAULT_OLLAMA_MODEL = "gemma4:e4b";
const LEGACY_OLLAMA_MODELS = new Set(["llama3.1:8b"]);
const MAX_HIGHLIGHTS = 100;
const MAX_QUEUE_ITEMS = 50;
const MAX_DELETE_QUEUE_ITEMS = 50;
const MAX_QUEUE_ATTEMPTS = 5;
const Store = ElectronStore.default || ElectronStore;

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

const store = new Store({
  name: "learnbetter",
  clearInvalidConfig: true,
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
      ollamaBaseUrl: "http://localhost:11434",
      ollamaModel: DEFAULT_OLLAMA_MODEL,
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
  migrateStoreData();
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

function trimQueue(queue, limit) {
  return (Array.isArray(queue) ? queue : [])
    .filter((item) => item && typeof item === "object" && item.hash)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .slice(0, limit);
}

function migrateStoreData() {
  const settings = {
    ...store.get("settings", {})
  };

  for (const key of ["ai" + "Provider", "open" + "aiApiKey", "open" + "aiModel"]) {
    delete settings[key];
  }

  const savedOllamaModel = String(settings.ollamaModel || "").trim();
  const ollamaModel = !savedOllamaModel || LEGACY_OLLAMA_MODELS.has(savedOllamaModel)
    ? DEFAULT_OLLAMA_MODEL
    : savedOllamaModel;

  store.set("settings", {
    notionAuthMode: settings.notionAuthMode || "token",
    notionToken: settings.notionToken || "",
    notionPageId: settings.notionPageId || "",
    notionPageInput: settings.notionPageInput || settings.notionPageId || "",
    notionOAuthClientId: settings.notionOAuthClientId || "",
    notionOAuthClientSecret: settings.notionOAuthClientSecret || "",
    notionOAuthRedirectUri: cleanRedirectUri(settings.notionOAuthRedirectUri),
    notionOAuthRefreshToken: settings.notionOAuthRefreshToken || "",
    notionOAuthBotId: settings.notionOAuthBotId || "",
    notionOAuthWorkspaceName: settings.notionOAuthWorkspaceName || "",
    ollamaBaseUrl: cleanBaseUrl(settings.ollamaBaseUrl),
    ollamaModel,
    bookTitle: settings.bookTitle || ""
  });

  store.set("highlights", (Array.isArray(store.get("highlights")) ? store.get("highlights") : []).slice(0, MAX_HIGHLIGHTS));
  store.set("queue", trimQueue(store.get("queue"), MAX_QUEUE_ITEMS));
  store.set("deleteQueue", trimQueue(store.get("deleteQueue"), MAX_DELETE_QUEUE_ITEMS));
}

function publicSettings(settings = getSettings()) {
  return {
    notionAuthMode: settings.notionAuthMode || "token",
    notionPageInput: settings.notionPageInput || settings.notionPageId || "",
    notionPageId: settings.notionPageId || "",
    notionOAuthClientId: settings.notionOAuthClientId || "",
    notionOAuthRedirectUri: settings.notionOAuthRedirectUri || DEFAULT_NOTION_REDIRECT_URI,
    notionOAuthWorkspaceName: settings.notionOAuthWorkspaceName || "",
    ollamaBaseUrl: settings.ollamaBaseUrl || "http://localhost:11434",
    ollamaModel: settings.ollamaModel || DEFAULT_OLLAMA_MODEL,
    bookTitle: settings.bookTitle || "",
    hasNotionToken: Boolean(settings.notionToken),
    hasNotionOAuthSecret: Boolean(settings.notionOAuthClientSecret),
    hasNotionOAuthToken: Boolean(settings.notionToken && isOAuthMode(settings))
  };
}

function getPdfIdentity({ pdfContentFingerprint, pdfFingerprint, pdfName }) {
  return pdfContentFingerprint || pdfFingerprint || pdfName || "";
}

function hashHighlight({ pdfContentFingerprint, pdfFingerprint, pdfName, pageNumber, exactText }) {
  return crypto
    .createHash("sha256")
    .update(`${getPdfIdentity({ pdfContentFingerprint, pdfFingerprint, pdfName })}\n${pageNumber || ""}\n${exactText || ""}`)
    .digest("hex");
}

function fingerprintPdfData(data) {
  return crypto
    .createHash("sha256")
    .update(data)
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

function isConnectionRefusedError(error) {
  const message = `${error?.message || ""} ${error?.cause?.message || ""} ${error?.cause?.code || ""}`;
  return /fetch failed|failed to fetch|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH/i.test(message);
}

function getOllamaModel(settings) {
  return String(settings.ollamaModel || DEFAULT_OLLAMA_MODEL).trim();
}

function getOllamaModelMissingMessage(settings) {
  const model = getOllamaModel(settings) || DEFAULT_OLLAMA_MODEL;
  return `Local model "${model}" is not available. Run: ollama pull ${model}`;
}

function isOllamaModelMissingError(errorOrText) {
  const message = String(errorOrText?.message || errorOrText || "");
  return /model .*not found|model .*does not exist|not found/i.test(message);
}

function formatOllamaError(error, settings) {
  if (isConnectionRefusedError(error)) {
    return "Local AI is not running. Start Ollama, then retry.";
  }

  if (isOllamaModelMissingError(error)) {
    return getOllamaModelMissingMessage(settings);
  }

  return error.message || String(error);
}

function normalizeGeneratedQuestion(rawQuestion) {
  const raw = String(rawQuestion || "").trim();
  if (!raw) {
    throw new Error("Local AI did not return a question.");
  }

  const paragraphs = raw.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    throw new Error("Local AI returned multiple paragraphs instead of one question. Try again or use a smaller selection.");
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) {
    throw new Error("Local AI returned multiple lines instead of one question. Try again or use a smaller selection.");
  }

  const withoutPrefix = raw.replace(/^(question|q)\s*[:.)-]\s*/i, "").trim();
  if (/^answer\s*[:.)-]/i.test(withoutPrefix)) {
    throw new Error("Local AI returned an answer instead of a question. Try again.");
  }

  const questionEnd = withoutPrefix.indexOf("?");
  if (questionEnd === -1) {
    throw new Error("Local AI returned text that was not a question. Try again.");
  }

  const question = withoutPrefix.slice(0, questionEnd + 1).replace(/^["']|["']$/g, "").trim();
  if (question.length > 220) {
    throw new Error("Local AI returned a question that was too long. Try a smaller selection.");
  }

  return question;
}

function normalizeGeneratedAnswer(rawAnswer, exactText) {
  const answer = String(rawAnswer || "").replace(/\s+/g, " ").trim();
  if (!answer) {
    throw new Error("Local AI did not return an AI answer.");
  }

  if (answer.length > 700) {
    throw new Error("Local AI returned an AI answer that was too long. Try a smaller selection.");
  }

  if (answer === String(exactText || "").replace(/\s+/g, " ").trim()) {
    throw new Error("Local AI copied the source text instead of writing an AI answer. Try again.");
  }

  return answer;
}

function stripJsonFence(rawText) {
  return String(rawText || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseGeneratedStudyItem(rawText, exactText) {
  const cleaned = stripJsonFence(rawText);
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error("Local AI did not return the expected question and answer JSON. Try again.");
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
  } catch {
    throw new Error("Local AI returned invalid JSON for the question and answer. Try again.");
  }

  return {
    question: normalizeGeneratedQuestion(parsed.question),
    aiAnswer: normalizeGeneratedAnswer(parsed.answer, exactText)
  };
}

function formatNotionError(error) {
  const message = error.message || String(error);
  const code = String(error.code || error.body?.code || "");

  if (/object_not_found|unauthorized|restricted_resource/i.test(code) || /Could not find block|Could not find page|Make sure the relevant pages and databases are shared/i.test(message)) {
    return "Notion cannot access this page. Share the destination page with your Notion integration, then retry.";
  }

  if (/validation_error/i.test(code) || /invalid/i.test(message)) {
    return "Notion rejected the page or block request. Check the destination page link or ID.";
  }

  return message;
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
        "You create grounded study notes from highlighted textbook passages.",
        "Use only the highlighted passage as evidence.",
        "Write one specific study question that targets the central idea, causal relationship, definition, mechanism, or contrast in the passage.",
        "Avoid vague questions like 'What is discussed in this passage?'",
        "Write one concise AI answer that directly answers the question using only the highlighted passage.",
        "Do not quote the passage at length.",
        "Do not add outside facts.",
        "Output only valid JSON with this exact shape:",
        "{\"question\":\"...\",\"answer\":\"...\"}"
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

function labelBlock(label) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: { content: label },
          annotations: {
            bold: true
          }
        }
      ]
    }
  };
}

function makeToggleBlock({ question, aiAnswer, exactText, bookTitle, pdfName, pageNumber }) {
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
        labelBlock("AI answer"),
        ...plainTextBlocks(aiAnswer),
        labelBlock("Copied text"),
        ...plainTextBlocks(exactText),
        sourceBlock(bookTitle, pdfName, pageNumber)
      ]
    }
  };
}

async function generateStudyItem({ exactText, settings }) {
  return generateOllamaQuestion({ exactText, settings });
}

async function generateOllamaQuestion({ exactText, settings }) {
  const model = getOllamaModel(settings);
  if (!model) {
    throw new Error("Local model is missing.");
  }

  try {
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
      throw new Error(body || `Local AI returned HTTP ${response.status}.`);
    }

    const data = await response.json();
    return parseGeneratedStudyItem(data.message?.content, exactText);
  } catch (error) {
    throw new Error(formatOllamaError(error, settings));
  }
}

async function validateNotionDestination({ settings, notionPageInput, notionPageId }) {
  if (!notionPageInput) {
    throw new Error("Paste the destination Notion page link or ID before saving setup.");
  }

  if (!notionPageId) {
    throw new Error("Notion page link or ID is invalid. Paste a Notion page URL or 32-character page ID.");
  }

  const token = settings.notionToken || "";
  if (!token) {
    return;
  }

  try {
    const notion = makeNotion(token);
    await notion.blocks.children.list({
      block_id: notionPageId,
      page_size: 1
    });
  } catch (error) {
    throw new Error(formatNotionError(error));
  }
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
      message: isOAuthMode(settings)
        ? "OAuth connected. Paste the destination Notion page link or ID, then save setup."
        : "Paste the destination Notion page link or ID."
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
      message: formatNotionError(error)
    };
  }
}

async function checkOllamaConnection(settings) {
  const model = getOllamaModel(settings);
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
      throw new Error(body || `Local AI returned HTTP ${response.status}.`);
    }

    return {
      status: "connected",
      message: `Connected to ${model}`,
      provider: "ollama",
      model
    };
  } catch (error) {
    return {
      status: "error",
      message: formatOllamaError(error, settings),
      provider: "ollama",
      model
    };
  }
}

async function getConnectionStatus() {
  const settings = getSettings();
  const [notion, ollama] = await Promise.all([
    checkNotionConnection(settings),
    checkOllamaConnection(settings)
  ]);

  return {
    notion,
    ollama,
    checkedAt: new Date().toISOString()
  };
}

async function appendToggleToNotion({ settings, question, aiAnswer, exactText, pdfName, pageNumber }) {
  if (!settings.notionToken) {
    throw new Error("Notion integration token is missing.");
  }

  if (!settings.notionPageId) {
    throw new Error("Notion page ID is missing.");
  }

  const notion = makeNotion(settings.notionToken);
  try {
    const response = await notion.blocks.children.append({
      block_id: settings.notionPageId,
      children: [
        makeToggleBlock({
          question,
          aiAnswer,
          exactText,
          bookTitle: settings.bookTitle,
          pdfName,
          pageNumber
        })
      ]
    });
    return response.results?.[0]?.id || "";
  } catch (error) {
    throw new Error(formatNotionError(error));
  }
}

async function deleteNotionBlock({ settings, notionBlockId }) {
  if (!notionBlockId) {
    return;
  }

  if (!settings.notionToken) {
    throw new Error("Notion integration token is missing.");
  }

  const notion = makeNotion(settings.notionToken);
  try {
    await notion.blocks.delete({
      block_id: notionBlockId
    });
  } catch (error) {
    throw new Error(formatNotionError(error));
  }
}

function saveHighlight(record, previousHash = "") {
  const highlights = getHighlights();
  const next = [
    record,
    ...highlights.filter((item) => item.hash !== record.hash && item.hash !== previousHash)
  ].slice(0, MAX_HIGHLIGHTS);
  store.set("highlights", next);
  return next;
}

function saveQueue(record) {
  if (Number(record.retryCount || 0) >= MAX_QUEUE_ATTEMPTS) {
    return removeFromQueue(record.hash);
  }

  const queue = getQueue();
  const next = [record, ...queue.filter((item) => item.hash !== record.hash)].slice(0, MAX_QUEUE_ITEMS);
  store.set("queue", next);
  return next;
}

function removeFromQueue(hash) {
  const next = getQueue().filter((item) => item.hash !== hash);
  store.set("queue", next);
  return next;
}

function saveDeleteQueue(record) {
  if (Number(record.deleteRetryCount || 0) >= MAX_QUEUE_ATTEMPTS) {
    return removeFromDeleteQueue(record.hash);
  }

  const queue = getDeleteQueue();
  const next = [record, ...queue.filter((item) => item.hash !== record.hash)].slice(0, MAX_DELETE_QUEUE_ITEMS);
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

function rememberPdfIdentity({ pdfFingerprint, pdfContentFingerprint }) {
  if (!pdfFingerprint || !pdfContentFingerprint) {
    return {
      highlights: getHighlights(),
      queue: getQueue(),
      deleteQueue: getDeleteQueue()
    };
  }

  const addContentFingerprint = (item) => {
    if (item.pdfFingerprint === pdfFingerprint && !item.pdfContentFingerprint) {
      return {
        ...item,
        pdfContentFingerprint,
        updatedAt: new Date().toISOString()
      };
    }

    return item;
  };

  const highlights = getHighlights().map(addContentFingerprint);
  const queue = getQueue().map(addContentFingerprint);
  const deleteQueue = getDeleteQueue().map(addContentFingerprint);

  store.set("highlights", highlights);
  store.set("queue", queue);
  store.set("deleteQueue", deleteQueue);

  return { highlights, queue, deleteQueue };
}

function findExistingHighlight({ hash, fullFileHash, legacyNameHash, pdfContentFingerprint, pageNumber, exactText }) {
  const highlights = getHighlights();
  return highlights.find((item) => item.hash === hash)
    || (fullFileHash ? highlights.find((item) => item.hash === fullFileHash) : null)
    || highlights.find((item) => item.hash === legacyNameHash && !item.pdfFingerprint && !item.pdfContentFingerprint)
    || (pdfContentFingerprint
      ? highlights.find((item) => (
          item.pdfContentFingerprint === pdfContentFingerprint &&
          Number(item.pageNumber) === pageNumber &&
          item.exactText === exactText
        ))
      : null);
}

function isCaptureQueued(...hashes) {
  const candidates = new Set(hashes.filter(Boolean));
  return getQueue().some((item) => candidates.has(item.hash));
}

async function processCapture(payload) {
  const settings = await getSettingsForNotionRequest();
  const exactText = String(payload.exactText || "");
  const pdfName = String(payload.pdfName || "Untitled PDF");
  const pdfFingerprint = String(payload.pdfFingerprint || "");
  const pdfContentFingerprint = String(payload.pdfContentFingerprint || "");
  const pageNumber = Number(payload.pageNumber || 1);
  const rects = sanitizeHighlightRects(payload.rects);
  const hash = hashHighlight({ pdfContentFingerprint, pdfFingerprint, pdfName, pageNumber, exactText });
  const fullFileHash = pdfFingerprint ? hashHighlight({ pdfFingerprint, pdfName, pageNumber, exactText }) : "";
  const legacyNameHash = hashHighlight({ pdfName, pageNumber, exactText });
  const now = new Date().toISOString();
  const existing = findExistingHighlight({
    hash,
    fullFileHash,
    legacyNameHash,
    pdfContentFingerprint,
    pageNumber,
    exactText
  });
  const previousHash = existing?.hash !== hash ? existing?.hash : "";

  if (!payload.fromQueue && existing && existing.status !== "synced" && isCaptureQueued(hash, previousHash, fullFileHash, legacyNameHash)) {
    const record = {
      ...existing,
      hash,
      pdfFingerprint,
      pdfContentFingerprint,
      rects: Array.isArray(existing.rects) && existing.rects.length > 0 ? existing.rects : rects,
      updatedAt: now
    };

    const highlights = saveHighlight(record, previousHash);
    if (previousHash) {
      removeFromQueue(previousHash);
    }
    saveQueue(record);

    return {
      ok: false,
      duplicate: true,
      record,
      error: record.error || "This highlight is already queued for retry.",
      highlights,
      queue: getQueue()
    };
  }

  if (existing?.status === "synced") {
    const hasStoredRects = Array.isArray(existing.rects) && existing.rects.length > 0;
    let record = existing;
    let highlights = getHighlights();

    if (previousHash || !existing.pdfFingerprint || (pdfContentFingerprint && !existing.pdfContentFingerprint) || (!hasStoredRects && rects.length > 0)) {
      record = {
        ...existing,
        hash,
        pdfFingerprint,
        pdfContentFingerprint,
        rects: hasStoredRects ? existing.rects : rects,
        updatedAt: now
      };
      highlights = saveHighlight(record, previousHash);
      if (previousHash) {
        removeFromQueue(previousHash);
      }
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
    id: existing?.id || crypto.randomUUID(),
    hash,
    exactText,
    pdfName,
    pdfFingerprint,
    pdfContentFingerprint,
    pageNumber,
    rects: rects.length > 0 ? rects : existing?.rects || [],
    question: "",
    aiAnswer: "",
    status: "pending",
    error: "",
    retryCount: Number(existing?.retryCount || payload.retryCount || 0),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  saveHighlight(record, previousHash);
  if (previousHash) {
    removeFromQueue(previousHash);
  }
  saveQueue(record);

  try {
    const studyItem = existing?.question && existing?.aiAnswer
      ? { question: existing.question, aiAnswer: existing.aiAnswer }
      : await generateStudyItem({ exactText, settings });
    record = {
      ...record,
      question: studyItem.question,
      aiAnswer: studyItem.aiAnswer
    };

    if (payload.isOnline === false) {
      throw new Error("Offline: generated with local AI. Notion sync is queued until you reconnect.");
    }

    const notionBlockId = existing?.notionBlockId || await appendToggleToNotion({
      settings,
      question: studyItem.question,
      aiAnswer: studyItem.aiAnswer,
      exactText,
      pdfName,
      pageNumber
    });

    record = {
      ...record,
      question: studyItem.question,
      aiAnswer: studyItem.aiAnswer,
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
      aiAnswer: record.aiAnswer || existing?.aiAnswer || "",
      status: "failed",
      retryCount: Number(record.retryCount || 0) + 1,
      error: error.message || String(error),
      updatedAt: new Date().toISOString()
    };

    if (record.retryCount >= MAX_QUEUE_ATTEMPTS) {
      record.error = `${record.error} Stopped automatic retries after ${MAX_QUEUE_ATTEMPTS} failed attempts. Fix setup, then capture it again.`;
    }

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
    const pendingMessage = `Local highlight was removed. Notion cleanup is pending: ${error.message || String(error)}`;
    const deleteRecord = {
      ...record,
      status: "delete_failed",
      deleteRetryCount: Number(record.deleteRetryCount || 0) + 1,
      error: pendingMessage,
      updatedAt: new Date().toISOString()
    };

    if (deleteRecord.deleteRetryCount >= MAX_QUEUE_ATTEMPTS) {
      deleteRecord.error = `${pendingMessage} Stopped automatic delete retries after ${MAX_QUEUE_ATTEMPTS} failed attempts.`;
    }

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
    ollamaBaseUrl: cleanBaseUrl(nextSettings.ollamaBaseUrl || current.ollamaBaseUrl),
    ollamaModel: String(nextSettings.ollamaModel || current.ollamaModel || DEFAULT_OLLAMA_MODEL).trim(),
    bookTitle: String(nextSettings.bookTitle || "").trim()
  };

  for (const key of ["ai" + "Provider", "open" + "aiApiKey", "open" + "aiModel"]) {
    delete merged[key];
  }

  await validateNotionDestination({
    settings: merged,
    notionPageInput,
    notionPageId
  });

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
    fingerprint: fingerprintPdfData(data),
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

ipcMain.handle("capture:remember-pdf-identity", (_event, payload) => {
  return rememberPdfIdentity({
    pdfFingerprint: String(payload?.pdfFingerprint || ""),
    pdfContentFingerprint: String(payload?.pdfContentFingerprint || "")
  });
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
    results.push(await processCapture({ ...item, fromQueue: true }));
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
