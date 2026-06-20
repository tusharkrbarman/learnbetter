import * as pdfjsLib from "../../node_modules/pdfjs-dist/build/pdf.mjs";
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer
} from "../../node_modules/pdfjs-dist/web/pdf_viewer.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "../../node_modules/pdfjs-dist/build/pdf.worker.mjs";

const els = {
  notionToken: document.querySelector("#notionToken"),
  notionPageInput: document.querySelector("#notionPageInput"),
  aiProvider: document.querySelector("#aiProvider"),
  openaiApiKey: document.querySelector("#openaiApiKey"),
  openaiModel: document.querySelector("#openaiModel"),
  ollamaBaseUrl: document.querySelector("#ollamaBaseUrl"),
  ollamaModel: document.querySelector("#ollamaModel"),
  bookTitle: document.querySelector("#bookTitle"),
  saveSettings: document.querySelector("#saveSettings"),
  validateSettings: document.querySelector("#validateSettings"),
  settingsStatus: document.querySelector("#settingsStatus"),
  notionStatusDot: document.querySelector("#notionStatusDot"),
  notionStatusText: document.querySelector("#notionStatusText"),
  openaiStatusDot: document.querySelector("#openaiStatusDot"),
  openaiStatusText: document.querySelector("#openaiStatusText"),
  aiStatusName: document.querySelector("#aiStatusName"),
  openPdf: document.querySelector("#openPdf"),
  captureHighlight: document.querySelector("#captureHighlight"),
  searchPdf: document.querySelector("#searchPdf"),
  searchPrevious: document.querySelector("#searchPrevious"),
  searchNext: document.querySelector("#searchNext"),
  zoomOut: document.querySelector("#zoomOut"),
  zoomReset: document.querySelector("#zoomReset"),
  zoomIn: document.querySelector("#zoomIn"),
  fitWidth: document.querySelector("#fitWidth"),
  fitPage: document.querySelector("#fitPage"),
  retryQueue: document.querySelector("#retryQueue"),
  captureList: document.querySelector("#captureList"),
  pdfName: document.querySelector("#pdfName"),
  pageMeta: document.querySelector("#pageMeta"),
  emptyState: document.querySelector("#emptyState"),
  pdfContainer: document.querySelector("#pdfViewerContainer"),
  pdfViewer: document.querySelector("#pdfViewer")
};

const state = {
  pdf: null,
  pdfName: "",
  currentPage: 1,
  scale: 1.35,
  visualHighlights: [],
  sessionCaptureHashes: new Set(),
  isRendering: false,
  isSyncing: false,
  findController: null,
  findTimer: null,
  eventBus: null,
  linkService: null,
  pdfViewer: null
};

const ZOOM_MIN = 0.75;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.15;
const ZOOM_DEFAULT = 1.35;
const CONNECTION_LABELS = {
  connected: "Connected",
  error: "Error",
  missing: "Not configured",
  checking: "Checking..."
};

function setStatus(message, type = "") {
  els.settingsStatus.textContent = message;
  els.settingsStatus.className = `status-line ${type}`.trim();
}

function setProviderStatus(provider, status, message = "") {
  const dot = provider === "notion" ? els.notionStatusDot : els.openaiStatusDot;
  const text = provider === "notion" ? els.notionStatusText : els.openaiStatusText;
  const normalized = status || "missing";
  dot.className = `status-dot ${normalized}`;
  text.textContent = message || CONNECTION_LABELS[normalized] || "Unknown";
  text.title = message || "";
}

function getSelectedProviderLabel(provider = els.aiProvider.value) {
  return provider === "ollama" ? "Ollama" : "OpenAI";
}

function updateProviderFields() {
  const provider = els.aiProvider.value;
  document.body.dataset.aiProvider = provider;
  els.aiStatusName.textContent = getSelectedProviderLabel(provider);
}

