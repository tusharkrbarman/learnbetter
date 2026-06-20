# LearnBetter

LearnBetter is a Windows-focused Electron PDF reader that turns highlighted PDF text into AI-generated study questions in Notion.

## What It Does

- Opens a PDF in a desktop reader.
- Lets you select text and capture it as one highlight.
- Generates one study question using OpenAI or a local Ollama model.
- Appends a Notion toggle block to an existing Notion page.
- Keeps the answer exactly equal to the highlighted text.
- Reloads saved highlights when the same PDF is opened again.
- Removes local highlights and the related Notion toggle for new captures.
- Queues failed sync/delete operations for retry.
- Prevents duplicate captures using a hash of PDF name, page number, and exact highlighted text.

## Notion Output

Each captured highlight appends one toggle to your chosen Notion page:

```text
> AI-generated question
  Exact highlighted PDF text
  Source: Book title, page number
```

## Setup

1. Create an internal Notion integration and copy its token.
2. Share your target Notion page with that integration.
3. Choose an AI provider:
   - OpenAI API key, or
   - Ollama running locally at `http://localhost:11434`.
4. Install dependencies:

```powershell
npm install
```

5. Start the app:

```powershell
npm start
```

6. In the app setup panel, paste:
   - Notion integration token
   - Notion page URL or page ID
   - AI provider settings
   - optional book title

## Usage

1. Open a PDF.
2. Select text with the left mouse button.
3. Right-click the selected text to capture it.
4. LearnBetter highlights the text, generates a question, and adds a Notion toggle.

## Scripts

```powershell
npm run check
```

Checks that required project files exist.

## Privacy And Secrets

Do not commit API keys or Notion tokens. LearnBetter stores setup data locally through Electron Store under the app name `learnbetter`.

The repository ignores `.env`, `.env.*`, certificate/key files, dependency folders, and build outputs.

## Notes

- ChatGPT subscriptions do not replace API keys for this app.
- Ollama can be used for local question generation without an OpenAI API key.
- The Notion destination is an existing page, not a database.
- Existing captures created before Notion block IDs were stored can be removed locally, but their old Notion toggles cannot be deleted automatically.
