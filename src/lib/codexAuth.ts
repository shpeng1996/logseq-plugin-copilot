export interface CodexAuthFile {
    auth_mode?: string;
    last_refresh?: string;
    tokens?: {
        id_token?: string;
        access_token?: string;
        refresh_token?: string;
        account_id?: string;
    };
}

interface JwtPayload {
    client_id?: string;
    exp?: number;
}

interface RefreshTokenResponse {
    access_token: string;
    refresh_token?: string;
}

const DEFAULT_AUTH_PATH = "~/.codex/auth.json";
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const TOKEN_URL = "https://auth.openai.com/oauth/token";

function getNodeRequire(): ((id: string) => any) | null {
    const candidate = (globalThis as { require?: (id: string) => any }).require;
    return typeof candidate === "function" ? candidate : null;
}

function getHomeDir(): string | null {
    const req = getNodeRequire();
    if (!req) return null;
    try {
        const os = req("os") as { homedir: () => string };
        return os.homedir();
    } catch {
        return null;
    }
}

function expandHome(path: string): string {
    if (!path.startsWith("~/")) return path;
    const homeDir = getHomeDir();
    return homeDir ? path.replace(/^~\//, `${homeDir}/`) : path;
}

function readJsonFile<T>(path: string): T {
    const req = getNodeRequire();
    if (!req) {
        throw new Error("Node.js file access is not available in this Logseq environment.");
    }
    const fs = req("fs") as { readFileSync: (path: string, encoding: string) => string };
    return JSON.parse(fs.readFileSync(path, "utf8")) as T;
}

function writeJsonFile(path: string, value: unknown): void {
    const req = getNodeRequire();
    if (!req) {
        throw new Error("Node.js file access is not available in this Logseq environment.");
    }
    const fs = req("fs") as { writeFileSync: (path: string, contents: string, encoding: string) => void };
    fs.writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function decodeJwtPayload(token: string): JwtPayload {
    const payload = token.split(".")[1];
    if (!payload) return {};
    try {
        return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as JwtPayload;
    } catch {
        return {};
    }
}

async function refreshAccessToken(authPath: string, authFile: CodexAuthFile): Promise<string> {
    const currentAccessToken = authFile.tokens?.access_token;
    const refreshToken = authFile.tokens?.refresh_token;
    if (!currentAccessToken || !refreshToken) {
        throw new Error(`Missing access_token or refresh_token in ${authPath}.`);
    }

    const clientId = decodeJwtPayload(currentAccessToken).client_id;
    if (!clientId) {
        throw new Error("Could not determine Codex client_id from access token.");
    }

    const params = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
        audience: "https://api.openai.com/v1",
    });
    const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to refresh Codex token: ${error}`);
    }

    const refreshed = await response.json() as RefreshTokenResponse;
    authFile.tokens = {
        ...authFile.tokens,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? refreshToken,
    };
    authFile.last_refresh = new Date().toISOString();
    writeJsonFile(authPath, authFile);
    return refreshed.access_token;
}

export function getDefaultCodexAuthPath(): string {
    return DEFAULT_AUTH_PATH;
}

export async function getCodexAccessToken(authPathSetting?: string): Promise<string> {
    const authPath = expandHome(authPathSetting || DEFAULT_AUTH_PATH);
    const authFile = readJsonFile<CodexAuthFile>(authPath);
    const accessToken = authFile.tokens?.access_token;
    if (!accessToken) {
        throw new Error(`No access_token found in ${authPath}. Run codex login first.`);
    }

    const expirationMs = (decodeJwtPayload(accessToken).exp ?? 0) * 1000;
    if (expirationMs > Date.now() + REFRESH_SKEW_MS) {
        return accessToken;
    }

    return await refreshAccessToken(authPath, authFile);
}