function setConnectionChecking() {
  setProviderStatus("notion", "checking");
  setProviderStatus("openai", "checking");
}

async function refreshConnectionStatus({ showStatus = false } = {}) {
  setConnectionChecking();

  try {
    const result = await window.notionPdf.getConnectionStatus();
    setProviderStatus("notion", result.notion.status, result.notion.message);
    setProviderStatus("openai", result.openai.status, result.openai.message);
    els.aiStatusName.textContent = getSelectedProviderLabel(result.openai.provider);

    const isConnected = result.notion.status === "connected" && result.openai.status === "connected";
    if (showStatus) {
      setStatus(isConnected ? `Notion and ${getSelectedProviderLabel(result.openai.provider)} are connected.` : "Some connections need attention.", isConnected ? "success" : "error");
    }

    return result;
  } catch (error) {
    setProviderStatus("notion", "error", "Could not check");
    setProviderStatus("openai", "error", "Could not check");
    if (showStatus) {
      setStatus(error.message || String(error), "error");
    }
    return null;
  }
}

function setBusy(isBusy) {
  els.captureHighlight.disabled = isBusy || !state.pdf;
  els.openPdf.disabled = isBusy;
  els.saveSettings.disabled = isBusy;
  els.validateSettings.disabled = isBusy;
  els.retryQueue.disabled = isBusy;
  updateFindControls(isBusy);
  updateZoomControls(isBusy);
}

function updateZoomControls(isBusy = state.isRendering) {
  const hasPdf = Boolean(state.pdf);
  els.zoomOut.disabled = isBusy || !hasPdf || state.scale <= ZOOM_MIN;
  els.zoomIn.disabled = isBusy || !hasPdf || state.scale >= ZOOM_MAX;
  els.zoomReset.disabled = isBusy || !hasPdf;
  els.fitWidth.disabled = isBusy || !hasPdf;
  els.fitPage.disabled = isBusy || !hasPdf;
  els.zoomReset.textContent = `${Math.round(state.scale * 100)}%`;
}

function updateFindControls(isBusy = state.isRendering) {
  const hasPdf = Boolean(state.pdf);
  const hasQuery = Boolean(els.searchPdf.value.trim());
  els.searchPdf.disabled = isBusy || !hasPdf;
  els.searchPrevious.disabled = isBusy || !hasPdf || !hasQuery;
  els.searchNext.disabled = isBusy || !hasPdf || !hasQuery;
}

function bytesToUint8Array(bytes) {
  return new Uint8Array(bytes);
}

function escapeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function renderCaptureList(highlights = []) {
  if (!highlights.length) {
    els.captureList.innerHTML = '<p class="status-line">No captures yet.</p>';
    return;
  }

  els.captureList.innerHTML = "";

  for (const item of highlights) {
    const node = document.createElement("article");
    node.className = "capture-item";

    const title = document.createElement("strong");
    title.textContent = item.question || `${item.pdfName}, page ${item.pageNumber}`;

    const preview = document.createElement("p");
    preview.textContent = escapeText(item.exactText);

    const badge = document.createElement("span");
    badge.className = `badge ${item.status || "pending"}`;
    badge.textContent = item.status || "pending";

    node.append(title, preview, badge);

    if (item.hash) {
      const actions = document.createElement("div");
      actions.className = "capture-actions";

      const remove = document.createElement("button");
      remove.className = "text-button remove-capture";
      remove.type = "button";
      remove.dataset.hash = item.hash;
      remove.textContent = "Remove from PDF + Notion";
      remove.title = item.notionBlockId
        ? "Remove highlight and delete the Notion toggle"
        : "Remove local highlight. Older captures may not have a Notion block ID.";

      actions.append(remove);
      node.append(actions);
    }

    if (item.error) {
      const error = document.createElement("p");
      error.textContent = item.error;
      node.append(error);
    }

    els.captureList.append(node);
  }
}

async function refreshCaptures() {
  renderCaptureList([]);
}

