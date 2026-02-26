// src/errors.ts
var WasiAIError = class extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.name = "WasiAIError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var InsufficientBudgetError = class extends WasiAIError {
  constructor(message = "Insufficient budget to invoke agent") {
    super(message, 402);
    this.name = "InsufficientBudgetError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var AgentNotFoundError = class extends WasiAIError {
  constructor(slug) {
    super(`Agent not found: ${slug}`, 404);
    this.name = "AgentNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var RateLimitError = class extends WasiAIError {
  constructor(message = "Rate limit exceeded") {
    super(message, 429);
    this.name = "RateLimitError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
};

// src/utils.ts
function assertSlug(slug) {
  if (!slug || typeof slug !== "string" || slug.trim() === "") {
    throw new WasiAIError("slug must be a non-empty string");
  }
}

// src/agents.ts
var AgentsResource = class {
  constructor(http) {
    this.http = http;
  }
  async list(opts = {}) {
    const params = new URLSearchParams();
    if (opts.page !== void 0) params.set("page", String(opts.page));
    if (opts.category !== void 0) params.set("category", opts.category);
    const qs = params.toString();
    const path = `/api/v1/agents${qs ? `?${qs}` : ""}`;
    return this.http.request("GET", path);
  }
  async get(slug) {
    assertSlug(slug);
    return this.http.request("GET", `/api/v1/agents/${slug}`);
  }
};

// src/client.ts
var DEFAULT_BASE_URL = "https://wasiai-v2.vercel.app";
var HttpClient = class {
  constructor(options) {
    if (!options.apiKey) throw new Error("apiKey is required");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }
  async request(method, path, body, auth = false) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    if (auth) {
      headers["X-API-Key"] = this.apiKey;
    }
    const res = await fetch(url, {
      method,
      headers,
      body: body !== void 0 ? JSON.stringify(body) : void 0,
      signal: AbortSignal.timeout(3e4)
    });
    if (!res.ok) {
      let errorMessage = res.statusText;
      try {
        const errBody = await res.json();
        errorMessage = errBody.message ?? errBody.error ?? errorMessage;
      } catch {
      }
      if (res.status === 402) throw new InsufficientBudgetError(errorMessage);
      if (res.status === 404) {
        const match = /\/agents\/([^/]+)/.exec(path);
        throw new AgentNotFoundError(match?.[1] ?? path);
      }
      if (res.status === 429) throw new RateLimitError(errorMessage);
      throw new WasiAIError(errorMessage, res.status);
    }
    return res.json();
  }
};

// src/invoke.ts
async function invokeAgent(http, slug, input) {
  assertSlug(slug);
  return http.request(
    "POST",
    `/api/v1/agents/${slug}/invoke`,
    input,
    true
  );
}

// src/index.ts
var WasiAI = class {
  constructor(options) {
    this.http = new HttpClient(options);
    this.agents = new AgentsResource(this.http);
  }
  invoke(slug, input) {
    return invokeAgent(this.http, slug, input);
  }
};
export {
  AgentNotFoundError,
  InsufficientBudgetError,
  RateLimitError,
  WasiAI,
  WasiAIError
};
