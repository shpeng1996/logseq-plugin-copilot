import { HumanMessage, Message } from "./chat";

interface ResponseContent {
    text?: string;
}

interface ResponseOutput {
    content?: ResponseContent[];
}

interface ResponsesApiResponse {
    output_text?: string;
    output?: ResponseOutput[];
}

function buildInput(systemPrompt: string, history: Message[], userPrompt: string) {
    const input: Array<{ role: string; content: Array<{ type: string; text: string }> }> = [
        {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
        },
    ];

    for (const message of history) {
        input.push({
            role: message instanceof HumanMessage ? "user" : "assistant",
            content: [{ type: "input_text", text: message.msg }],
        });
    }

    input.push({
        role: "user",
        content: [{ type: "input_text", text: userPrompt }],
    });

    return input;
}

function extractOutputText(payload: ResponsesApiResponse): string {
    if (typeof payload.output_text === "string" && payload.output_text.length > 0) {
        return payload.output_text;
    }

    return (payload.output || [])
        .flatMap(output => output.content || [])
        .map(content => content.text || "")
        .join("");
}

function getResponsesUrl(baseURL: string): string {
    return `${baseURL.replace(/\/$/, "")}/responses`;
}

export async function createCodexTextResponse(
    baseURL: string,
    accessToken: string,
    model: string,
    systemPrompt: string,
    history: Message[],
    userPrompt: string,
): Promise<string> {
    const response = await fetch(getResponsesUrl(baseURL), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            model,
            input: buildInput(systemPrompt, history, userPrompt),
            stream: false,
        }),
    });

    if (!response.ok) {
        throw new Error(await response.text());
    }

    const payload = await response.json() as ResponsesApiResponse;
    return extractOutputText(payload).trim();
}

export async function streamCodexTextResponse(
    baseURL: string,
    accessToken: string,
    model: string,
    systemPrompt: string,
    history: Message[],
    userPrompt: string,
    onChunkReceived: (chunk: string) => void,
): Promise<void> {
    const response = await fetch(getResponsesUrl(baseURL), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            model,
            input: buildInput(systemPrompt, history, userPrompt),
            stream: true,
        }),
    });

    if (!response.ok) {
        throw new Error(await response.text());
    }

    if (!response.body) {
        throw new Error("Streaming response body is not available.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";

        for (const frame of frames) {
            const lines = frame.split("\n");
            let eventType = "";
            const dataLines: string[] = [];

            for (const line of lines) {
                if (line.startsWith("event:")) {
                    eventType = line.slice("event:".length).trim();
                } else if (line.startsWith("data:")) {
                    dataLines.push(line.slice("data:".length).trim());
                }
            }

            const data = dataLines.join("\n");
            if (!data || data === "[DONE]") continue;

            let payload: Record<string, unknown>;
            try {
                payload = JSON.parse(data) as Record<string, unknown>;
            } catch {
                continue;
            }

            if ((eventType === "response.output_text.delta" || eventType === "response.refusal.delta") && typeof payload.delta === "string") {
                onChunkReceived(payload.delta);
            }
        }
    }
}
