# Security Review — SDD #214 (commit 6433a65)

**Revisor:** San (NexusAgil Security Reviewer)
**Fecha:** 2026-03-14
**Clasificación:** QUALITY — revisión obligatoria
**Endpoint:** `POST /api/v1/auth/agent-signup`

---

## Superficie de ataque

| Categoría | Endpoint/función | Auth | Status |
|-----------|-----------------|------|--------|
| HTTP Endpoint | `POST /api/v1/auth/agent-signup` | Opcional (AGENT_SIGNUP_KEY) | ⚠️ Público por defecto si env no configurada |
| User Provisioning | `serviceClient.auth.admin.createUser()` | Service Role (bypasa RLS) | ⚠️ Sin límite de cuentas por dominio |
| API Key Emission | `generateApiKey()` + insert `agent_keys` | Ligado a user creado | ✅ Budget 0, key hasheada |
| Rate Limiting | `getAgentSignupLimit()` — 5/h por IP | IP via x-forwarded-for | ⚠️ Bypasseable |

---

## Findings

| # | Severidad | Categoría | Detalle | Archivo:línea | Explotabilidad |
|---|-----------|-----------|---------|---------------|----------------|
| F-01 | **HIGH** | Auth | Comparación de `AGENT_SIGNUP_KEY` con `!==` (string equality) en lugar de `timingSafeEqual`. Vulnerable a timing attack: un atacante puede inferir caracteres correctos midiendo tiempos de respuesta. | `route.ts:18-21` | Media-Alta: requiere latencia baja/controlada (red local o misma región cloud) |
| F-02 | **HIGH** | Auth | `AGENT_SIGNUP_KEY` es opcional. Si no se setea en producción, el endpoint es completamente público — cualquiera puede crear usuarios y obtener API keys del marketplace sin restricción. El código comenta "es intencional" implícitamente, pero no hay advertencia ni valor default seguro (fail-closed). | `route.ts:14-16`, `env.ts` | Crítica si el env var se olvida configurar |
| F-03 | **MEDIUM** | Red / Rate Limiting | `getIdentifier()` lee `x-forwarded-for` directamente. Si el deployment no está detrás de un proxy de confianza que sanitice este header, un atacante puede spoofear la IP con `X-Forwarded-For: 1.2.3.4` y bypassear el rate limit trivialmente. Con 5 req/h × N IPs = creación masiva de usuarios. | `ratelimit.ts` (getIdentifier) | Alta si no hay proxy/CDN que reescriba el header |
| F-04 | **MEDIUM** | Information Disclosure | En el bloque de error 500: `return NextResponse.json({ error: createError.message }, ...)`. Se expone el mensaje de error interno de Supabase directamente al cliente. Puede revelar detalles del esquema, configuración de auth, o información interna del sistema. | `route.ts:47-49` | Media: depende del contenido del mensaje de Supabase |
| F-05 | **MEDIUM** | Auth | Sin `AGENT_SIGNUP_KEY`, el endpoint no tiene ningún mecanismo anti-bot (CAPTCHA, proof-of-work, email verification delay). Rate limit por IP es insuficiente con proxies rotativos. Un atacante puede crear miles de cuentas huérfanas e inflar la base de usuarios. | `route.ts` (flujo completo) | Alta con botnet/proxies rotativos |
| F-06 | **LOW** | Input Validation | `emailLocalPart = email.split('@')[0].slice(0, 50)` — Zod valida que sea email válido, pero el local part puede contener caracteres especiales (`+`, `.`, `'`, espacios codificados, unicode). Si el campo `name` en `agent_keys` se usa en queries sin parametrización en otro lugar, hay superficie de inyección indirecta. En el insert actual es seguro (parametrizado via Supabase client), pero el dato queda almacenado "sucio". | `route.ts:54` | Baja directa, media si se consume sin sanitizar después |
| F-07 | **LOW** | Data Exposure | `user_id` (UUID de Supabase Auth) se retorna en la respuesta 201. Aunque un UUID solo no es explotable, su exposición puede facilitar ataques de enumeración o IDOR en otros endpoints que acepten `user_id` como parámetro. | `route.ts:64` | Baja: requiere otros endpoints vulnerables |
| F-08 | **LOW** | Lógica | Rollback parcial: si falla el insert de `agent_keys`, se elimina el usuario (`deleteUser`). Sin embargo, si `deleteUser` también falla (error de red, timeout), el usuario queda creado sin API key — estado inconsistente en la DB. No hay alerta/log de este caso. | `route.ts:58-60` | Baja: edge case operacional, no explotable directamente |
| F-09 | **INFO** | Hardening | No hay logging de auditoría explícito para la creación exitosa de usuario+key. Para un endpoint de provisioning de acceso al marketplace, un audit trail (IP, timestamp, email hasheado, key ID) es crítico para forense y detección de abuso. | `route.ts` (ausencia) | No explotable, pero impacta detección de incidentes |

