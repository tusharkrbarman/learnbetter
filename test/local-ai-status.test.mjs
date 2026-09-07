import assert from "node:assert/strict";
import test from "node:test";

import { getModelInstallCommand } from "../src/renderer/local-ai-status.mjs";

test("offers the configured pull command only when the model is missing", () => {
  assert.equal(
    getModelInstallCommand({ action: "pull_model", model: "gemma4:e4b" }),
    "ollama pull gemma4:e4b"
  );
  assert.equal(getModelInstallCommand({ status: "error", model: "gemma4:e4b" }), "");
});
