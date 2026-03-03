# Adversarial Review — NNN-024 / WAS-103 (Arquitectura Dual-Flow OZ-A1)

**Reviewer:** San — Rol Adversary (NexusAgil QUALITY)  
**Commit revisado:** `58002e4`  
**Fecha:** 2026-03-02  
**Veredicto:** ✅ **APPROVED** (con 1 hallazgo MENOR documentado)

---

## Resumen ejecutivo

El commit `58002e4` implementa fielmente el story WAS-103: agrega `whenNotPaused` a `refundKeyToEarnings`, inserta el bloque FLOW GUIDE y añade 7 tags `@dev flow:` en NatSpec. Los 138 tests siguen pasando. No hay cambios de lógica ni storage. Se identifica 1 hallazgo MENOR: cambio en `package.json`/`package-lock.json` bundleado en el mismo commit, violando la Constraint Directive de scope.

---

## Tabla de hallazgos

| # | Categoría | Hallazgo | Clasificación | Evidencia |
|---|-----------|----------|---------------|-----------|
| 1 | Corrección funcional | `whenNotPaused` en `refundKeyToEarnings`: si el contrato está pausado Y el timeout de emergencia no ha expirado, el operador no puede refundir y el usuario tampoco puede hacer emergency withdraw. Fondos temporalmente inaccesibles — comportamiento **intencional by design** del mecanismo de pausa. El owner puede unpause para desbloquear. No hay path de pérdida permanente de fondos. | **OK** | `emergencyWithdrawKey` no tiene `whenNotPaused` (línea 501+); el owner siempre puede unpause. Documentado explícitamente en SDD §3.2. |
| 2 | Seguridad | El refactor **reduce** superficie de ataque: antes, un operador comprometido podía llamar `refundKeyToEarnings` incluso con el contrato pausado, moviendo balances de `keyBalances` a `earnings` sin supervisión. Ahora eso está bloqueado. Mejora neta. | **OK** | `git diff` línea -481: `onlyOperator nonReentrant` → +481: `onlyOperator nonReentrant whenNotPaused` |
| 3 | Regresiones | 138/138 tests pasan post-commit. Ningún test existente ejecuta `refundKeyToEarnings` con el contrato pausado (validado en story file §Tests de regresión). | **OK** | `forge test` output: `138 tests passed, 0 failed, 0 skipped` |
| 4 | Constraint Directives | **VIOLACIÓN MENOR:** `package.json` y `package-lock.json` fueron modificados en el mismo commit (se agregó `supabase: ^2.76.15` como devDependency). Story dice explícitamente: *"NO tocar ningún archivo fuera de `contracts/src/WasiAIMarketplace.sol`"*. Cambio no relacionado con WAS-103 bundleado en el commit de seguridad. | **MENOR** | `git diff HEAD~1 --name-only` muestra `package.json` y `package-lock.json`. `git diff HEAD~1 package.json` confirma adición de `supabase ^2.76.15`. |
| 5 | Scope drift | Mismo hallazgo que #4. El cambio de supabase es completamente ajeno al scope de WAS-103. No afecta al contrato ni a los tests, pero ensucía el historial de auditoría del commit. | **MENOR** | Ver #4. |
| 6 | Lógica de negocio | Cero cambios en splits, cálculos de fees, lógica de earnings ni flujos de transferencia USDC. El diff muestra exclusivamente adiciones de comentarios y un modificador. | **OK** | `git diff HEAD~1 contracts/src/WasiAIMarketplace.sol` — todas las líneas modificadas son `+` (adiciones), ninguna es lógica. |
| 7 | Storage layout | No se agregaron variables de estado. El orden de storage no cambió. | **OK** | `git diff` — no hay líneas `+mapping`, `+uint256`, `+address` ni cambios en bloques de variables. |
| 8 | NatSpec `@dev flow:` | Los 7 tags fueron insertados correctamente. Un punto de atención: `withdraw()` tiene `@dev flow: x402 (also accessible after Key refund via refundKeyToEarnings)` — esto es técnicamente correcto pero puede confundir a un auditor que lea que `withdraw()` tiene "dos flujos". Semánticamente `withdraw()` es x402-only; el paréntesis describe conectividad, no membresía. Aceptable porque el FLOW GUIDE en el bloque de cabecera lista `withdraw()` solo bajo x402. | **OK** | `grep -n "@dev flow:"` retorna 7 líneas exactas. Consistente con el FLOW GUIDE. |

