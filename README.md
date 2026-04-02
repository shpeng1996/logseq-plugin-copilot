# Logseq Copilot

Talk to AI about your Logseq notes.

## Features

![demo](./demo.gif)

Logseq Copilot automatically indexes all your Logseq notes and includes relevant context in the
ChatGPT prompt. It doesn't matter which page you're currently on, this plugin will pull relevant
information from all of your notes.

Using a chat-like interface, you'll be able to discuss your notes with a Copilot and easily insert
note suggestions into Logseq.

## Usage

Be sure to add your OpenAI API key or use Codex OAuth in the [settings](#settings) page.

Use `ctrl-P` to bring up the Copilot interface and type in a question about your notes.

### Codex OAuth (OpenAI Subscription)

If you have a ChatGPT Plus/Pro subscription, you can use the Codex OAuth flow:
1. Go to plugin settings and set **Authentication Choice** to `openai-codex`.
2. Open the Logseq command palette (`ctrl-shift-P` or `cmd-shift-P`).
3. Run the command `Copilot: Codex Login (OpenAI Subscription)`.
4. Your browser will open. Sign in to OpenAI if prompted.
5. You will be redirected to a page that fails to load (e.g., `http://127.0.0.1:1455/...`). **Copy the full URL from the address bar.**
6. Go back to Logseq, open the command palette again, and run `Copilot: Codex Complete Login`.
7. Paste the URL you copied and hit Enter.

### Codex CLI Auth File

If you already use `codex login`, you can point the plugin at your local Codex auth file:
1. Run `codex login` in your terminal first.
2. In plugin settings, set **Authentication Choice** to `codex-cli-auth`.
3. Set **Codex Auth JSON Path** to your local auth file path. The default is `~/.codex/auth.json`.
4. Set **OpenAI Base URL** to `https://api.openai.com/v1`.
5. Set **OpenAI Model** to a Responses API model such as `gpt-5-codex` or `gpt-5.4`.

This path is experimental. It reads the Codex CLI session token locally and calls the Responses API
directly instead of using the plugin's older OAuth exchange flow.

## Settings

![settings](./settings.png)

- **Authentication Choice**: Choose between OpenAI API key, manual Codex OAuth, or a local Codex CLI session.
- **OpenAI API Key**: Your OpenAI API key (Platform API).
- **OpenAI Base URL**: If you have a proxy you'd like your OpenAI API calls to go through. For Codex OAuth, use `https://api.openai.com/v1`.
- **OpenAI Model**: The actual model the plugin will contact. For Codex auth modes, prefer `gpt-5-codex` or `gpt-5.4`.
- **Codex Auth JSON Path**: Path to the local Codex CLI auth file, usually `~/.codex/auth.json`.
- **Fast Mode**: Enables OpenAI priority processing (service_tier=priority).
- **Chat Dialog Shortcut**: The keyboard shortcut to bring up the chat dialog screen.
- **Vector Similarity Top K**: (Advanced) The number of vector search results that can be included
  in your prompt context.

## Support

Create an issue [here](https://github.com/chhabrakadabra/logseq-plugin-copilot/issues). Even better,
create a pull request!

## FAQ

### Can this plugin work with locally hosted LLMs?

Sure! As long as you can expose an OpenAI compatible API. For example, to work with
[Ollama](https://ollama.com/), you'll need to change the `OpenAI Base URL` setting to
`http://localhost:11434/v1`. You'll also need to
[adjust](https://github.com/ollama/ollama/blob/main/docs/faq.md#how-do-i-configure-ollama-server)
the [OLLAMA_ORIGINS environment
variable](https://github.com/ollama/ollama/blob/main/docs/faq.md#how-can-i-allow-additional-web-origins-to-access-ollama).
You'll need to allow the origin `logseq.io` or just set it to a wildcard `*` if it's appropriate.

## License

MIT License
