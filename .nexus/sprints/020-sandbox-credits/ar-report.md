# AR Report — WAS-75 Sandbox Gratuito
**Adversary:** San (NexusAgil)  
**Fecha:** 2026-03-02  
**Estado:** ⛔ 2 BLOQUEANTE · ⚠️ 4 MENOR

---

## BLOQUEANTE

### B-01 — Refund Race Condition (pérdida económica)
**Archivo:** `src/app/api/v1/sandbox/invoke/[slug]/route.ts` líneas 148–156  
**Descripción:**  
El reembolso en caso de fallo del agente restaura el balance usando un **snapshot** capturado antes de la deducción (`creditsRow.balance_usdc`), vía un `UPDATE` sin locking:

```ts
// Step 4 — snapshot leído sin bloqueo
const { data: creditsRow } = await supabase
  .from('sandbox_credits')
  .select('balance_usdc')         // balance_usdc = 0.50 (snapshot)
  ...

// Step 8b — restaura snapshot, sobrescribe cualquier estado concurrent
await supabase
  .from('sandbox_credits')
  .update({ balance_usdc: creditsRow.balance_usdc })  // ← RACE BUG
  .eq('user_id', user.id)
```

**Ataque concreto (2 requests paralelas, ambas fallan):**
1. Request A y B leen balance = 0.50 (ambas)
2. `deduct_sandbox_balance` (atómica): A → 0.40, B → 0.30
3. Agente falla en ambas → A restore → 0.50; B restore → 0.50 (last writer wins)
4. Balance final: **0.50** (igual al inicial). Usuario intentó 2 veces gratis.

**Ataque worse-case (A exitosa, B fallida):**
1. A deducida: balance = 0.40; A llama al agente exitosamente.
2. B deducida: balance = 0.30; agente falla.
3. B restaura `creditsRow.balance_usdc` (su snapshot) = **0.50**
4. La deducción exitosa de A queda borrada. Usuario recupera créditos ya gastados.

**Fix requerido:** El reembolso debe hacerse con `INCREMENT` atómico, no con valor absoluto:
```sql
UPDATE sandbox_credits
SET balance_usdc = balance_usdc + p_amount,
    total_used   = total_used - p_amount,
    updated_at   = now()
WHERE user_id = p_user_id;
```
O mejor: exponer `refund_sandbox_balance(p_user_id, p_amount)` como RPC Postgres con `FOR UPDATE`.

---

### B-02 — SSRF en invocación de agente externo
**Archivo:** `src/app/api/v1/sandbox/invoke/[slug]/route.ts` línea 136  
**Descripción:**  
El endpoint llama a `agent.endpoint_url` sin ninguna validación de URL:

```ts
const agentResponse = await fetch(agent.endpoint_url, {  // ← SSRF
  method: 'POST',
  ...
})
```

Un creator (o un atacante que comprometa la tabla `agents`) puede establecer `endpoint_url` en:
- `http://169.254.169.254/latest/meta-data/` (AWS metadata → credenciales IAM)
- `http://localhost:5432/` (Postgres interno)
- `http://10.0.0.1/admin` (red privada de Vercel/infraestructura)

El servidor Next.js hará la request desde dentro de la red, exponiendo servicios internos.

**Fix requerido:**
```ts
// Validar que endpoint_url sea HTTPS y no sea IP privada/loopback
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    const hostname = parsed.hostname
    // Rechazar loopback, private ranges, link-local
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(hostname)) return false
    return true
  } catch { return false }
}

if (!isSafeUrl(agent.endpoint_url)) {
  return NextResponse.json({ error: 'Invalid agent endpoint' }, { status: 422 })
}
```

---

## MENOR

### M-01 — Sin CHECK constraint `balance_usdc >= 0`
**Archivo:** `supabase/migrations/032_sandbox_credits.sql`  
La tabla `sandbox_credits` no tiene `CHECK (balance_usdc >= 0)`. La función `deduct_sandbox_balance` lo valida en lógica, pero si el refund bug (B-01) es explotado en formas no previstas, el balance podría quedar en valor negativo.

**Fix:** Agregar constraint a la tabla:
```sql
ALTER TABLE sandbox_credits ADD CONSTRAINT chk_balance_non_negative CHECK (balance_usdc >= 0);
```

---

### M-02 — `CREATE POLICY` no es idempotente
**Archivo:** `supabase/migrations/032_sandbox_credits.sql` línea 11  
```sql
CREATE POLICY "users_own_sandbox_credits" ON sandbox_credits ...
```
No usa `IF NOT EXISTS`. Si la migración se re-ejecuta (rollback parcial, CI, restore), falla con error `policy already exists`.

**Fix:**
```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'users_own_sandbox_credits'
  ) THEN
    CREATE POLICY "users_own_sandbox_credits" ON sandbox_credits
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;
```

---

### M-03 — Sin validación de email verificado → farming multi-cuenta
**Archivo:** `src/app/api/v1/sandbox/invoke/[slug]/route.ts` línea 66  
El endpoint crea `sandbox_credits` vía `upsert` para **cualquier usuario autenticado**, incluyendo usuarios con email no verificado. Un actor malicioso puede crear N cuentas con emails desechables y obtener $0.5 USDC sandbox por cuenta.

El daño es limitado (créditos sandbox, no reales), pero genera ruido en métricas y carga en infra.

**Fix recomendado:**
```ts
if (!user.email_confirmed_at) {
  return NextResponse.json({ error: 'Email not verified' }, { status: 403 })
}
```
O configurar Supabase Auth para requerir verificación antes de permitir sesiones activas.

---

### M-04 — `is_trial=true` e impacto en ganancias del creator (ambigüedad SDD)
**Archivo:** `src/app/api/v1/sandbox/invoke/[slug]/route.ts` línea 166  
Las llamadas sandbox se registran con `is_trial: true`. Si el cálculo de revenue del creator **excluye** `is_trial=true`, correcto — los créditos sandbox no son dinero real. Si **incluye** `is_trial=true`, el creator estaría "ganando" de transacciones no fondeadas.

El SDD de WAS-75 no especifica explícitamente el tratamiento de `is_trial` en el cálculo de comisiones.

**Fix recomendado:** Confirmar en SDD si creators ganan algo de sandbox calls. Si no, documentar explícitamente en el cálculo de `creator_earnings` que se filtran `is_trial=true` y `payment_type='sandbox'`.

---

## Resumen STRIDE

| # | Amenaza | Tipo STRIDE | Clasificación |
|---|---------|-------------|---------------|
| B-01 | Refund race condition → recuperar créditos ya gastados | Tampering / EoP | **BLOQUEANTE** |
| B-02 | SSRF via endpoint_url sin validar | Information Disclosure / EoP | **BLOQUEANTE** |
| M-01 | Sin CHECK constraint balance ≥ 0 | Tampering | MENOR |
| M-02 | CREATE POLICY no idempotente | Availability | MENOR |
| M-03 | Farming multi-cuenta sin email verificado | Spoofing / EoP | MENOR |
| M-04 | is_trial=true impacto en creator revenue sin especificar | Tampering | MENOR |

---

## Veredicto

**BLOQUEANTEs deben corregirse antes de ship.** B-01 y B-02 son explotables en producción.  
Los MENORs pueden entrar en backlog inmediato post-ship o como fix en el mismo PR.

> **AR DONE WAS-75 — 2 BLOQUEANTE, 4 MENOR**
