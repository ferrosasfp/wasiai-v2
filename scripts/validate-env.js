#!/usr/bin/env node
// scripts/validate-env.js
// WAS-119 — Pre-deploy env validation
// Lee keys de .env.example (contrato) y verifica presencia en process.env
// Exit 0 = OK | Exit 1 = REQUIRED var(s) missing

'use strict';

const fs = require('fs');
const path = require('path');

// ─── ANSI colors ──────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  red:   '\x1b[31m',
  green: '\x1b[32m',
  yellow:'\x1b[33m',
  cyan:  '\x1b[36m',
  gray:  '\x1b[90m',
};

// ─── REQUIRED vars — rompen en runtime si faltan ──────────────────────────────
const REQUIRED_VARS = new Set([
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPERATOR_PRIVATE_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'PINATA_JWT',
  'CRON_SECRET',
  'WASIAI_SYSTEM_CREATOR_ID',
  'AGENT_WALLET_ENCRYPTION_KEY',
]);

// ─── Parser de .env.example ───────────────────────────────────────────────────
/**
 * Extrae keys de un archivo .env.example
 * Ignora líneas que empiezan con # y líneas vacías
 * @param {string} filePath
 * @returns {string[]}
 */
function parseEnvExample(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`${c.red}ERROR: .env.example no encontrado en ${filePath}${c.reset}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const keys = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Saltar comentarios y líneas vacías
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Extraer key (todo antes del primer =)
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key) keys.push(key);
  }

  return keys;
}

// ─── Verificación ─────────────────────────────────────────────────────────────
/**
 * @param {string[]} keys
 * @returns {{ ok: string[], missing: string[], warnings: string[] }}
 */
function checkEnv(keys) {
  const ok = [];
  const missing = [];
  const warnings = [];

  for (const key of keys) {
    const value = process.env[key];
    const present = value !== undefined && value !== '';

    if (present) {
      ok.push(key);
    } else if (REQUIRED_VARS.has(key)) {
      missing.push(key);
    } else {
      warnings.push(key);
    }
  }

  return { ok, missing, warnings };
}

// ─── Report ───────────────────────────────────────────────────────────────────
function printReport({ ok, missing, warnings }, totalKeys) {
  console.log(`\n${c.bold}${c.cyan}╔══════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.cyan}║   WasiAI v2 — Env Validation Report     ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}╚══════════════════════════════════════════╝${c.reset}\n`);

  if (ok.length > 0) {
    console.log(`${c.green}${c.bold}✅ OK (${ok.length}/${totalKeys})${c.reset}`);
    for (const key of ok) {
      console.log(`   ${c.green}✓${c.reset} ${key}`);
    }
  }

  if (warnings.length > 0) {
    console.log(`\n${c.yellow}${c.bold}⚠️  OPTIONAL — ausentes (${warnings.length})${c.reset}`);
    for (const key of warnings) {
      console.log(`   ${c.yellow}⚠${c.reset} ${key} ${c.gray}(optional — feature desactivada o tiene default)${c.reset}`);
    }
  }

  if (missing.length > 0) {
    console.log(`\n${c.red}${c.bold}❌ REQUIRED — FALTANTES (${missing.length})${c.reset}`);
    for (const key of missing) {
      console.log(`   ${c.red}✗${c.reset} ${c.bold}${key}${c.reset} ${c.red}← REQUERIDA${c.reset}`);
    }
  }

  console.log(`\n${c.gray}─────────────────────────────────────────────${c.reset}`);

  if (missing.length === 0) {
    console.log(`${c.green}${c.bold}RESULTADO: ✅ Entorno válido — listo para deploy${c.reset}\n`);
  } else {
    console.log(`${c.red}${c.bold}RESULTADO: ❌ Deploy BLOQUEADO — ${missing.length} var(s) REQUIRED faltante(s)${c.reset}`);
    console.log(`${c.gray}Configura las vars marcadas con ❌ antes de continuar.${c.reset}\n`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const envExamplePath = path.resolve(process.cwd(), '.env.example');
  const keys = parseEnvExample(envExamplePath);

  console.log(`${c.gray}Leyendo contrato: ${envExamplePath}${c.reset}`);
  console.log(`${c.gray}Keys en contrato: ${keys.length}${c.reset}`);

  const result = checkEnv(keys);
  printReport(result, keys.length);

  if (result.missing.length > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main();