function renderSessionCaptures(highlights = []) {
  renderCaptureList(highlights.filter((item) => state.sessionCaptureHashes.has(item.hash)));
}

function getCapturesForCurrentPdf(highlights = []) {
  return highlights.filter((item) => item.pdfName === state.pdfName);
}

function renderVisibleCaptures(highlights = []) {
  if (state.pdfName) {
    renderCaptureList(getCapturesForCurrentPdf(highlights));
  } else {
    renderSessionCaptures(highlights);
  }
}

function rememberSessionCapture(record) {
  if (record?.hash) {
    state.sessionCaptureHashes.add(record.hash);
  }
}

async function loadSettings() {
  const settings = await window.notionPdf.getSettings();

  els.notionPageInput.value = settings.notionPageInput || "";
  els.aiProvider.value = settings.aiProvider || "openai";
  els.openaiModel.value = settings.openaiModel || "gpt-4o-mini";
  els.ollamaBaseUrl.value = settings.ollamaBaseUrl || "http://localhost:11434";
  els.ollamaModel.value = settings.ollamaModel || "llama3.1:8b";
  els.bookTitle.value = settings.bookTitle || "";
  els.notionToken.placeholder = settings.hasNotionToken ? "Saved token" : "secret_...";
  els.openaiApiKey.placeholder = settings.hasOpenaiApiKey ? "Saved API key" : "sk-...";
  updateProviderFields();
}

