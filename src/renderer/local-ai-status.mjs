export function getModelInstallCommand(status) {
  if (status?.action !== "pull_model" || !String(status.model || "").trim()) {
    return "";
  }

  return `ollama pull ${String(status.model).trim()}`;
}