---

## Análisis detallado — Hallazgo BLOQUEANTE descartado

### ¿Puede `whenNotPaused` en `refundKeyToEarnings` causar pérdida de fondos?

**Escenario de ataque explorado:**
1. Owner pausa el contrato (emergencia)
2. Usuario tiene `keyBalances[keyId] = 500 USDC`
3. Operador intenta llamar `refundKeyToEarnings` → REVERTS (correcto)
4. Usuario intenta `emergencyWithdrawKey` → pasa si `block.timestamp > lastOperatorActivity + EMERGENCY_TIMEOUT`
5. Si el timeout NO ha expirado: usuario no puede recuperar fondos durante la pausa

**Conclusión:** Los fondos están **temporalmente bloqueados, no perdidos**. El owner que pausó puede unpause para permitir el refund. `emergencyWithdrawKey` sin `whenNotPaused` garantiza la salida trustless una vez expirado el timeout. No hay path de pérdida permanente. El SDD §3.2 documenta esta decisión como intencional.

---

## Constraint Directives — Checklist

| Directiva | Estado |
|-----------|--------|
| ✅ OBLIGATORIO: `forge test` pasa 138 tests | ✅ Cumple |
| ✅ OBLIGATORIO: Solo `whenNotPaused` como cambio funcional | ✅ Cumple |
| ✅ OBLIGATORIO: Resto son comentarios/NatSpec | ✅ Cumple |
| 🚫 PROHIBIDO: NO cambiar body de funciones | ✅ Cumple |
| 🚫 PROHIBIDO: NO cambiar splits/fees | ✅ Cumple |
| 🚫 PROHIBIDO: NO cambiar storage layout | ✅ Cumple |
| 🚫 PROHIBIDO: NO agregar variables de estado | ✅ Cumple |
| 🚫 PROHIBIDO: NO crear nuevos modifiers | ✅ Cumple |
| 🚫 PROHIBIDO: NO tocar `emergencyWithdrawKey` (sin `whenNotPaused`) | ✅ Cumple |
| 🚫 PROHIBIDO: NO agregar `whenNotPaused` a `recordInvocation` | ✅ Cumple |
| 🚫 PROHIBIDO: NO agregar `whenNotPaused` a `withdraw` | ✅ Cumple |
| 🚫 PROHIBIDO: NO tocar `.t.sol` | ✅ Cumple |
| 🚫 PROHIBIDO: NO tocar archivos fuera de `WasiAIMarketplace.sol` | ⚠️ **VIOLADO** — `package.json` y `package-lock.json` modificados |

---

## Recomendaciones (no bloqueantes)

1. **[MENOR] Commit hygiene:** El cambio de `supabase` en `package.json` debe ir en un commit separado con mensaje propio. Para futuros audits de seguridad, los commits de cambios en contratos deben ser atómicos y contener únicamente los archivos del scope. Recomendar squash o rebase si el historial aún es modificable.

2. **[INFO] NatSpec `withdraw()`:** Considerar redactar el tag como `@dev flow: x402` y mover la nota de conectividad a una línea `@dev` separada para evitar ambigüedad en lecturas rápidas de audit.

---

## Veredicto final

```
✅ APPROVED
```

El cambio funcional es correcto y bien justificado. Los 138 tests pasan. No hay regresiones, scope drift en el contrato, ni cambios de lógica. El único hallazgo es un **MENOR de proceso** (package.json bundleado). No bloquea el merge.

---

*Generado por San (NexusAgil Adversary) — 2026-03-02 — WAS-103/NNN-024*
