# Desiberne — Contexto Global para Claude Code

## 1. Sobre o projeto

Este repositório contém duas coisas distintas:

**CRM interno** — gerencia leads, propostas, tarefas, financeiro, contratos e calendário.
**Desiberne IA** — sistema multi-agente de inteligência de marketing e conteúdo para a própria Desiberne.

Os agentes são documentados em `.claude/agents/` e carregados nesta sessão.
O CRM é o código em `index.html`, `api/` e `supabase/`.

## 2. Stack do CRM

| Camada | Tecnologia |
|--------|-----------|
| Frontend | SPA vanilla JS — `index.html` (~7.500 linhas, sem build step) |
| Backend | Vercel serverless Node.js ESM — `api/*.js` |
| Banco | Supabase (Postgres + Auth) — migrations em `supabase/*.sql` |
| IA (análise de leads) | OpenAI `gpt-4o-mini` via `api/_ai.js` |
| Pesquisa | Google Places API + Brave Search API via `api/_research.js` |

## 3. Estrutura de arquivos

```
index.html                  ← app completo (login + todas as telas + JS)
proposta.html               ← página pública de proposta (sem auth)
package.json                ← { "type": "module" } — zero dependências de build
api/
  _ai.js                    ← interpreta evidências via OpenAI (não pesquisa)
  _auth.js                  ← middleware de autenticação
  _prompts.js               ← prompts centralizados (AGENT_VERSION, PROMPT_VERSION)
  _research.js              ← coleta evidências (Places + Brave + fetch de site)
  analise-iniciar.js        ← dispara análise de presença digital de um lead
  analise-revisar.js        ← reabre análise existente
  analise-status.js         ← polling de status
  gerar-texto-proposta.js
  normalizar-segmento.js
  proposta-aprovar.js / proposta-publica.js / proposta-responder.js
  prospeccao-material.js
supabase/
  migration_*.sql           ← histórico sequencial (não editar aplicadas — criar nova)
.claude/
  CLAUDE.md                 ← este arquivo (auto-carregado a cada sessão)
  agents/                   ← arquitetura operacional dos agentes Desiberne IA
```

## 4. Convenções de desenvolvimento do CRM

- **Zero build tooling** — nunca introduzir webpack, vite, tsc ou similares
- **JS puro no frontend** — ESM apenas em `api/`
- **Prompts centralizados** em `api/_prompts.js` — nunca espalhar strings de prompt no código
- **Versioning obrigatório**: bump `PROMPT_VERSION` a cada mudança de texto, `AGENT_VERSION` a cada mudança de lógica
- **Migrations sequenciais** — nunca editar migration já aplicada, criar nova
- **Supabase key pública** (`sb_publishable_*`) é segura no frontend — não é vazamento
- **Env vars das funções**: `OPENAI_API_KEY`, `BRAVE_API_KEY`, `GOOGLE_MAPS_KEY` via Vercel

## 5. Posicionamento da Desiberne

> "Tire sua empresa do modo de hibernação digital. Desperte para um mundo de novas oportunidades."

A Desiberne trabalha com tecnologia, presença digital, aquisição, gestão, automação e inteligência comercial.
A comunicação não vende tecnologia pela tecnologia — vende percepção, oportunidade, transformação e resultado.

## 6. Sistema de Agentes Desiberne IA

JARBAS é o orquestrador. Os especialistas executam sob sua coordenação.

| Agente | Papel | Arquivo |
|--------|-------|---------|
| JARBAS | Orquestrador central — interpreta, decide, coordena, entrega | `agents/JARBAS.md` |
| RADAR | Pesquisa mercado, tendências, comportamento e concorrência | `agents/RADAR.md` |
| BENCH | Analisa referências e identifica por que algo funciona | `agents/BENCH.md` |
| COPY | Transforma estratégia em conteúdo humano e comercial | `agents/COPY.md` |
| DESIGNER | Direção visual — briefing, composição, prompts para IA de imagem | `agents/DESIGNER.md` |
| MOTION | Motion design — comportamento, animações, scroll, interação, microinterações | `agents/MOTION.md` |
| SENTINELA | Controle de qualidade — veto final antes de qualquer entrega | `agents/SENTINELA.md` |
| PLANNER | Calendário editorial — sequência, frequência, canais | `agents/PLANNER.md` |
| ANALYTICS | Transforma resultados em decisões para o próximo ciclo | `agents/ANALYTICS.md` |

Detalhes operacionais de cada agente: leia o arquivo correspondente em `agents/`.

Referência central de identidade visual: `.claude/identidade-visual.md`
