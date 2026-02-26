# ADR-008 — pending_earnings_usdc: DB counter (Option A)

**Fecha:** 2026-02-25  
**Estado:** Aceptado  
**Sprint:** 1 (HU-1.1 Onboarding sin fricción)

---

## Contexto

Al implementar el onboarding sin wallet (HU-1.1), necesitábamos definir qué pasa con los earnings de un creator que aún no tiene wallet configurada. El contrato requiere una dirección Ethereum para hacer el `withdraw()`.

Teníamos dos opciones:
- **Option A:** Los earnings se acumulan en un contador en DB (`pending_earnings_usdc`). El cron salta la liquidación on-chain si no hay wallet. Al configurar wallet, se liquida inmediatamente.
- **Option B:** Los earnings se acumulan normalmente on-chain en `earnings[creator_wallet]`, requiriendo una wallet custodial de WasiAI como intermediario.

---

## Decisión

**Option A** — `pending_earnings_usdc` como counter en DB.

---

## Razones

1. **Seguridad**: WasiAI nunca custodia fondos del usuario. Option B requeriría una wallet custodial que podría ser comprometida.
2. **Simplicidad**: Sin wallets adicionales, sin lógica de re-routing on-chain.
3. **Transparencia**: El usuario ve sus earnings en tiempo real desde DB. Al configurar wallet, el settlement es inmediato.
4. **Consistencia**: El contrato solo toca wallets registradas explícitamente.

---

## Consecuencias

- `pending_earnings_usdc` es un display counter, no fuente de verdad financiera.
- El cron `settle-key-batches` debe saltarse creators sin wallet y loguear la omisión.
- Al guardar wallet via `POST /api/creator/wallet`, se dispara settlement inmediato.
- Si un creator tiene earnings pendientes y nunca configura wallet, los fondos quedan en el contrato hasta que lo haga.

---

## Archivos afectados

- `supabase/migrations/015_pending_earnings.sql`
- `src/app/api/creator/wallet/route.ts`
- `src/app/api/cron/settle-key-batches/route.ts`
