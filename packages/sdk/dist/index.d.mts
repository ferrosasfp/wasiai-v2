interface WasiAIConfig {
    /** WasiAI API key (starts with `wasi_`) */
    apiKey: string;
    /** Override the base URL (useful for tests or self-hosted deployments) */
    baseUrl?: string;
}
interface InvokeOptions {
    /** Text input for the agent */
    input: string;
    /** Request timeout in milliseconds (default: 30000) */
    timeout?: number;
}
interface InvokeResult {
    /** The agent's output */
    output: string;
    /** Time taken by the agent in milliseconds */
    latencyMs: number;
    /** On-chain payment receipt identifier */
    receiptId: string;
}
interface Agent {
    slug: string;
    name: string;
    description: string;
    category: string;
    /** Price per call in USDC (as a string for precision, e.g. "0.02") */
    priceUsdc: string;
    inputExample?: string;
}
interface ListOptions {
    /** Filter by category (e.g. "nlp", "vision") */
    category?: string;
    /** Full-text search term */
    search?: string;
    /** Maximum number of results (default: 20) */
    limit?: number;
    /** Pagination offset */
    offset?: number;
}

declare class WasiAI {
    private readonly baseUrl;
    private readonly apiKey;
    constructor(config: WasiAIConfig);
    /**
     * Invoke an agent by slug.
     * Automatically handles timeout, rate-limit, and payment errors.
     */
    invoke(slug: string, options: InvokeOptions): Promise<InvokeResult>;
    /**
     * List available agents, optionally filtered by category or search term.
     */
    list(options?: ListOptions): Promise<Agent[]>;
    /**
     * Get agent details by slug. Returns `null` if the agent is not found.
     */
    get(slug: string): Promise<Agent | null>;
}

declare class WasiAIError extends Error {
    constructor(msg: string);
}
declare class RateLimitError extends WasiAIError {
    constructor();
}
declare class InsufficientFundsError extends WasiAIError {
    constructor();
}
declare class AgentNotFoundError extends WasiAIError {
    constructor(slug: string);
}
declare class TimeoutError extends WasiAIError {
    constructor();
}

export { type Agent, AgentNotFoundError, InsufficientFundsError, type InvokeOptions, type InvokeResult, type ListOptions, RateLimitError, TimeoutError, WasiAI, type WasiAIConfig, WasiAIError };
