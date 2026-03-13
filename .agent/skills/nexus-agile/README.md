# 🧠 NexusAgil

### The methodology that stops AI agents from hallucinating your codebase into oblivion.

[![Version](https://img.shields.io/badge/version-1.3-blue)](https://github.com/ferrosasfp/NexusAgile)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Agents](https://img.shields.io/badge/sub--agents-6-orange)](roles/)

---

## The Problem

You give an AI agent a task. It writes code. The code looks right. You ship it.

Then you discover:
- 🔴 It invented an API that doesn't exist
- 🔴 It "fixed" a bug that was already fixed 3 commits ago
- 🔴 It compared a keccak256 hash to a raw string and called it done
- 🔴 It passed its own code review (because it reviewed its own work)

**AI agents hallucinate. The more complex the task, the worse it gets.**

MetaGPT, ChatDev, and CrewAI proved that multi-agent systems work. But they all share the same flaw: **they trust their own output.** The architect writes the spec, the coder implements it, the reviewer approves it — all from the same context window, all inheriting the same blind spots.

NexusAgil fixes this with one principle:

> **No agent validates its own work. Ever.**

---

## The Solution

NexusAgil is a development methodology for teams where AI agents are the executors. It combines:

- **Scrum** as the work container (sprints, backlog, review, retro)
- **Spec-Driven Development** as the execution engine (nothing runs without an approved spec)
- **6 specialized sub-agents** with strict separation of responsibilities
- **5 formal gates** where a human approves before anything advances
- **Wave 0 pre-flight checks** that catch hallucinations before they become commits

### Real Results

Built and battle-tested on [WasiAI](https://wasiai-v2.vercel.app) — an on-chain AI agent marketplace on Avalanche:

| Metric | Value |
|--------|-------|
| Issues completed | 49+ across 15 sprints |
| Smart contract deploys | 4 versions, zero exploits |
| Hallucinations caught by Wave 0 | 2 of 6 SDDs were for already-implemented fixes |
| Critical encoding bug caught | `indexed string` returns keccak256, not raw string |
| Parallel agent execution | 4 sub-agents running simultaneously, zero merge conflicts |

---

## How It Works

```
You write the WHAT → AI writes the HOW → Different AI validates → You approve → Different AI builds → Different AI audits → Different AI verifies
```

### The 6 Sub-agents

No agent wears two hats. Each one has a single job, a concrete checklist, and clear boundaries.

```
┌─────────────────────────────────────────────────────────────────┐
│                         YOU (Product Owner)                      │
│                    Approve gates. Make decisions.                 │
└──────────┬──────────────────────────────────────┬───────────────┘
           │                                      │
           ▼                                      ▼
┌─────────────────────┐              ┌─────────────────────┐
│   SM / Orchestrator  │              │   Gate: HU_APPROVED  │
│   Writes artifacts   │──────────────│   Gate: SPEC_APPROVED│
│   Never self-reviews │              │   Gate: SPRINT_APPROVED
│   Coordinates agents │              │   Gate: REVIEW_APPROVED
└──────────┬──────────┘              │   Gate: RETRO_APPROVED│
           │                         └─────────────────────┘
           ▼
┌──────────────────────────────────────────────────────────────────┐
│                        6 SPECIALIZED SUB-AGENTS                  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ 1. Req       │  │ 2. Spec      │  │ 3. Builder   │          │
│  │ Reviewer     │  │ Reviewer     │  │              │          │
│  │ "What's      │  │ "Does this   │  │ "Build       │          │
│  │  missing?"   │  │  compile?"   │  │  exactly     │          │
│  │              │  │              │  │  this."      │          │
│  │ Pre-HU gate  │  │ Pre-SPEC gate│  │ Post-SPRINT  │          │
│  └──────────────┘  └──────────────┘  └──────┬───────┘          │
│                                              │                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────▼───────┐          │
│  │ 4. Logic     │  │ 5. Security  │  │ 6. QA        │          │
│  │ Auditor      │  │ Reviewer     │  │ Verifier     │          │
│  │ "Is this     │  │ "Is this     │  │ "Prove it    │          │
│  │  correct?"   │  │  safe?"      │  │  works."     │          │
│  │              │  │              │  │              │          │
│  │ Post-build   │  │ QUALITY only │  │ file:line    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└──────────────────────────────────────────────────────────────────┘
```

| # | Agent | Mission | Checks |
|---|-------|---------|--------|
| 1 | **Requirements Reviewer** | Find what's MISSING in the spec | Edge cases, conflicting ACs, already-implemented features |
| 2 | **Spec Reviewer** | Find technical errors in the SDD | Wave 0 pre-flight, type compatibility, encoding correctness |
| 3 | **Builder** | Implement EXACTLY the SDD | Re-validates Wave 0, build gate per wave, stops on failure |
| 4 | **Logic Auditor** | Find logic bugs | AC traceability, off-by-one, race conditions, edge cases |
| 5 | **Security Reviewer** | Find vulnerabilities | Auth bypass, injection, reentrancy, secret exposure |
| 6 | **QA Verifier** | Prove ACs are met | Drift detection, file:line evidence, build + test execution |

Each agent has a dedicated **role skill** in [`roles/`](roles/) with its full checklist and output format.

---

## Quick Start

### Install in your project

```bash
# Option 1: Git submodule (recommended)
git submodule add https://github.com/ferrosasfp/NexusAgile.git .claude/skills/nexus-agil

# Option 2: Copy
git clone https://github.com/ferrosasfp/NexusAgile.git /tmp/na
mkdir -p .claude/skills/nexus-agil
cp /tmp/na/SKILL.md .claude/skills/nexus-agil/
cp -r /tmp/na/roles /tmp/na/references .claude/skills/nexus-agil/
rm -rf /tmp/na
```

### Activate

Just mention "NexusAgil" in your conversation with the AI agent. It reads `SKILL.md` and follows the checklist.

```
You: "NexusAgil — here are 6 security issues from Linear to fix"
Agent: [reads SKILL.md] → classifies as QUALITY → starts Sprint pipeline
```

### The 5 Gates

Type the exact text to advance. Nothing else works — "ok", "sure", "go" are ignored.

```
HU_APPROVED      → Approve the work items
SPEC_APPROVED    → Approve the technical spec (SDD)
SPRINT_APPROVED  → Approve the sprint plan
REVIEW_APPROVED  → Approve the deliverables
RETRO_APPROVED   → Close the sprint
```

---

## How NexusAgil Compares

| Feature | MetaGPT | ChatDev | CrewAI | **NexusAgil** |
|---------|---------|---------|--------|---------------|
| Multi-agent | ✅ | ✅ | ✅ | ✅ |
| Human gates | ❌ | ❌ | ❌ | **✅ 5 formal gates** |
| Anti-hallucination | SOPs in prompts | None | None | **Wave 0 + Codebase Grounding + double validation** |
| Agent self-review | ✅ (same context) | ✅ | ✅ | **❌ Never. Separate agents.** |
| Rollback plan | ❌ | ❌ | ❌ | **✅ Mandatory in every SDD** |
| Security review | ❌ | ❌ | ❌ | **✅ Dedicated Security Reviewer** |
| Artifact persistence | ❌ | ❌ | ❌ | **✅ 10 artifacts per issue in `.nexus/`** |
| Build verification | End only | ❌ | ❌ | **✅ Per-wave build gate** |
| Parallel execution | ❌ | ❌ | ✅ | **✅ With disjoint-file verification** |
| Stack agnostic | Python only | Python only | Python only | **✅ Any stack** |
| Works with | MetaGPT framework | ChatDev framework | CrewAI framework | **Claude, GPT, Gemini, any LLM** |

**The key difference:** Other frameworks are code libraries. NexusAgil is a methodology. It works with any AI agent, any stack, any tool. You don't install a framework — you install a way of working.

---

## The Sprint Cycle

```
 1. SM presents prioritized backlog
 2. [Requirements Reviewer] validates work items
 3. You approve → HU_APPROVED
 4. SM writes SDDs (technical specs)
 5. [Spec Reviewer] validates SDDs (Wave 0 + coherence)
 6. You review SDDs + Spec Reviewer report → SPEC_APPROVED
 7. SM presents sprint plan → SPRINT_APPROVED
 8. [Builders] implement (parallel if disjoint files)
 9. [Logic Auditor] reviews each diff
10. [Security Reviewer] reviews (QUALITY only)
11. [QA Verifier] verifies ACs with file:line evidence
12. SM presents review with all reports → REVIEW_APPROVED
13. Retro → RETRO_APPROVED
14. Sprint closed
```

---

## Work Classification

Not everything needs the full pipeline. NexusAgil scales down for simple work:

| Type | What it is | Agents used | Gates |
|------|-----------|-------------|-------|
| **FAST-FIX** | 1-2 files, <30 lines, no DB | Builder only | SPRINT_APPROVED |
| **HU-MINOR** | Small feature, well understood | Builder + QA | SPRINT_APPROVED |
| **HU-MAJOR** | Significant feature, design needed | 5 of 6 agents | HU + SPEC + SPRINT |
| **QUALITY** | Security, contracts, architecture | All 6 agents | All 5 gates |

**When in doubt → QUALITY.** Overkill is better than a vulnerability in production.

---

## Wave 0 — The Anti-Hallucination Shield

Before any code is written, Wave 0 verifies the spec against reality:

| Check | What it catches |
|-------|----------------|
| **0.1** Fix already exists? | Prevents duplicate work (saved 2 of 6 SDDs in first sprint) |
| **0.2** Files exist? | Catches references to nonexistent paths |
| **0.3a** Code compiles against real types? | Catches type mismatches before implementation |
| **0.3b** Encoding correct? | Catches indexed event keccak256 vs raw string (caught 1 critical bug) |
| **0.3c** Security risks documented? | Catches reentrancy, overflow, front-running |
| **0.4** Dependencies resolved? | Prevents blocked execution |
| **0.5** No ambiguities? | Prevents Builder improvisation |

Wave 0 runs **twice**: once by the Spec Reviewer (before SPEC_APPROVED), and again by the Builder (before implementation). If the orchestrator hallucinated in the SDD, the Builder catches it.

---

## Artifact Persistence

Every decision, review, and validation is persisted. Nothing lives in chat history alone.

```
your-project/
└── .nexus/
    ├── _INDEX.md                        ← Historical registry
    ├── project-context.md               ← Project stack + patterns
    └── sprints/
        └── NNN-titulo/
            ├── work-item.md             ← What to build + ACs
            ├── requirements-review.md   ← What was missing
            ├── sdd.md                   ← How to build it
            ├── spec-review.md           ← What was wrong in the spec
            ├── story-file.md            ← Builder's contract
            ├── build-report.md          ← What was built + commits
            ├── logic-audit.md           ← Logic bugs found
            ├── security-review.md       ← Vulnerabilities found
            ├── qa-report.md             ← ACs verified with evidence
            └── report.md               ← Final summary
```

**Why this matters:** When something breaks in production 3 months later, you can trace back to exactly what was specified, who validated it, what the auditor found, and what QA verified. No "I think we decided..." — it's all in `.nexus/`.

---

## SDD Structure

The Story-Driven Document is the single source of truth for every agent:

```markdown
# Story File — SDD #NNN: <Title>
**Classification: QUALITY**

## Context
Why this exists. What problem it solves.

## Acceptance Criteria (EARS format)
WHEN [trigger], THE [system] SHALL [action]
IF [bad condition], THEN THE [system] SHALL [response]

## Wave 0 — Pre-flight
[Builder re-validates before touching code]

## Wave 1 — [Name]
Step-by-step instructions.
**Build gate:** verify build passes before continuing.

## Wave N — Commit + Push

## Rollback
How to revert if this causes a regression.

## Critical Constraints
Rules the agent CANNOT ignore.
```

### Key Principles

1. **One source of truth** — the agent reads the SDD and only the SDD
2. **Wave 0 first** — verify before touching code
3. **Double validation** — Spec Reviewer + Builder both run Wave 0
4. **Build gate per wave** — fail fast, not at the end
5. **Rollback mandatory** — every SDD includes how to undo
6. **Amendments are formal** — no silent SDD changes post-approval

---

## SDD Amendments

Scope changed after SPEC_APPROVED? No silent edits. Formal amendment:

```markdown
## Amendment A1 — Free tier for first 2 registrations
**Requested by:** PO
**Impact:** HIGH (smart contract change)
**Waves affected:** Wave 1 (modified), Wave 3 (new)
**Approval:** AMENDMENT_APPROVED
```

For smart contracts, amendments always trigger re-execution of Wave 0.3c (security verification).

---

## Parallelism Rules

Sub-agents can run in parallel **only if all conditions are met:**

- ✅ Disjoint files (no SDD touches the same file as another)
- ✅ No import dependencies between changes
- ✅ No execution order dependencies
- ✅ Same branch base

If any condition fails → sequential execution. No exceptions.

---

## Anti-patterns

| Don't | Why | Do instead |
|-------|-----|-----------|
| Execute without approved SDD | Agent hallucinates the design | Wait for SPEC_APPROVED |
| Let SM validate its own SDD | Same blind spots, same context | Spec Reviewer validates |
| Skip Wave 0 | Builds things that already exist, wrong encoding | Always run Wave 0 twice |
| Skip build gate between waves | Accumulates errors, wastes all subsequent waves | Build gate after every wave |
| SDD without rollback | Regression in prod = panic debugging | Rollback section mandatory |
| Ad-hoc smart contract changes | Bypasses adversarial validation | Everything needs an SDD (minimum: amendment) |
| Parallel agents on shared files | Silent merge conflicts, possible vulnerabilities | Verify disjoint files first |
| QA without file:line evidence | "Looks good" is not verification | Cite exact file:line or NO CUMPLE |
| Trust the orchestrator blindly | The SM hallucinates too | Double validation catches SM errors |

---

## Project Structure

```
NexusAgile/
├── README.md              ← You're reading this
├── SKILL.md               ← Imperative checklist for the AI orchestrator
├── INSTALL.md             ← Setup guide
├── roles/                 ← Role skills for each sub-agent
│   ├── requirements-reviewer.md
│   ├── spec-reviewer.md
│   ├── builder.md
│   ├── logic-auditor.md
│   ├── security-reviewer.md
│   └── qa-verifier.md
└── references/            ← Detailed templates and checklists
    ├── sdd_template.md
    ├── story_file_template.md
    ├── adversarial_review_checklist.md
    ├── validation_report_template.md
    ├── quality_pipeline.md
    ├── quick_flow.md
    ├── sprint_cadence.md
    ├── agents_roster.md
    ├── project_context_template.md
    └── launch_flow.md
```

**Three files, three audiences:**
- `README.md` → For you (understanding the methodology)
- `SKILL.md` → For the AI agent (imperative execution checklist)
- `roles/*.md` → For the sub-agents (specialized checklists per role)

---

## Integrates With

NexusAgil is **stack-agnostic** and **tool-agnostic**:

- **AI Agents:** Claude Code, Cursor, GitHub Copilot, Gemini, any LLM-based coding agent
- **Orchestration:** OpenClaw, Claude Code CLI, any tool that can spawn sub-agents
- **Issue Trackers:** Linear, GitHub Issues, Jira (just read the issues)
- **Stacks:** Next.js, Rails, Django, Go, Solidity, React Native — anything
- **Security Audits:** Integrates with NexusAudit for smart contract security workflows

---

## FAQ

**Q: Do I need 6 AI subscriptions?**
No. The sub-agents are spawned by the orchestrator as isolated sessions. One AI provider, multiple sessions.

**Q: Is this just for smart contracts?**
No. NexusAgil was built on a Web3 project but works with any stack. The Security Reviewer has extra checks for contracts, but the core methodology applies everywhere.

**Q: What if I'm a solo dev?**
Perfect use case. You're the PO. The AI is the SM + all 6 sub-agents. You just approve gates and make decisions.

**Q: What if the AI ignores the SKILL.md?**
That's why it's written as an imperative checklist, not documentation. Steps say "HACER:" (DO:) not "consider" or "you might want to". If the agent still skips steps, the role skills for sub-agents provide a second layer of enforcement.

**Q: How much does this add to token costs?**
More than letting the agent freestyle. Less than fixing hallucinated code in production. The double validation (Wave 0 × 2) adds ~10-15% tokens but catches errors that would cost 10x more to debug later.

**Q: Can I use only parts of it?**
Yes. FAST-FIX mode uses only the Builder. HU-MINOR adds QA. Use the full pipeline only when the risk justifies it.

---

## Changelog

**v1.3** (March 2026) — Specialized Sub-agent Architecture
- 6 sub-agents with dedicated role skills (`roles/*.md`)
- Orchestrator never self-evaluates
- Artifact persistence in `.nexus/` (10 artifacts per issue)
- Sub-agent scaling by classification (1 for FAST, 6 for QUALITY)

**v1.2** (March 2026) — Anti-Hallucination Hardening
- Wave 0.3 expanded (type validation, encoding, contract security)
- Double Wave 0 execution (Spec Reviewer + Builder)
- Build gate per wave, mandatory rollback, formal amendments
- Parallelism rules, Security Gate post-execution

**v1.1** (March 2026) — Wave 0 Introduction
- Mandatory pre-flight checks
- Anti-patterns documented

**v1.0** (March 2026) — Initial Release
- 5 formal gates, work classification, SDD structure
- First application: WasiAI Marketplace

---

## Contributing

NexusAgil evolved from real sprint retros. Every rule exists because something went wrong without it.

If you use it and find a gap — open an issue or PR. The best improvements come from real failures.

---

## License

MIT — Use it, fork it, improve it.

---

<p align="center">
  <b>Stop shipping hallucinated code.</b><br>
  <a href="INSTALL.md">Install NexusAgil →</a>
</p>