async function saveSettings() {
  setBusy(true);
  setStatus("Saving setup...");

  try {
    const settings = await window.notionPdf.saveSettings({
      notionToken: els.notionToken.value,
      notionPageInput: els.notionPageInput.value,
      aiProvider: els.aiProvider.value,
      openaiApiKey: els.openaiApiKey.value,
      openaiModel: els.openaiModel.value,
      ollamaBaseUrl: els.ollamaBaseUrl.value,
      ollamaModel: els.ollamaModel.value,
      bookTitle: els.bookTitle.value
    });

    els.notionToken.value = "";
    els.openaiApiKey.value = "";
    els.notionToken.placeholder = settings.hasNotionToken ? "Saved token" : "secret_...";
    els.openaiApiKey.placeholder = settings.hasOpenaiApiKey ? "Saved API key" : "sk-...";
    setStatus("Setup saved.", "success");
    await refreshConnectionStatus();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

async function validateSettings() {
  setBusy(true);
  setStatus("Checking connections...");

  try {
    await refreshConnectionStatus({ showStatus: true });
  } finally {
    setBusy(false);
  }
}

function updatePageMeta(pageNumber = state.currentPage) {
  state.currentPage = pageNumber;
  els.pageMeta.textContent = state.pdf ? `Page ${pageNumber} of ${state.pdf.numPages}` : "";
}

function initializePdfViewer() {
  if (state.pdfViewer) {
    return;
  }

  state.eventBus = new EventBus();
  state.linkService = new PDFLinkService({
    eventBus: state.eventBus,
    externalLinkTarget: 2
  });
  state.findController = new PDFFindController({
    linkService: state.linkService,
    eventBus: state.eventBus
  });
  state.pdfViewer = new PDFViewer({
    container: els.pdfContainer,
    viewer: els.pdfViewer,
    eventBus: state.eventBus,
    linkService: state.linkService,
    findController: state.findController,
    removePageBorders: true
  });
  state.linkService.setViewer(state.pdfViewer);

  state.eventBus.on("pagesinit", () => {
    state.pdfViewer.currentScale = state.scale;
    updatePageMeta(state.pdfViewer.currentPageNumber || 1);
    updateFindControls();
    updateZoomControls();
    redrawVisualHighlightsSoon();
  });

  state.eventBus.on("textlayerrendered", () => {
    redrawVisualHighlightsSoon();
  });

  state.eventBus.on("scalechanging", ({ scale }) => {
    state.scale = scale;
    updateZoomControls();
    redrawVisualHighlightsSoon();
  });

  state.eventBus.on("pagechanging", ({ pageNumber }) => {
    updatePageMeta(pageNumber);
  });

  state.eventBus.on("pagesloaded", () => {
    state.isRendering = false;
    setBusy(false);
    updateFindControls();
    updateZoomControls();
    redrawVisualHighlightsSoon();
  });
}

function getPageElementFromNode(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const pageEl = element?.closest?.(".page");
  if (!pageEl) {
    return null;
  }

  return {
    node: pageEl,
    number: Number(pageEl.dataset.pageNumber)
  };
}

function getPagesFromRange(range) {
  const startPage = getPageElementFromNode(range.startContainer);
  const endPage = getPageElementFromNode(range.endContainer);

  if (!startPage || !endPage) {
    return [];
  }

  const first = Math.min(startPage.number, endPage.number);
  const last = Math.max(startPage.number, endPage.number);
  const pages = [];

  for (let pageNumber = first; pageNumber <= last; pageNumber += 1) {
    const node = els.pdfViewer.querySelector(`.page[data-page-number="${pageNumber}"]`);
    if (node) {
      pages.push({ node, number: pageNumber });
    }
  }

  return pages;
}

function isClientRectInsidePageRect(rect, pageRect) {
  return (
    rect.top >= pageRect.top &&
    rect.bottom <= pageRect.bottom &&
    rect.left >= pageRect.left &&
    rect.right <= pageRect.right &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.width < pageRect.width * 0.98 &&
    rect.height < pageRect.height * 0.25
  );
}

function normalizeClientRect(rect, pageEl) {
  const pageRect = pageEl.getBoundingClientRect();

  if (rect.width < 2 || rect.height < 2) {
    return null;
  }

  return {
    pageNumber: Number(pageEl.dataset.pageNumber),
    leftRatio: (rect.left - pageRect.left) / pageRect.width,
    topRatio: (rect.top - pageRect.top) / pageRect.height,
    widthRatio: rect.width / pageRect.width,
    heightRatio: rect.height / pageRect.height
  };
}

function mergeLineRects(rects) {
  const sorted = [...rects].sort((a, b) => {
    return a.pageNumber - b.pageNumber || a.topRatio - b.topRatio || a.leftRatio - b.leftRatio;
  });
  const merged = [];

  for (const rect of sorted) {
    const previous = merged[merged.length - 1];
    const samePage = previous?.pageNumber === rect.pageNumber;
    const sameLine = samePage && Math.abs(previous.topRatio - rect.topRatio) < Math.max(previous.heightRatio, rect.heightRatio) * 0.7;
    const previousRight = previous ? previous.leftRatio + previous.widthRatio : 0;
    const closeEnough = rect.leftRatio <= previousRight + 0.018;

    if (previous && sameLine && closeEnough) {
      const left = Math.min(previous.leftRatio, rect.leftRatio);
      const top = Math.min(previous.topRatio, rect.topRatio);
      const right = Math.max(previous.leftRatio + previous.widthRatio, rect.leftRatio + rect.widthRatio);
      const bottom = Math.max(previous.topRatio + previous.heightRatio, rect.topRatio + rect.heightRatio);
      previous.leftRatio = left;
      previous.topRatio = top;
      previous.widthRatio = right - left;
      previous.heightRatio = bottom - top;
    } else {
      merged.push({ ...rect });
    }
  }

  return merged;
}

function getSelectionCapture(selection) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return { exactText: "", pageNumber: state.currentPage, rects: [] };
  }

  const range = selection.getRangeAt(0);
  if (!els.pdfContainer.contains(range.commonAncestorContainer)) {
    return { exactText: "", pageNumber: state.currentPage, rects: [] };
  }

  const pages = getPagesFromRange(range);
  const rects = [];

  if (pages.length === 0) {
    return { exactText: selection.toString(), pageNumber: state.currentPage, rects };
  }

  for (const clientRect of Array.from(range.getClientRects())) {
    for (const page of pages) {
      const pageRect = page.node.getBoundingClientRect();
      if (!isClientRectInsidePageRect(clientRect, pageRect)) {
        continue;
      }

      const normalized = normalizeClientRect(clientRect, page.node);
      if (normalized) {
        rects.push(normalized);
      }
    }
  }

  return {
    exactText: selection.toString(),
    pageNumber: pages[0].number,
    rects: mergeLineRects(rects)
  };
}

function getPdfSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!els.pdfContainer.contains(range.commonAncestorContainer)) {
    return null;
  }

  return selection;
}

function clearPdfSelection() {
  const selection = getPdfSelection();
  if (!selection) {
    return false;
  }

  selection.removeAllRanges();
  if (els.pdfContainer.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  setStatus("Selection cleared.");
  return true;
}

function ensureHighlightLayer(pageEl) {
  let layer = pageEl.querySelector(":scope > .highlight-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "highlight-layer";
    pageEl.append(layer);
  }
  return layer;
}

function drawHighlightRects(rects) {
  for (const rect of rects) {
    const pageEl = els.pdfViewer.querySelector(`.page[data-page-number="${rect.pageNumber}"]`);
    if (!pageEl) {
      continue;
    }

    const layer = ensureHighlightLayer(pageEl);
    const pageWidth = pageEl.clientWidth;
    const pageHeight = pageEl.clientHeight;
    const mark = document.createElement("div");
    mark.className = "highlight-rect";
    mark.style.left = `${rect.leftRatio * pageWidth}px`;
    mark.style.top = `${rect.topRatio * pageHeight}px`;
    mark.style.width = `${rect.widthRatio * pageWidth}px`;
    mark.style.height = `${rect.heightRatio * pageHeight}px`;
    layer.append(mark);
  }
}

function redrawVisualHighlights() {
  for (const layer of els.pdfViewer.querySelectorAll(".highlight-layer")) {
    layer.innerHTML = "";
  }
  drawHighlightRects(state.visualHighlights);
}

function redrawVisualHighlightsSoon() {
  window.requestAnimationFrame(() => {
    redrawVisualHighlights();
    window.setTimeout(redrawVisualHighlights, 80);
  });
}

function getHighlightRectsForPdf(highlights = [], pdfName = state.pdfName) {
  return highlights
    .filter((item) => item.pdfName === pdfName && Array.isArray(item.rects))
    .flatMap((item) => item.rects);
}

async function loadStoredHighlightsForPdf() {
  if (!state.pdfName) {
    state.visualHighlights = [];
    renderCaptureList([]);
    return;
  }

  const result = await window.notionPdf.listCaptures();
  state.visualHighlights = getHighlightRectsForPdf(result.highlights);
  renderVisibleCaptures(result.highlights);
  redrawVisualHighlightsSoon();
}

async function renderPdf(pdfData) {
  state.isRendering = true;
  state.pdfName = pdfData.name;
  state.currentPage = 1;
  state.scale = ZOOM_DEFAULT;
  state.visualHighlights = [];
  setBusy(true);
  els.pdfName.textContent = pdfData.name;
  els.pdfContainer.style.display = "block";
  els.emptyState.style.display = "none";
  initializePdfViewer();

  const loadingTask = pdfjsLib.getDocument({ data: bytesToUint8Array(pdfData.bytes) });
  state.pdf = await loadingTask.promise;
  state.linkService.setDocument(state.pdf);
  state.findController.setDocument(state.pdf);
  state.pdfViewer.setDocument(state.pdf);
  updatePageMeta(1);
  await loadStoredHighlightsForPdf();
}

async function openPdf() {
  const pdfData = await window.notionPdf.openPdf();
  if (!pdfData) {
    return;
  }
  await renderPdf(pdfData);
}

async function setZoom(nextScale) {
  if (!state.pdf || state.isRendering) {
    return;
  }

  const bounded = Math.min(Math.max(nextScale, ZOOM_MIN), ZOOM_MAX);
  if (Math.abs(bounded - state.scale) < 0.01) {
    return;
  }

  state.scale = Number(bounded.toFixed(2));
  state.pdfViewer.currentScale = state.scale;
  updateZoomControls();
  redrawVisualHighlightsSoon();
}

function setScaleMode(scaleMode) {
  if (!state.pdf || state.isRendering) {
    return;
  }

  state.pdfViewer.currentScaleValue = scaleMode;
  updateZoomControls();
  redrawVisualHighlightsSoon();
}

async function zoomIn() {
  await setZoom(state.scale + ZOOM_STEP);
}

async function zoomOut() {
  await setZoom(state.scale - ZOOM_STEP);
}

async function resetZoom() {
  await setZoom(ZOOM_DEFAULT);
}

function fitWidth() {
  setScaleMode("page-width");
}

function fitPage() {
  setScaleMode("page-fit");
}

function getFindState(type = "", findPrevious = false) {
  return {
    source: els.searchPdf,
    type,
    query: els.searchPdf.value,
    phraseSearch: true,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious,
    matchDiacritics: true
  };
}

function runFind(type = "", findPrevious = false) {
  if (!state.pdf || !state.eventBus) {
    return;
  }

  const query = els.searchPdf.value.trim();
  updateFindControls();

  if (!query) {
    state.eventBus.dispatch("findbarclose", { source: els.searchPdf });
    return;
  }

  state.eventBus.dispatch("find", getFindState(type, findPrevious));
}

function scheduleFind() {
  window.clearTimeout(state.findTimer);
  updateFindControls();
  state.findTimer = window.setTimeout(() => runFind(""), 180);
}

function findNext() {
  runFind("again", false);
}

function findPrevious() {
  runFind("again", true);
}

async function captureHighlight() {
  if (state.isRendering || state.isSyncing) {
    return;
  }

  const selection = window.getSelection();
  const { exactText, pageNumber, rects } = getSelectionCapture(selection);

  if (!exactText.trim()) {
    setStatus("Select text in the PDF before capturing.", "error");
    return;
  }

  if (rects.length === 0) {
    setStatus("Could not locate that selection on the PDF page.", "error");
    return;
  }

  state.visualHighlights.push(...rects);
  drawHighlightRects(rects);
  window.getSelection()?.removeAllRanges();
  state.isSyncing = true;
  setBusy(true);
  setStatus("Generating question and syncing to Notion...");

  try {
    const result = await window.notionPdf.createCapture({
      exactText,
      pdfName: state.pdfName,
      pageNumber,
      rects
    });

    rememberSessionCapture(result.record);
    renderVisibleCaptures(result.highlights);

    if (result.duplicate) {
      setStatus("This highlight was already synced.", "success");
    } else if (result.ok) {
      setStatus("Question toggle added to Notion.", "success");
    } else {
      setStatus(`Saved for retry: ${result.error}`, "error");
    }
  } finally {
    state.isSyncing = false;
    setBusy(false);
  }
}

async function removeCapture(hash) {
  if (!hash || state.isSyncing) {
    return;
  }

  const shouldRemove = window.confirm("Remove this highlight and its Notion toggle?");
  if (!shouldRemove) {
    return;
  }

  state.isSyncing = true;
  setBusy(true);
  setStatus("Removing highlight and Notion toggle...");

  try {
    const result = await window.notionPdf.deleteCapture(hash);
    state.sessionCaptureHashes.delete(hash);
    state.visualHighlights = getHighlightRectsForPdf(result.highlights);
    redrawVisualHighlightsSoon();
    renderVisibleCaptures(result.highlights);

    if (result.ok && result.localOnly) {
      setStatus(result.warning || "Local highlight removed.", "success");
    } else if (result.ok) {
      setStatus("Highlight removed and Notion toggle deleted.", "success");
    } else {
      setStatus(`Highlight removed locally. Notion delete queued: ${result.error}`, "error");
    }
  } finally {
    state.isSyncing = false;
    setBusy(false);
  }
}

function handlePdfContextMenu(event) {
  if (!state.pdf || state.isRendering || state.isSyncing) {
    return;
  }

  const selection = window.getSelection();
  const { exactText } = getSelectionCapture(selection);

  if (!exactText.trim()) {
    return;
  }

  event.preventDefault();
  captureHighlight();
}

function handlePdfMouseDown(event) {
  if (event.button !== 2 || !state.pdf) {
    return;
  }

  const selection = window.getSelection();
  const { exactText } = getSelectionCapture(selection);

  if (exactText.trim()) {
    event.preventDefault();
  }
}

function handlePdfWheel(event) {
  if (!state.pdf || !event.ctrlKey) {
    return;
  }

  event.preventDefault();

  if (event.deltaY < 0) {
    zoomIn();
  } else {
    zoomOut();
  }
}

function handleKeyDown(event) {
  const isControlShortcut = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (key === "escape" && clearPdfSelection()) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return;
  }

  if (isControlShortcut && key === "z" && clearPdfSelection()) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return;
  }

  if (!isControlShortcut) {
    return;
  }

  if (key === "f") {
    event.preventDefault();
    els.searchPdf.focus();
    els.searchPdf.select();
  } else if (key === "+" || key === "=") {
    event.preventDefault();
    zoomIn();
  } else if (key === "-") {
    event.preventDefault();
    zoomOut();
  } else if (key === "0") {
    event.preventDefault();
    resetZoom();
  }
}

