import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import "@logseq/libs";
import { StringOutputParser } from "@langchain/core/output_parsers";
import dedent from "dedent-js";
import { Runnable } from "@langchain/core/runnables";
import { Block } from "../types";
import { VectorStore } from "./vectorStore";
import logger from "./logger";
import { BlockEntity, BlockUUIDTuple, PageEntity } from "@logseq/libs/dist/LSPlugin.user";
import { HumanMessage, AIMessage, Message } from "./chat";
import { HumanMessage as LangChainHumanMessage, AIMessage as LangChainAIMessage } from "@langchain/core/messages";
import { ensureValidToken } from "./logseq";
import { getCodexAccessToken } from "./codexAuth";
import { createCodexTextResponse, streamCodexTextResponse } from "./codexResponses";

const VECTOR_SIMILARITY_TOP_K = 20;

const QUERY_ENHANCER_SYSTEM_PROMPT = dedent`
    You are an expert in creating queries for Logseq. Your job is to convert a question
    from a user to a Logseq query that outputs relevant blocks that can be used to
    answer the user's question.

    Some examples:
    - given the question "What do I know about Deepspeed", you might
    conclude that the most important keyword here is "Deepspeed" and create the
    query \`"Deepspeed"\`.
    - given the question "Why did I choose to
    use VertexAI for project XYZ?", you might conclude that the blocks containing
    both VertexAI and XYZ would be most relevant and create the query
    \`(and "VertexAI" "XYZ")\`.

    Be as succinct as possible. Just output the query and nothing else. Don't surround
    the query produced with backticks.
`;

export class RagEngine {
    qaChain!: Runnable;
    queryEnhancerChain!: Runnable;
    vectorStore: VectorStore;
    authChoice: string;
    baseURL: string;
    modelName: string;

    constructor() {
        this.vectorStore = new VectorStore();
        this.authChoice = "openai-api-key";
        this.baseURL = "https://api.openai.com/v1";
        this.modelName = "gpt-4o-mini";
        setTimeout(this.vectorStore.indexAllPages.bind(this.vectorStore), 3000);
    }

    async setUpLLMChains() {
        const authChoice = logseq.settings!["OPENAI_AUTH_CHOICE"] as string;
        let apiKey = logseq.settings!["OPENAI_API_KEY"] as string;
        let modelName = logseq.settings!["OPENAI_MODEL"] as string;
        this.authChoice = authChoice;
        this.baseURL = logseq.settings!["OPENAI_BASE_URL"] as string;
        this.modelName = modelName;

        if (authChoice === "openai-codex") {
            const token = await ensureValidToken();
            if (token) {
                apiKey = token;
            }
            if (!modelName.startsWith("openai-codex/")) {
                modelName = "openai-codex/" + modelName;
            }
        }

        this.modelName = modelName;

        if (authChoice === "codex-cli-auth") {
            return;
        }

        const model = new ChatOpenAI({
            configuration: {
                baseURL: this.baseURL,
                apiKey: apiKey,
            },
            modelName: modelName,
            maxTokens: 1000,
            verbose: __DEV__,
            modelKwargs: {
                ...(logseq.settings!["OPENAI_FAST_MODE"] ? { service_tier: "priority" } : {}),
                store: logseq.settings!["OPENAI_STORE_REQUESTS"] ?? true,
            },
        });
        const queryEnhancerTemplate = ChatPromptTemplate.fromMessages([
            ["system", QUERY_ENHANCER_SYSTEM_PROMPT],
            ["human", "{query}"],
        ]);
        const qaTemplate = ChatPromptTemplate.fromMessages([
            ["system", dedent`
                You are a helpful assistant that can answer questions about the user's notes and
                help the user create new notes.

                The user's notes are:
                {retrievedContext}

                You may use markdown to format your response.

                When you provide a suggested note that the user can include into their notes, you
                should include it in a \`<note>\` tag. This is important because the contents
                included in the \`<note>\` tag can be copied into the user's notes with a single
                click. For example, if the user asks "Create a summary of my work with Ray", you
                might respond with:

                \`\`\`
                Here's a summary of your work with Ray based on your notes:
                <note>
                ...
                </note>
                Feel free to let me know if you'd like to add or modify any specific sections!
                \`\`\`

                Aggressively find opportunities to help improve the user's notes by liberally using
                the \`<note>\` tag. Assume the user will want to copy important parts of your
                response into their notes.

                It is now: {now}.
            `],
            ["placeholder", "{history}"],
            ["human", "{query}"],
        ]);
        const outputParser = new StringOutputParser();
        this.queryEnhancerChain = queryEnhancerTemplate.pipe(model).pipe(outputParser);
        this.qaChain = qaTemplate.pipe(model).pipe(outputParser);
    }

    private getCodexAuthPath(): string {
        return logseq.settings!["CODEX_AUTH_JSON_PATH"] as string;
    }

    private async runCodexQueryEnhancer(query: string): Promise<string> {
        const accessToken = await getCodexAccessToken(this.getCodexAuthPath());
        return await createCodexTextResponse(
            this.baseURL,
            accessToken,
            this.modelName,
            QUERY_ENHANCER_SYSTEM_PROMPT,
            [],
            query,
        );
    }

