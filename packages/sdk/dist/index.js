"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AgentNotFoundError: () => AgentNotFoundError,
  InsufficientFundsError: () => InsufficientFundsError,
  RateLimitError: () => RateLimitError,
  TimeoutError: () => TimeoutError,
  WasiAI: () => WasiAI,
  WasiAIError: () => WasiAIError
});
module.exports = __toCommonJS(index_exports);

// src/errors.ts
var WasiAIError = class extends Error {
  constructor(msg) {
    super(msg);
    this.name = "WasiAIError";
  }
};
var RateLimitError = class extends WasiAIError {
  constructor() {
    super("Rate limit exceeded");
    this.name = "RateLimitError";
  }
};
var InsufficientFundsError = class extends WasiAIError {
  constructor() {
    super("Insufficient funds in API key");
    this.name = "InsufficientFundsError";
  }
};
var AgentNotFoundError = class extends WasiAIError {
  constructor(slug) {
    super(`Agent "${slug}" not found`);
    this.name = "AgentNotFoundError";
  }
};
var TimeoutError = class extends WasiAIError {
  constructor() {
    super("Request timed out");
    this.name = "TimeoutError";
  }
};

// src/client.ts
var DEFAULT_BASE_URL = "https://wasiai-v2.vercel.app";
var DEFAULT_TIMEOUT_MS = 3e4;
var WasiAI = class {
  constructor(config) {
    if (!config.apiKey) throw new WasiAIError("apiKey is required");
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }
  /**
   * Invoke an agent by slug.
   * Automatically handles timeout, rate-limit, and payment errors.
   */
  async invoke(slug, options) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      options.timeout ?? DEFAULT_TIMEOUT_MS
    );
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v1/agents/${slug}/invoke`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": this.apiKey
          },
          body: JSON.stringify({ input: options.input }),
          signal: controller.signal
        }
      );
      clearTimeout(timeoutHandle);
      if (res.status === 429) throw new RateLimitError();
      if (res.status === 402) throw new InsufficientFundsError();
      if (res.status === 404) throw new AgentNotFoundError(slug);
      if (!res.ok) throw new WasiAIError(`Invoke failed: ${res.status}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (err.name === "AbortError") throw new TimeoutError();
      throw err;
    }
  }
  /**
   * List available agents, optionally filtered by category or search term.
   */
  async list(options = {}) {
    const params = new URLSearchParams();
    if (options.category) params.set("category", options.category);
    if (options.search) params.set("search", options.search);
    if (options.limit) params.set("limit", String(options.limit));
    if (options.offset) params.set("offset", String(options.offset));
    const res = await fetch(
      `${this.baseUrl}/api/v1/agents?${params.toString()}`,
      { headers: { "X-API-Key": this.apiKey } }
    );
    if (!res.ok) throw new WasiAIError(`List failed: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : data.agents ?? [];
  }
  /**
   * Get agent details by slug. Returns `null` if the agent is not found.
   */
  async get(slug) {
    const res = await fetch(
      `${this.baseUrl}/api/v1/agents/${slug}`,
      { headers: { "X-API-Key": this.apiKey } }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new WasiAIError(`Get failed: ${res.status}`);
    return await res.json();
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AgentNotFoundError,
  InsufficientFundsError,
  RateLimitError,
  TimeoutError,
  WasiAI,
  WasiAIError
});
