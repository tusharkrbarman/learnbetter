# LearnBetter

[![CI](https://github.com/tusharkrbarman/learnbetter/actions/workflows/ci.yml/badge.svg)](https://github.com/tusharkrbarman/learnbetter/actions/workflows/ci.yml)
[![Build Windows Installer](https://github.com/tusharkrbarman/learnbetter/actions/workflows/build-installer.yml/badge.svg)](https://github.com/tusharkrbarman/learnbetter/actions/workflows/build-installer.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

LearnBetter is an open-source Windows desktop app that turns PDF highlights into study questions inside Notion.

Open a PDF, select important text, right-click, and LearnBetter creates a Notion toggle with:

- one grounded study question
- one AI-generated answer based only on the selected text
- the exact copied PDF text
- the book title and page number

Question generation runs locally with [Ollama](https://ollama.com/), so the app does not require an OpenAI API key or a hosted LLM subscription.

## Keywords

PDF reader, Notion study app, PDF highlights to Notion, local AI study questions, Ollama desktop app, local LLM, Notion toggle questions, AI flashcards, Electron PDF reader, PDF.js highlighter, Windows study app, open-source learning tool.

## Features

- Open PDFs in a minimalist Windows desktop reader.
- Select text normally with the left mouse button.
- Right-click selected text to capture it.
- Generate a study question and AI answer with a local model served by Ollama.
- Append each capture to one Notion page as a toggle block.
- Preserve the copied answer text exactly as selected from the PDF.
- Keep multi-line highlights together as one capture.
- Reload saved highlights when the same PDF is opened again.
- Match PDFs by fingerprint and content signature, not just filename.
- Restore highlights when a PDF is re-saved without meaningful text changes.
- Prevent duplicate captures while a sync is pending.
- Queue failed Notion sync and delete operations for retry.
- Support Notion internal integration tokens and Notion OAuth.
- Build a Windows installer with GitHub Actions.

## How It Works

```text
PDF selection -> right-click capture -> Ollama question/answer -> Notion toggle
```

Notion output:

```text
> AI-generated study question
  AI answer
  Concise answer generated from the selected text.

  Copied text
  Exact highlighted PDF text.

  Source: Book title, page number
```

The copied text is never paraphrased, summarized, corrected, or rewritten.

## Download

The Windows installer is published through GitHub Releases.

1. Open [LearnBetter Releases](https://github.com/tusharkrbarman/learnbetter/releases).
2. Download the latest Windows installer `.exe`.
3. Run the installer.
4. Start LearnBetter from the Start menu or desktop shortcut.

If you are testing a pre-release build, choose the latest release marked as a pre-release.

## Requirements

- Windows 10 or Windows 11
- A Notion account
- A Notion page where LearnBetter can append toggles
- Ollama installed and running locally
- One local model, such as `gemma4:e4b`, pulled with Ollama

For development from source, you also need:

- Node.js 22 or later
- npm
- Git

## Quick Start

1. Install Ollama.
2. Pull a local model with Ollama.
3. Create a Notion page for your study questions.
4. Share that page with your Notion integration.
5. Open LearnBetter.
6. Paste your Notion page link and Ollama settings.
7. Open a PDF.
8. Select text with the left mouse button.
9. Right-click the selected text to capture it.
10. Open Notion and check the new toggle.

## Set Up Ollama

LearnBetter uses Ollama to generate questions and AI answers locally on your computer.

### 1. Install Ollama On Windows

1. Download Ollama from the official Windows page: [ollama.com/download/windows](https://ollama.com/download/windows).
2. Run the installer.
3. After installation, Ollama should run in the background.

### 2. Check That Ollama Works

Open PowerShell and run:

```powershell
ollama --version
```

You can also check which models are installed:

```powershell
ollama list
```

If Ollama is running, its local API is usually available at:

```text
http://localhost:11434
```

### 3. Pull The Recommended Model

LearnBetter defaults to `gemma4:e4b`.

Pull it with:

```powershell
ollama pull gemma4:e4b
```

This download can take time because the model is large.

### 4. Test The Model

Run:

```powershell
ollama run gemma4:e4b
```

Then type:

```text
Write one study question about operating systems.
```

To exit the chat, type:

```text
/bye
```

### 5. Configure Ollama In LearnBetter

In LearnBetter, use:

```text
AI provider: Ollama local
Local model URL: http://localhost:11434
Local model: gemma4:e4b
```

Click `Save Setup`, then click `Check`.

### Ollama Troubleshooting

If LearnBetter says local AI is not running:

- Start Ollama from the Start menu.
- Run `ollama --version` in PowerShell.
- Keep the Ollama app running, then click `Retry` or `Check` in LearnBetter.

If LearnBetter says the model is missing:

```powershell
ollama pull gemma4:e4b
```

If generation is slow:

- The first request after startup can be slower.
- Local generation speed depends on CPU, GPU, RAM, and model size.
- You can use a smaller Ollama model and update the local model name in LearnBetter.

## Set Up Notion

LearnBetter needs permission to append blocks to one destination Notion page.

The easiest personal setup is a Notion internal integration token. OAuth is also supported for a more public-app style flow.

### Option 1: Internal Integration Token

Use this option if you are setting up LearnBetter for yourself.

1. Open the Notion integrations page: [notion.so/my-integrations](https://www.notion.so/my-integrations).
2. Create a new internal integration.
3. Give it a clear name, such as `LearnBetter`.
4. Copy the internal integration token.
5. In Notion, create a normal page where you want study questions to appear.
6. Open that page.
7. Click the `...` menu in the top-right corner.
8. Choose `Add connections`.
9. Search for your `LearnBetter` integration.
10. Add it to the page and confirm access.
11. Copy the Notion page URL from your browser or Notion app.
12. Open LearnBetter.
13. Choose `Internal token`.
14. Paste the Notion token.
15. Paste the Notion page URL or page ID.
16. Click `Save Setup`.
17. Click `Check`.

If the page is not shared with the integration, Notion will reject the request even if your token is correct.

### Option 2: Notion OAuth

Use this option if you want to test a public integration flow.

1. Create or open a Notion public integration.
2. Add this redirect URI:

```text
http://127.0.0.1:45891/notion/callback
```

3. Copy the OAuth client ID and client secret.
4. In LearnBetter, choose `OAuth`.
5. Paste the client ID and client secret.
6. Paste the destination Notion page URL or page ID.
7. Click `Connect Notion`.
8. Approve the Notion connection in the browser.
9. Return to LearnBetter and click `Check`.

OAuth connects your workspace, but LearnBetter still needs the destination page URL or page ID so it knows where to append toggles.

### Finding The Notion Page ID

You can paste the full Notion page URL into LearnBetter. The app will extract the page ID automatically.

A Notion page ID is a 32-character identifier at the end of a Notion page URL. LearnBetter accepts either:

```text
https://www.notion.so/workspace/My-Study-Page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

or:

```text
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

### Notion Troubleshooting

If LearnBetter says the page is inaccessible:

- Open the destination page in Notion.
- Click `...`.
- Click `Add connections`.
- Add your LearnBetter integration.
- Click `Check` again in LearnBetter.

If LearnBetter says the page URL is invalid:

- Paste the full Notion page URL again.
- Or paste only the 32-character page ID.
- Make sure you are using a page, not a database view URL.

If OAuth is connected but the page is missing:

- Paste the destination page URL or page ID in LearnBetter.
- Save setup again.

## Using LearnBetter

1. Start Ollama.
2. Start LearnBetter.
3. Confirm Notion and local AI both show as connected.
4. Click `Open PDF`.
5. Select text with the left mouse button.
6. Right-click the selected text.
7. Wait for the capture status to finish generating and syncing.
8. Open your Notion page.
9. Expand the new toggle to see the AI answer and exact copied text.

Keyboard shortcuts:

- `Esc`: clear the current PDF text selection.
- `Ctrl+Z`: clear the current PDF text selection.
- `Ctrl+F`: search inside the PDF.
- `Ctrl++`: zoom in.
- `Ctrl+-`: zoom out.
- `Ctrl+0`: reset zoom.

## Offline And Retry Behavior

LearnBetter separates local question generation from Notion sync.

- If Ollama is running but the internet is offline, LearnBetter can still generate the question and AI answer locally.
- If Notion sync fails, the capture stays in the retry queue.
- Click `Retry` after reconnecting.
- Duplicate captures are blocked while the same highlight is already pending.
- Repeated failures are capped so the queue does not grow forever.

## Removing Captures

When you remove a capture, LearnBetter removes the local highlight and tries to delete the related Notion toggle.

If Notion delete fails:

- the local highlight is removed
- the Notion cleanup stays in the retry queue
- LearnBetter shows that Notion cleanup is pending

Click `Retry` after fixing the Notion connection.

## Development From Source

Clone and run:

```powershell
git clone https://github.com/tusharkrbarman/learnbetter.git
cd learnbetter
npm install
npm start
```

Useful scripts:

```powershell
npm run check
npm run icons
npm run dist:win
```

Script details:

- `npm run check`: validates required project files.
- `npm run icons`: regenerates app icon assets.
- `npm run dist:win`: builds a Windows NSIS installer in `dist/`.

Syntax checks:

```powershell
node --check src/main/main.js
node --check src/main/preload.js
node --check src/renderer/renderer.mjs
```

## Project Structure

```text
src/main/        Electron main process, Notion API, Ollama API, local store
src/renderer/    PDF reader UI, PDF.js viewer, highlight capture
assets/          App icons and visual assets
site/            Static download website
deploy/          Kubernetes and Argo CD examples
.github/         CI, installer build, release, Pages, Dependabot
```

## Tech Stack

- Electron
- PDF.js
- Notion API
- Ollama API
- electron-store
- electron-builder
- GitHub Actions
- GitHub Pages
- Kubernetes manifests
- Argo CD application manifest
- Dependabot

## Website

The `site/` folder contains a minimalist static website for LearnBetter.

Preview locally:

```powershell
cd site
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

The simple production path deploys `site/` to GitHub Pages through `.github/workflows/pages.yml`.

## CI/CD

This repository includes:

- `CI`: project checks, syntax checks, and high-severity npm audit.
- `Build Windows Installer`: Windows `.exe` installer build.
- `Release Installer`: uploads the installer to a GitHub Release when a version tag is pushed.
- `Deploy Website`: publishes the static website to GitHub Pages.
- `Dependabot`: checks npm dependencies and GitHub Actions updates.

Create a release build:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

## Privacy And Security

- LearnBetter does not need an OpenAI key.
- Highlight text is sent to your local Ollama server for question and answer generation.
- Notion receives the generated question, generated answer, exact copied text, and source metadata.
- Notion tokens and setup data are stored locally with Electron Store under the app name `learnbetter`.
- Do not commit Notion tokens, OAuth secrets, `.env` files, certificates, or keys.

The repository ignores dependency folders, build outputs, local cache files, `.env`, `.env.*`, certificate files, and key files.

## Open Source

LearnBetter is open source under the MIT License.

Issues, feature requests, and pull requests are welcome. Good contribution areas include:

- Notion onboarding UX
- PDF highlighting edge cases
- Local model prompt quality
- Installer and release polish
- Accessibility
- Test coverage
- Documentation screenshots and demo videos

Before opening a pull request:

```powershell
npm install
npm run check
node --check src/main/main.js
node --check src/main/preload.js
node --check src/renderer/renderer.mjs
```

## Official Setup References

- [Notion API quick start](https://developers.notion.com/guides/get-started/quick-start)
- [Notion OAuth authorization](https://developers.notion.com/guides/get-started/authorization)
- [Ollama for Windows](https://ollama.com/download/windows)
- [Ollama Gemma 4 model](https://ollama.com/library/gemma4)

## License

LearnBetter is released under the [MIT License](LICENSE).