    private async runCodexQa(
        chatMessages: Message[],
        retrievedContext: string,
        onChunkReceived: (token: string) => void,
    ): Promise<void> {
        const accessToken = await getCodexAccessToken(this.getCodexAuthPath());
        const queries = chatMessages.filter(message => message instanceof HumanMessage).map(message => message.msg);
        const history = chatMessages.slice(0, -1);
        const systemPrompt = dedent`
            You are a helpful assistant that can answer questions about the user's notes and
            help the user create new notes.

            The user's notes are:
            ${retrievedContext}

            You may use markdown to format your response.

            When you provide a suggested note that the user can include into their notes, you
            should include it in a \`<note>\` tag. This is important because the contents
            included in the \`<note>\` tag can be copied into the user's notes with a single
            click.

            Aggressively find opportunities to help improve the user's notes by liberally using
            the \`<note>\` tag. Assume the user will want to copy important parts of your
            response into their notes.

            It is now: ${new Date().toLocaleString()}.
        `;

        await streamCodexTextResponse(
            this.baseURL,
            accessToken,
            this.modelName,
            systemPrompt,
            history,
            queries[queries.length - 1],
            onChunkReceived,
        );
    }

    async retrieveLogseqBlocks(query: string): Promise<string[]> {
        // Note that the query enhancer may return a query wrapped in backticks.
        const enhancedQuery = this.authChoice === "codex-cli-auth"
            ? await this.runCodexQueryEnhancer(query)
            : await this.queryEnhancerChain.invoke({ query });
        const logseqQuery = enhancedQuery.replace(/^`|`$/g, "");
        let results: any[] | null = null;
        try {
            results = await logseq.DB.q(logseqQuery);
        } catch (e) {
            logger.error("Error querying Logseq with enhanced query. Falling back.", e);
            const simpleQueryParts = query.replace(/[^a-zA-Z0-9\-]/g, "").split(" ");
            const simpleQuery = `(and ${simpleQueryParts.map(word => `"${word}"`).join(" ")})`;
            results = await logseq.DB.q(simpleQuery);
        }
        logger.log("Logseq results:", results);
        return (results || []).slice(0, 10).map(result => result.uuid);
    }

    async retrieveVectorStoreBlocks(query: string): Promise<string[]> {
        const results = await this.vectorStore.query(query, VECTOR_SIMILARITY_TOP_K);
        logger.log("Vector store results:", results);
        return results.map(result => result.id);
    }

    async processLogseqBlock(block: BlockEntity | BlockUUIDTuple, page: PageEntity | null): Promise<Block> {
        if (Array.isArray(block)) {
            const candidateBlock = await logseq.Editor.getBlock(block[1]);
            if (!candidateBlock) {
                throw new Error("Block not found");
            }
            block = candidateBlock;
        }
        const children = await Promise.all(block.children?.map(async child => await this.processLogseqBlock(child, null)) || []);
        return {
            id: block.uuid,
            content: block.content,
            page: page ? {
                id: page.uuid,
                name: page.name,
            } : null,
            children: children,
        };
    }

    async blockToContext(block: Block): Promise<string> {
        return dedent`
            <block>
                ${block.page ? `<title>${block.page.name}</title>` : ""}
                <content>
                ${block.content.slice(0, 1000)}
                </content>
                ${block.children.length > 0 ?
                `<children>
                    ${(await Promise.all(block.children.map(async child => this.blockToContext(await child)))).join("\n")}
                </children>` :
                ""}
            </block>
        `;
    }

    async run(chatMessages: Message[], onChunkReceived: (token: string) => void) {
        await this.setUpLLMChains();
        const queries = chatMessages.filter(message => message instanceof HumanMessage).map(message => message.msg);

        let blockUUIDs = new Set<string>();
        for (const query of queries) {
            const logseqBlocksPromise = this.retrieveLogseqBlocks(query);
            const vectorStoreBlocksPromise = this.retrieveVectorStoreBlocks(query);

            try {
                (await logseqBlocksPromise).forEach(id => blockUUIDs.add(id));
            } catch (e) {
                logger.warn("Error retrieving logseq blocks", e);
            }
            try {
                (await vectorStoreBlocksPromise).forEach(id => blockUUIDs.add(id));
            } catch (e) {
                logger.warn("Error retrieving vector store blocks", e);
            }
        }
        if (blockUUIDs.size === 0) {
            logger.warn("No blocks found. Attempting to answer question without any Logseq context.");
        }

        const blocks = await Promise.all((
            await Promise.all(Array.from(blockUUIDs).map(id => logseq.Editor.getBlock(id)))
        ).filter(block => block !== null).map(async block => {
            const page = await logseq.Editor.getPage(block.page.id);
            return await this.processLogseqBlock(block, page);
        }));
        const retrievedContext = dedent`
            <userNotes>
                ${(await Promise.all(blocks.map(block => this.blockToContext(block)))).join("\n")}
            </userNotes>
        `;
        logger.log(retrievedContext);

        if (this.authChoice === "codex-cli-auth") {
            await this.runCodexQa(chatMessages, retrievedContext, onChunkReceived);
            return;
        }

        const stream = await this.qaChain.stream({
            query: queries[queries.length - 1],
            retrievedContext,
            now: new Date().toLocaleString(),
            history: chatMessages.slice(0, -1).map(message => {
                if (message instanceof HumanMessage) {
                    return new LangChainHumanMessage(message.msg);
                } else if (message instanceof AIMessage) {
                    return new LangChainAIMessage(message.msg);
                } else {
                    throw new Error("Unknown message type");
                }
            })
        });
        for await (const chunk of stream) {
            onChunkReceived(chunk as string);
        }
    }
}