async function retryQueue() {
  setBusy(true);
  setStatus("Retrying failed captures...");

  try {
    const result = await window.notionPdf.retryQueue();
    for (const retryResult of result.results || []) {
      rememberSessionCapture(retryResult.record);
    }
    renderVisibleCaptures(result.highlights);
    setStatus(result.ok ? "Queue synced." : "Some captures still failed.", result.ok ? "success" : "error");
  } finally {
    setBusy(false);
  }
}

els.saveSettings.addEventListener("click", saveSettings);
els.validateSettings.addEventListener("click", validateSettings);
els.aiProvider.addEventListener("change", () => {
  updateProviderFields();
  setProviderStatus("openai", "missing", "Save setup to check");
});
els.openPdf.addEventListener("click", openPdf);
els.captureHighlight.addEventListener("click", captureHighlight);
els.searchPdf.addEventListener("input", scheduleFind);
els.searchPdf.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runFind("again", event.shiftKey);
  }
});
els.searchPrevious.addEventListener("click", findPrevious);
els.searchNext.addEventListener("click", findNext);
els.zoomOut.addEventListener("click", zoomOut);
els.zoomReset.addEventListener("click", resetZoom);
els.zoomIn.addEventListener("click", zoomIn);
els.fitWidth.addEventListener("click", fitWidth);
els.fitPage.addEventListener("click", fitPage);
els.retryQueue.addEventListener("click", retryQueue);
els.captureList.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".remove-capture");
  if (removeButton) {
    removeCapture(removeButton.dataset.hash);
  }
});
els.pdfContainer.addEventListener("mousedown", handlePdfMouseDown);
els.pdfContainer.addEventListener("contextmenu", handlePdfContextMenu);
els.pdfContainer.addEventListener("wheel", handlePdfWheel, { passive: false });
els.pdfContainer.addEventListener("scroll", () => {
  if (state.pdfViewer) {
    updatePageMeta(state.pdfViewer.currentPageNumber);
  }
});
document.addEventListener("keydown", handleKeyDown, true);

await loadSettings();
await refreshCaptures();
await refreshConnectionStatus();
updateFindControls();
updateZoomControls();
