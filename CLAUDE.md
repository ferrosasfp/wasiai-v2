# WasiAI — CLAUDE.md

Marketplace on-chain de agentes IA en Avalanche.
URL prod: https://wasiai-v2.vercel.app
Contrato activo (Fuji v3): `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53`

---

## Metodología: Nexus Factory + BMAD

Todo desarrollo sigue este flujo:

```
IDEA → [S0 Analyst] → HU_APPROVED → [S1 SDD] → SPEC_APPROVED → [S2 Implementación]
```

### Activación de cada fase
```
S0: "lee .nexus/skills/S0-idea-to-hu.md — [idea o HU del backlog]"
S1: "lee .nexus/skills/S1-hu-to-sdd.md — [HU aprobada]"
S2: "lee .nexus/skills/S2-sdd-to-impl.md — implementa [referencia al SDD]"
```

### Gates obligatorios
- `HU_APPROVED: yes` — sin esto no se genera SDD
- `SPEC_APPROVED: yes` — sin esto no se escribe código

### Documentos generados
- `.nexus/docs/prd/` — HUs aprobadas
- `.nexus/docs/sdd/` — SDDs aprobados
- `.nexus/docs/architecture/` — decisiones técnicas (ADRs)

---

## Golden Path (NO negociable)

Ver detalle completo: `.nexus/workflows/golden-path.md`

**Web2:** Next.js 14 · Supabase · Upstash Redis · Pinata · Tailwind · next-intl · Vercel
**Web3:** Avalanche · Solidity + Foundry · viem v2 · wagmi v3 · x402 · ERC-3009 · uvd-x402-sdk

**Reglas absolutas:**
- Sin hardcodes (contratos, URLs, keys)
- Sin datos simulados en producción
- Sin `NEXT_PUBLIC_` para secrets
- Sin ethers.js — usar viem
- Sin permissionless (ERC-4337 es roadmap futuro)
- Push siempre: `git push origin master master:main`

---

## Contexto del proyecto

### Actores
- **Creator:** developer que publica un agente y recibe el 90% por invocación
- **Consumer:** developer o agente que llama agentes del marketplace
- **Operator wallet** `0x2dd1Bd5D69Fe05205C0eecB9e22Bc8Ec99eE7aaB`: ejecuta txs on-chain
- **Treasury** `0xeC176F4f3BB71fD7288Cb7Defd09CDC427BBC70a`: recibe el 10% de fees

### Flujo de pago x402 (humano)
1. UI → 402 con requisitos de pago
2. Usuario firma EIP-712 en Core Wallet (sin gas)
3. Operator ejecuta transferWithAuthorization on-chain
4. Contrato: 90% → earnings[creator], 10% → treasury
5. Creator hace withdraw cuando quiera

### Flujo de pago con API Key
1. Developer deposita USDC on-chain con ERC-3009 → `keyBalances[keyId]`
2. Cada llamada: WasiAI firma recibo criptográfico, anota en DB
3. Cron diario: `settleKeyBatch` on-chain liquida el día → earnings creators
4. Al cerrar key: `refundKeyToEarnings` → saldo va a earnings del owner
5. Si WasiAI desaparece 30 días: `emergencyWithdrawKey` sin permiso

### Backlog
Ver: `BACKLOG.md` — 8 épicas, priorizado por PO.
