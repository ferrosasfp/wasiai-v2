# UI de Pipelines — WAS-38

Los Pipelines te permiten encadenar múltiples agentes de WasiAI en un flujo visual, donde el output de un agente se convierte en el input del siguiente. Sin código, directo desde el dashboard.

---

## Cómo acceder

Ve a [wasiai-v2.vercel.app/pipelines](https://wasiai-v2.vercel.app/pipelines).

Necesitás estar autenticado. Desde ahí podés crear, editar y ejecutar pipelines.

---

## Crear un pipeline

1. Clickeá **"Nuevo pipeline"**
2. Dale un nombre descriptivo (ej: "Extraer → Traducir → Resumir")
3. Agregá steps usando el botón **"+ Agregar agente"**
4. Configurá el input del primer step
5. Guardá y ejecutá

---

## Encadenar agentes (pass_output)

El output de cada step se pasa automáticamente al siguiente via la clave `pass_output`.

### Cómo funciona

```
Step 1: extractor-agent
  input: { "url": "https://example.com/article" }
  output: { "text": "Contenido extraído..." }
        ↓ pass_output
Step 2: translator-agent
  input: { "text": "Contenido extraído..." }   ← viene del step anterior
  output: { "text": "Translated content..." }
        ↓ pass_output
Step 3: summarizer-pro
  input: { "text": "Translated content..." }
  output: { "summary": "Resumen final..." }
```

### Mapeo de campos

Si el agente destino espera un campo distinto al que produce el agente origen, podés definir el mapeo en la UI:

```
Step 1 output.text → Step 2 input.content
```

---

## Límites

| Concepto | Límite |
|----------|--------|
| Steps por pipeline | 5 máximo |
| Timeout por step | 30 segundos |
| Pipelines guardados | Sin límite |

> El límite de 5 steps cubre el 95% de los casos de uso. Pipelines más largos están en el roadmap (Sprint 17).

---

## Historial de ejecuciones

Cada ejecución de un pipeline queda registrada en la pestaña **"Historial"** dentro de `/pipelines`.

### Información disponible por ejecución

- Timestamp de inicio y fin
- Estado de cada step (✅ completado / ❌ falló)
- Input y output de cada step (expandible)
- Costo total en USDC
- Job ID de cada step (para debugging)

### Retención

El historial se conserva **30 días**. Podés exportar cualquier ejecución en JSON.

---

## Ejemplo — pipeline vía API (avanzado)

También podés ejecutar un pipeline guardado vía API:

```bash
curl -X POST https://wasiai-v2.vercel.app/api/v1/pipelines/pipe_01HXYZ/run \
  -H "Authorization: Bearer wasi_tu_key" \
  -H "Content-Type: application/json" \
  -d '{
    "input": { "url": "https://example.com/article" }
  }'
```

La respuesta incluye el output final del último step y el historial de cada step intermedio.
