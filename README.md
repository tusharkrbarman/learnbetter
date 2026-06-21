# LearnBetter

[![CI](https://github.com/tusharkrbarman/learnbetter/actions/workflows/ci.yml/badge.svg)](https://github.com/tusharkrbarman/learnbetter/actions/workflows/ci.yml)
[![Build Windows Installer](https://github.com/tusharkrbarman/learnbetter/actions/workflows/build-installer.yml/badge.svg)](https://github.com/tusharkrbarman/learnbetter/actions/workflows/build-installer.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

LearnBetter is an open-source Windows desktop PDF reader for students, readers, and researchers who want to turn PDF highlights into AI-generated study questions in Notion.

Select text in a PDF, right-click to capture it, and LearnBetter creates a Notion toggle where the title is an AI-generated question and the answer is the exact highlighted text. It supports OpenAI-compatible question generation, local Ollama models, Notion OAuth, Notion internal integrations, PDF.js highlighting, and GitHub Actions Windows installer builds.

## Keywords

PDF reader, AI study app, Notion integration, Notion toggle questions, PDF highlights to Notion, AI flashcards, Electron PDF reader, OpenAI study questions, Ollama local AI, Windows desktop app, PDF.js, spaced repetition workflow.

## Features

- Open PDFs in a minimalist Windows desktop reader.
- Select text normally with the left mouse button.
- Right-click selected text to capture the highlight.
- Generate one study question per highlight.
- Append each question to a Notion page as a toggle block.
- Keep the answer exactly equal to the selected PDF text.
- Preserve multi-line highlights and reload saved highlights when the same PDF is opened.
- Remove local highlights and delete the related Notion toggle for new captures.
- Prevent duplicate captures with a hash of PDF name, page number, and exact text.
- Queue failed Notion sync/delete operations for retry.
- Use OpenAI API or local Ollama models.
- Connect Notion with OAuth or an internal integration token.
- Build a Windows `.exe` installer with GitHub Actions.

## How It Works

```text
PDF selection -> right-click capture -> AI question -> Notion toggle
```

Notion output:

```text
> AI-generated question
  Exact highlighted PDF text
  Source: Book title, page number
```

The answer text is never paraphrased, summarized, corrected, or rewritten.

## Download

The Windows installer is built by GitHub Actions.

1. Open [Build Windows Installer](https://github.com/tusharkrbarman/learnbetter/actions/workflows/build-installer.yml).
2. Open the latest successful workflow run.
3. Download the `learnbetter-windows-installer` artifact.
4. Extract the artifact ZIP and run the installer `.exe`.

Artifacts are temporary. For long-term downloads, use tagged releases once release publishing is added.

## Quick Start From Source

Requirements:

- Windows 10 or later
- Node.js 22 or later
- npm
- Notion account
- OpenAI API key or local Ollama installation

Install and run:

```powershell
git clone https://github.com/tusharkrbarman/learnbetter.git
cd learnbetter
npm install
npm start
```

## Notion Setup

LearnBetter supports two Notion connection modes.

### Option 1: Notion OAuth

Use this when you want a cleaner public-app style setup.

1. Create a public Notion integration.
2. Add this redirect URI:

```text
http://127.0.0.1:45891/notion/callback
```

3. In LearnBetter, choose `OAuth`.
4. Paste your Notion OAuth client ID and client secret.
5. Paste the destination Notion page link or page ID.
6. Click `Connect Notion`.

Notion OAuth grants page access, but it does not normally return the ID of an existing selected page. LearnBetter still asks for the destination page link or ID so it knows where to append toggles.

### Option 2: Internal Integration Token

Use this for a simple personal setup.

1. Create an internal Notion integration.
2. Copy the integration token.
3. Share your target Notion page with that integration.
4. In LearnBetter, choose `Internal token`.
5. Paste the token and the destination Notion page link or page ID.
6. Save setup and check the connection status.

## AI Provider Setup

### OpenAI

Use an OpenAI API key and model name, for example:

```text
gpt-4o-mini
```

ChatGPT subscriptions do not replace API keys for this desktop app.

### Ollama

Run Ollama locally and choose `Ollama local` in LearnBetter.

Default settings:

```text
Ollama URL: http://localhost:11434
Model: llama3.1:8b
```

Ollama lets you generate questions locally without sending highlight text to an AI API provider.

## Usage

1. Open a PDF.
2. Select text with the left mouse button.
3. Right-click the selected text.
4. LearnBetter highlights the text, generates a question, and appends a Notion toggle.
5. Use `Retry` if a Notion or AI sync fails.

Keyboard shortcuts:

- `Esc`: clear current PDF text selection.
- `Ctrl+Z`: clear current PDF text selection.
- `Ctrl+F`: search inside the PDF.
- `Ctrl++`, `Ctrl+-`, `Ctrl+0`: zoom controls.

## Development

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

Tech stack:

- Electron
- PDF.js
- Notion API
- OpenAI API
- Ollama API
- electron-store
- electron-builder
- GitHub Actions
- Dependabot

## CI/CD

This repository includes:

- `CI`: runs project checks, syntax checks, and high-severity npm audit.
- `Build Windows Installer`: builds a Windows `.exe` installer and uploads it as an artifact.
- `Dependabot`: checks npm dependencies and GitHub Actions updates.

The installer workflow can be triggered manually from GitHub Actions or automatically by pushing a version tag like:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

## Roadmap

- Store secrets in Windows Credential Manager.
- Add GitHub Releases for permanent installer downloads.
- Add screenshots and demo GIFs.
- Add automated smoke tests for the Electron main process.
- Improve Notion OAuth onboarding messages.
- Add import/export/reset settings tools.
- Add optional spaced-repetition review mode.

## Privacy And Security

- API keys and Notion tokens should never be committed.
- Local setup data is stored with Electron Store under the app name `learnbetter`.
- Highlight text is sent to the selected AI provider only when generating a question.
- If Ollama is selected, question generation can run locally.
- Notion receives captured highlights because it stores the generated question toggles.

The repository ignores `.env`, `.env.*`, certificate/key files, dependency folders, build outputs, and local cache files.

## Contributing

Issues, feature requests, and pull requests are welcome.

Good first contribution areas:

- README screenshots
- Notion setup UX
- Installer/release automation
- PDF highlighting edge cases
- Local model provider improvements
- Test coverage

Before opening a pull request:

```powershell
npm install
npm run check
node --check src/main/main.js
node --check src/main/preload.js
node --check src/renderer/renderer.mjs
```

## License

LearnBetter is released under the [MIT License](LICENSE).
