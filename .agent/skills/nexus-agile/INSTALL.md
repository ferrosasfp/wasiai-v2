# Instalar NexusAgil en tu proyecto

## Opción 1: Git Submodule (recomendado)

Agrega NexusAgil como submodule en la carpeta de skills de tu proyecto:

```bash
# Para Claude Code / OpenClaw
git submodule add https://github.com/ferrosasfp/NexusAgile.git .claude/skills/nexus-agil

# Commit
git add .gitmodules .claude/skills/nexus-agil
git commit -m "chore: add NexusAgil skill as submodule"
```

Para actualizar a la última versión:
```bash
cd .claude/skills/nexus-agil
git pull origin master
cd ../../..
git add .claude/skills/nexus-agil
git commit -m "chore: update NexusAgil skill"
```

## Opción 2: Copiar directo

```bash
# Clonar y copiar
git clone https://github.com/ferrosasfp/NexusAgile.git /tmp/nexus-agil
mkdir -p .claude/skills/nexus-agil
cp /tmp/nexus-agil/SKILL.md .claude/skills/nexus-agil/
cp -r /tmp/nexus-agil/references .claude/skills/nexus-agil/
rm -rf /tmp/nexus-agil
```

## Estructura resultante

```
tu-proyecto/
├── .claude/
│   └── skills/
│       └── nexus-agil/
│           ├── SKILL.md              ← Instrucciones para el agente
│           └── references/
│               ├── adversarial_review_checklist.md
│               ├── agents_roster.md
│               ├── launch_flow.md
│               ├── project_context_template.md
│               ├── quality_pipeline.md
│               ├── quick_flow.md
│               ├── sdd_template.md
│               ├── sprint_cadence.md
│               ├── story_file_template.md
│               └── validation_report_template.md
```

## Verificar

Menciona "NexusAgil" en tu conversación con el agente. Debería activar el skill automáticamente.

## Archivos

| Archivo | Para quién | Propósito |
|---------|-----------|-----------|
| `README.md` | Humanos | Documentación de la metodología |
| `SKILL.md` | Agente IA | Checklist imperativo de ejecución |
| `references/` | Agente IA | Templates y checklists detallados |
| `INSTALL.md` | Humanos | Esta guía |
