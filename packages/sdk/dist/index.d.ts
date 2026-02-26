interface WasiAIOptions {
    apiKey: string;
    baseUrl?: string;
}
interface InvokeResult {
    output: unknown;
    agentSlug: string;
    callId: string;
    latencyMs: number;
}
interface Agent {
    slug: string;
    name: string;
    description: string;
    category: string;
    priceUsdc: number;
    currency: string;
    endpoint: string;
}
interface AgentList {
    agents: Agent[];
    total: number;
    page: number;
    hasMore: boolean;
}
interface AgentListOptions {
    page?: number;
    category?: string;
}

declare class HttpClient {
    readonly baseUrl: string;
    readonly apiKey: string;
    constructor(options: WasiAIOptions);
    request<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, auth?: boolean): Promise<T>;
}

declare class AgentsResource {
    private readonly http;
    constructor(http: HttpClient);
    list(opts?: AgentListOptions): Promise<AgentList>;
    get(slug: string): Promise<Agent>;
}

declare class WasiAIError extends Error {
    readonly statusCode?: number | undefined;
    constructor(message: string, statusCode?: number | undefined);
}
declare class InsufficientBudgetError extends WasiAIError {
    constructor(message?: string);
}
declare class AgentNotFoundError extends WasiAIError {
    constructor(slug: string);
}
declare class RateLimitError extends WasiAIError {
    constructor(message?: string);
}

declare class WasiAI {
    readonly agents: AgentsResource;
    private readonly http;
    constructor(options: WasiAIOptions);
    invoke(slug: string, input: Record<string, unknown>): Promise<InvokeResult>;
}

export { type Agent, type AgentList, type AgentListOptions, AgentNotFoundError, AgentsResource, InsufficientBudgetError, type InvokeResult, RateLimitError, WasiAI, WasiAIError, type WasiAIOptions };