---

## Análisis detallado de findings críticos

### F-01 — Timing Attack en comparación de AGENT_SIGNUP_KEY

```typescript
// VULNERABLE:
if (!providedKey || providedKey !== signupKey) { ... }

// CORRECTO:
import { timingSafeEqual } from 'crypto'
const safe = timingSafeEqual(Buffer.from(providedKey), Buffer.from(signupKey))
if (!safe) { ... }
```

JavaScript's `!==` es una comparación que puede short-circuit en el primer byte diferente. Con suficientes muestras estadísticas, un atacante puede reconstruir la clave carácter a carácter.

### F-02 — Endpoint público por omisión (fail-open)

El patrón `if (signupKey && signupKey !== '')` significa que el estado de seguridad por defecto es **abierto**. La práctica segura es fail-closed:

```typescript
// RECOMENDADO: fallar si no está configurado en producción
if (process.env.NODE_ENV === 'production' && !signupKey) {
  return NextResponse.json({ error: 'Endpoint not configured' }, { status: 503 })
}
```

### F-03 — IP Spoofing / Rate Limit Bypass

Si el header `x-forwarded-for` no es reescrito por el proxy/CDN antes de llegar a la app, cualquier request puede incluir:

```bash
curl -X POST https://wasiai.io/api/v1/auth/agent-signup \
  -H "X-Forwarded-For: 192.0.2.1" \
  -H "Content-Type: application/json" \
  -d '{"email":"attacker+1@evil.com"}'
```

Con IPs rotativas, un atacante puede crear N×5 usuarios por hora. Esto es especialmente grave dado que el endpoint crea usuarios reales en Supabase Auth.

---

## Resumen

| Severidad | Cantidad |
|-----------|----------|
| CRITICAL | 0 |
| HIGH | 2 |
| MEDIUM | 3 |
| LOW | 3 |
| INFO | 1 |

---

## Veredicto

### ⛔ REQUIERE CORRECCIÓN

**Bloqueantes antes de merge a producción:**

1. **[F-01]** Reemplazar comparación de signup key con `crypto.timingSafeEqual()`
2. **[F-02]** Cambiar comportamiento por defecto a fail-closed en producción (requerir `AGENT_SIGNUP_KEY` si `NODE_ENV=production`)
3. **[F-03]** Verificar que el deploy garantice que `x-forwarded-for` es reescrito por el proxy de confianza (Vercel/CloudFlare), O usar `request.ip` de Next.js en lugar del header crudo

**Recomendados (no bloqueantes):**

4. **[F-04]** Sanitizar mensajes de error de Supabase antes de exponerlos al cliente — mapear a mensajes genéricos
5. **[F-05]** Considerar mecanismo adicional anti-abuso si el endpoint debe ser público (email domain allowlist, honeypot, etc.)
6. **[F-08]** Agregar log de error cuando `deleteUser` falla en el rollback
7. **[F-09]** Agregar audit log estructurado para provisioning exitoso

---

*Review generado por San · NexusAgil Security Review v1.3 · commit 6433a65*
