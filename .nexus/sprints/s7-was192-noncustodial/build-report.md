## Build Report — SDD S7-05 / WAS-192

### Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 | ✅ PASS | — | Re-validación OK. Archivos existen, no hay `nonCustodial` namespace previo, PayToCallButton usa `useTranslations('payToCall')`, OnboardingStep3 reutilizado sin crear componentes nuevos. |
| Wave 1 | ✅ DONE | ✅ PASS | `messages/en.json`, `messages/es.json` — añadido namespace `nonCustodial` con keys: `badge`, `tooltip`, `onboardingNote`. Copy EXACTO del SDD §5. |
| Wave 2 | ✅ DONE | ✅ PASS | `src/app/[locale]/page.tsx` — badge verde con ShieldCheck + `tNC('badge')` en hero section (después de HeroDualCard). |
| Wave 3 | ✅ DONE | ✅ PASS | `src/features/payments/components/PayToCallButton.tsx` — nota non-custodial visible en estados `idle` y `no_wallet`. |
| Wave 4 | ✅ DONE | ✅ PASS | `src/components/onboarding/OnboardingStep3.tsx` — nota de onboarding (cómo funcionan los pagos) añadida sobre el botón de completar. |

### Commit
- Hash: `5a0c57718`
- Message: `feat(WAS-192): add non-custodial messaging in landing and onboarding`
- Files changed: 5

### Discrepancias encontradas
Ninguna. Todos los archivos existían y los tipos eran compatibles.

### Notas
- El badge en landing usa `ShieldCheck` de lucide-react (ya era dependencia del proyecto).
- OnboardingStep3 era el paso más apropiado para la nota de primer uso (conectar wallet / configurar pagos).
- Copy 100% del SDD §5 — no se inventó ningún texto.
- `tsc --noEmit` pasó sin errores.
