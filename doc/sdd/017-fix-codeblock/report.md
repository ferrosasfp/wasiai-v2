# Report WAS-117 — FIX CodeBlock docs código invisible

**HU:** WAS-117 | **NNN:** 017 | **Modo:** FAST  
**Fecha:** 2026-03-02 | **Estado:** ✅ DONE (fix verificado)

---

## Fix verificado

Archivo: `src/features/docs/components/CodeBlock.tsx`

```tsx
<pre className="overflow-x-auto p-4 text-sm leading-relaxed text-gray-300">
```

El fix `text-gray-300` está presente en el `<pre>` tag — código visible sobre fondo `#0d1117`.

---

## Build status

`npm run build` falla por un warning ESLint **preexistente** y no relacionado:

```
/src/app/api/v1/webhooks/route.ts
  5:27  warning  '_req' is defined but never used  @typescript-eslint/no-unused-vars
ESLint found too many warnings (maximum: 0)
```

Este warning existía antes del fix WAS-117. El CodeBlock.tsx no introduce errores ni warnings.

**El fix es correcto.** El build failure es bloqueante por otra HU pendiente (webhooks).

---

## Archivos modificados

- `src/features/docs/components/CodeBlock.tsx` — `text-gray-300` en `<pre>` ✅
