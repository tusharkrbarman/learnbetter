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

1. Choose a Notion connection method:
   - Internal token: create an internal Notion integration, copy its token, and share your target page with it.
   - OAuth: create a public Notion integration, add `http://127.0.0.1:45891/notion/callback` as a redirect URI, then use Connect Notion in the app.
2. Paste the destination Notion page link or page ID.
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
   - Notion token, or OAuth client ID/client secret
   - Notion page URL or page ID
   - AI provider settings
   - optional book title

## Notion OAuth Notes

OAuth replaces manually pasting an internal integration token. It opens Notion in your browser, lets you pick pages to share with the public integration, then stores the returned access token locally.

Notion's OAuth page picker grants access to selected pages, but it does not normally return the ID of an existing selected page. LearnBetter still asks for the destination page link or ID so it knows where to append toggles. If your public integration uses Notion's optional template duplication flow, LearnBetter can use the duplicated template page ID returned by OAuth.

## Usage

1. Open a PDF.
2. Select text with the left mouse button.
3. Right-click the selected text to capture it.
4. LearnBetter highlights the text, generates a question, and adds a Notion toggle.

## Scripts

```powershell
npm run check
npm run dist:win
```

Checks that required project files exist.

`npm run dist:win` builds a Windows NSIS installer in `dist/`.

## Installer Artifacts

The `Build Windows Installer` GitHub Actions workflow builds the Windows `.exe` installer and uploads it as the `learnbetter-windows-installer` artifact.

Run it from GitHub with **Actions > Build Windows Installer > Run workflow**. It also runs automatically when a version tag like `v0.1.0` is pushed.

## Privacy And Secrets

Do not commit API keys or Notion tokens. LearnBetter stores setup data locally through Electron Store under the app name `learnbetter`.

The repository ignores `.env`, `.env.*`, certificate/key files, dependency folders, and build outputs.

## Notes

- ChatGPT subscriptions do not replace API keys for this app.
- Ollama can be used for local question generation without an OpenAI API key.
- The Notion destination is an existing page, not a database.
- Existing captures created before Notion block IDs were stored can be removed locally, but their old Notion toggles cannot be deleted automatically.
