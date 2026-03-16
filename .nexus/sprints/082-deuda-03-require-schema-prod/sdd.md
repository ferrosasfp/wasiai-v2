# SDD — DEUDA-03: Activar NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=true en prod

**Issue:** DEUDA-03 | **Clasificación:** FAST-FIX | **Fecha:** 2026-03-15 | **Depende de:** WAS-206 DONE

---

## Context

Activar la variable de entorno en Vercel (solo environment `production`) para los proyectos `wasiai-prod` y `wasiai-v2`. No requiere cambio de código.

---

## Wave 0 — Pre-flight

```bash
# Verificar que WAS-206 está deployado
curl -s https://wasiai-agents.vercel.app/agents/wasi-chainlink-price \
  -X POST -H "Content-Type: application/json" \
  -d '{"token":"AVAX"}' | grep -c "price_usd"
# Expected: 1

# Verificar que Step3Technical.tsx es exclusivo de publicación
grep -rn "Step3Technical" src/ --include="*.tsx" | grep -v "node_modules"
# Expected: solo en PublishForm o similar, NO en edit/
```

---

## Wave 1 — Activar en Vercel

```bash
# wasiai-prod — solo production
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npx vercel env add NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA production --project wasiai-prod
# Input: true

# wasiai-v2 — solo production  
npx vercel env add NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA production
# Input: true
```

**Build gate Wave 1:**
```bash
# Verificar que se guardó
cd /tmp/wasiai-prod-tmp && npx vercel env pull .env.check --environment production 2>/dev/null
grep "REQUIRE_INPUT_SCHEMA" .env.check
# Expected: NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA="true"
```

---

## Wave 2 — Actualizar .env.example

```bash
# Agregar documentación en .env.example
echo "\n# Input schema validation\nNEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=true # Required for production behavior — forces creators to provide input schema" >> /home/ferdev/.openclaw/workspace/wasiai-v2/.env.example

git add .env.example
git commit -m "chore(DEUDA-03): document NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA in .env.example"
git push
```

---

## Wave 3 — Verificar en prod

```bash
# El deploy se disparará automáticamente por el push anterior
# Esperar ~2 min y verificar que el formulario de publicación muestra el campo como requerido
curl -s https://app.wasiai.io/es/publish | grep -i "schema" | head -5
```

---

## Rollback

```bash
# En Vercel Dashboard: Settings → Environment Variables → eliminar NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA
# O via CLI:
npx vercel env rm NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA production --yes
# Redeploy automático en ~2 min
```

---

## Critical Constraints

- **SOLO** environment `production` — NO activar en `preview` ni `development`
- **DESPUÉS** de WAS-206 en DONE — verificar en Wave 0
- La restricción aplica solo a publicaciones nuevas — edición de agentes existentes no se ve afectada (validación en Step3Technical.tsx que es exclusivo del flujo publish)
