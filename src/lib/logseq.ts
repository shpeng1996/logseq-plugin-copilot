import "@logseq/libs";
import { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin";
import { generatePkce, generateState, getAuthorizeUrl, exchangeCodeForToken, refreshAccessToken } from "./oauth";
import { getDefaultCodexAuthPath } from "./codexAuth";

export const settingsSchema: SettingSchemaDesc[] = [
    {
        key: "OPENAI_AUTH_CHOICE",
        type: "enum",
        default: "openai-api-key",
        title: "Authentication Choice",
        description: "Choose between OpenAI API key, manual Codex OAuth, or a local Codex CLI session.",
        enumChoices: ["openai-api-key", "openai-codex", "codex-cli-auth"],
        enumPicker: "select"
    },
    {
        key: "OPENAI_API_KEY",
        type: "string",
        default: "",
        title: "OpenAI API Key",
        description: "Your OpenAI API key (Platform API).",
    },
    {
        key: "OPENAI_BASE_URL",
        type: "string",
        default: "https://api.openai.com/v1",
        title: "OpenAI Base URL",
        description: "The base URL for the OpenAI API. For Codex OAuth, use your proxy URL (e.g., from OpenClaw) or 'https://api.openai.com/v1'. Direct Codex usage often requires 'https://chatgpt.com/backend-api' via a gateway.",
    },
    {
        key: "OPENAI_MODEL",
        type: "string",
        default: "gpt-4o-mini",
        title: "OpenAI Model",
        description: "The OpenAI model to use. For Codex auth modes, prefer a Responses API model like 'gpt-5-codex' or 'gpt-5.4'.",
    },
    {
        key: "CODEX_AUTH_JSON_PATH",
        type: "string",
        default: getDefaultCodexAuthPath(),
        title: "Codex Auth JSON Path",
        description: "Path to the Codex CLI auth file. Used only when Authentication Choice is 'codex-cli-auth'.",
    },
    {
        key: "OPENAI_FAST_MODE",
        type: "boolean",
        default: false,
        title: "Fast Mode",
        description: "Enables priority processing (service_tier=priority) for both OpenAI and Codex sessions.",
    },
    {
        key: "OPENAI_STORE_REQUESTS",
        type: "boolean",
        default: true,
        title: "Store Requests",
        description: "Whether to store request/response data in OpenAI's system (required for some Codex features and dashboard visibility).",
    },
    {
        key: "CHAT_DIALOG_SHORTCUT",
        type: "string",
        default: "mod+p",
        title: "Chat Dialog Shortcut",
        description: "The shortcut to open the chat dialog",
    },
    {
        key: "OAUTH_REDIRECT_URL",
        type: "string",
        default: "",
        title: "OAuth Redirect URL (Paste here)",
        description: "Paste the full redirect URL (http://localhost:1455/auth/callback?code=...) here, then run 'Copilot: Codex Complete Login'.",
    },
    {
        key: "OAUTH_ACCESS_TOKEN",
        type: "string",
        default: "",
        title: "OAuth Access Token (Auto-filled)",
        description: "Stored OAuth access token for Codex.",
    },
    {
        key: "OAUTH_REFRESH_TOKEN",
        type: "string",
        default: "",
        title: "OAuth Refresh Token (Auto-filled)",
        description: "Stored OAuth refresh token for Codex.",
    },
    {
        key: "OAUTH_EXPIRES_AT",
        type: "number",
        default: 0,
        title: "OAuth Expires At (Auto-filled)",
        description: "OAuth token expiration timestamp.",
    },
    {
        key: "OAUTH_PKCE_VERIFIER",
        type: "string",
        default: "",
        title: "OAuth PKCE Verifier (Internal)",
        description: "Stored verifier for the ongoing OAuth flow.",
    }
]

export async function logseqSetup() {
    logseq.useSettingsSchema(settingsSchema);

    logseq.App.registerCommandPalette(
        {
            key: "Open Copilot",
            label: "Open Copilot",
            keybinding: { binding: logseq.settings!["CHAT_DIALOG_SHORTCUT"] as string }
        },
        async () => {
            const authChoice = logseq.settings!["OPENAI_AUTH_CHOICE"] as string;
            const apiKey = logseq.settings!["OPENAI_API_KEY"] as string;
            const accessToken = logseq.settings!["OAUTH_ACCESS_TOKEN"] as string;

            if (authChoice === "openai-api-key" && !apiKey) {
                logseq.UI.showMsg(
                    "Please set your OpenAI API key in the Logseq Copilot plugin settings.",
                    "error"
                );
                return;
            }

            if (authChoice === "openai-codex" && !accessToken) {
                logseq.UI.showMsg(
                    "Please login via 'Copilot: Codex Login' command first.",
                    "error"
                );
                return;
            }

            if (authChoice === "codex-cli-auth") {
                const authPath = logseq.settings!["CODEX_AUTH_JSON_PATH"] as string;
                if (!authPath) {
                    logseq.UI.showMsg(
                        "Please set the Codex auth.json path in plugin settings.",
                        "error"
                    );
                    return;
                }
            }

            logseq.showMainUI({ autoFocus: true });
            setTimeout(() => {
                document.getElementById("logseq-copilot-search")?.focus();
            }, 100);
        }
    );

    logseq.App.registerCommandPalette(
        {
            key: "Codex Login",
            label: "Copilot: Codex Login (OpenAI Subscription)",
        },
        async () => {
            const { verifier, challenge } = await generatePkce();
            const state = generateState();
            logseq.updateSettings({ OAUTH_PKCE_VERIFIER: verifier });
            const url = getAuthorizeUrl(challenge, state);
            logseq.App.openExternalLink(url);
            logseq.UI.showMsg("Opened browser for OpenAI login. After login, paste the redirect URL into plugin settings, then run 'Copilot: Codex Complete Login'.", "info");
        }
    );

    logseq.App.registerCommandPalette(
        {
            key: "Codex Complete Login",
            label: "Copilot: Codex Complete Login",
        },
        async () => {
            const input = logseq.settings!["OAUTH_REDIRECT_URL"] as string;
            if (!input) {
                logseq.UI.showMsg("Please paste the redirect URL into the plugin settings first.", "error");
                return;
            }

            try {
                const url = new URL(input.trim());
                const code = url.searchParams.get("code");
                if (!code) throw new Error("No code found in URL. Make sure you copied the full address.");

                const verifier = logseq.settings!["OAUTH_PKCE_VERIFIER"] as string;
                if (!verifier) throw new Error("No PKCE verifier found. Please run 'Codex Login' again.");

                logseq.UI.showMsg("Exchanging code for token...", "info");
                const tokens = await exchangeCodeForToken(code, verifier);

                logseq.updateSettings({
                    OAUTH_ACCESS_TOKEN: tokens.access_token,
                    OAUTH_REFRESH_TOKEN: tokens.refresh_token,
                    OAUTH_EXPIRES_AT: Date.now() + tokens.expires_in * 1000,
                    OAUTH_PKCE_VERIFIER: "", // Clear verifier
                    OAUTH_REDIRECT_URL: "", // Clear the input field
                });

                logseq.UI.showMsg("Codex Login successful!", "success");
            } catch (e) {
                logseq.UI.showMsg(`Login failed: ${e instanceof Error ? e.message : String(e)}`, "error");
            }
        }
    );

    logseq.setMainUIInlineStyle({ zIndex: 100 });
}

export async function ensureValidToken(): Promise<string | null> {
    const authChoice = logseq.settings!["OPENAI_AUTH_CHOICE"] as string;
    if (authChoice !== "openai-codex") return null;

    const accessToken = logseq.settings!["OAUTH_ACCESS_TOKEN"] as string;
    const refreshToken = logseq.settings!["OAUTH_REFRESH_TOKEN"] as string;
    const expiresAt = logseq.settings!["OAUTH_EXPIRES_AT"] as number;

    if (!accessToken) return null;

    // Refresh if expiring in less than 5 minutes
    if (Date.now() + 5 * 60 * 1000 > expiresAt) {
        if (!refreshToken) return accessToken; // Can't refresh

        try {
            const tokens = await refreshAccessToken(refreshToken);
            logseq.updateSettings({
                OAUTH_ACCESS_TOKEN: tokens.access_token,
                OAUTH_REFRESH_TOKEN: tokens.refresh_token,
                OAUTH_EXPIRES_AT: Date.now() + tokens.expires_in * 1000,
            });
            return tokens.access_token;
        } catch (e) {
            console.error("Token refresh failed", e);
            return accessToken; // Try with old token
        }
    }

    return accessToken;
}

export class Theme {
    private static camelToKebab(str: string): string {
        return str.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    }
    private static defaultProps = {
        primaryBackgroundColor: "slate",
        secondaryBackgroundColor: "slate",
        tertiaryBackgroundColor: "slate",
        quaternaryBackgroundColor: "slate",
        activePrimaryColor: "white",
        activeSecondaryColor: "white",
        borderColor: "slate",
        secondaryBorderColor: "slate",
        tertiaryBorderColor: "slate",
        primaryTextColor: "white",
        secondaryTextColor: "white",
        blockHighlightColor: "slate"
    }

    constructor(
        public props: {
            primaryBackgroundColor: string;
            secondaryBackgroundColor: string;
            tertiaryBackgroundColor: string;
            quaternaryBackgroundColor: string;
            activePrimaryColor: string;
            activeSecondaryColor: string;
            borderColor: string;
            secondaryBorderColor: string;
            tertiaryBorderColor: string;
            primaryTextColor: string;
            secondaryTextColor: string;
            blockHighlightColor: string;
        } = Theme.defaultProps,
    ) { }

    private static normalizeColor(color: string): string {
        if (/^\d+\s\d+%\s\d+%$/.test(color)) {
            return `hsl(${color})`;
        }
        return color;
    }

    public static async fromLogseq(): Promise<Theme> {
        let mapToLogseqProps: { [key: string]: string } = {};
        Object.keys(Theme.defaultProps).forEach((key) => {
            mapToLogseqProps[key] = `--ls-${Theme.camelToKebab(key)}`;
        });
        const logseqPropVals = await logseq.UI.resolveThemeCssPropsVals(
            Object.values(mapToLogseqProps)
        );
        if (!logseqPropVals) {
            return new Theme();
        }
        let props: { [key: string]: string } = {};
        Object.keys(Theme.defaultProps).forEach((key) => {
            const color = logseqPropVals[mapToLogseqProps[key]] ?? Theme.defaultProps[key as keyof typeof Theme.defaultProps];
            props[key] = this.normalizeColor(color);
        });
        return new Theme(props as typeof Theme.defaultProps);
    }
}

export async function replaceCurrentBlock(content: string) {
    const blockEntity = await logseq.Editor.getCurrentBlock()
    if (blockEntity) {
        await logseq.Editor.updateBlock(blockEntity.uuid, content);
    } else {
        logseq.UI.showMsg("Copilot: No block selected", "warning");
    }
}

export async function insertChildBlock(content: string) {
    const blockEntity = await logseq.Editor.getCurrentBlock()
    if (blockEntity) {
        await logseq.Editor.insertBlock(blockEntity.uuid, content, {
            before: false,
            sibling: false
        });
    } else {
        logseq.UI.showMsg("Copilot: No block selected", "warning");
    }
}
