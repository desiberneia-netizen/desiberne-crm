# Desiberne CRM — Contexto para Claude Code

## Projeto

CRM interno da Desiberne + sistema de análise de presença digital com agentes de IA.
Gerencia leads, propostas, tarefas, financeiro, contratos e calendário.
Motor de análise de clientes via Google Places + Brave Search + OpenAI.

## Stack

- **Frontend**: SPA vanilla JS (sem framework, sem build step) — `index.html` (~7.500 linhas)
- **Backend**: Vercel serverless functions em Node.js ESM — `api/*.js`
- **Banco**: Supabase (Postgres + Auth) — migrations em `supabase/*.sql`
- **IA atual**: OpenAI `gpt-4o-mini` via `api/_ai.js`
- **Pesquisa**: Google Places API + Brave Search API via `api/_research.js`
- **Deploy**: Vercel (funções serverless automáticas em `api/`)

## Estrutura de arquivos

```
index.html              ← app completo (login + todas as telas + JS)
proposta.html           ← página pública de proposta (sem auth)
package.json            ← { "type": "module" } — sem dependências de build
api/
  _ai.js                ← interpreta evidências via OpenAI (não pesquisa)
  _auth.js              ← middleware de autenticação das funções
  _prompts.js           ← prompts centralizados (AGENT_VERSION, PROMPT_VERSION)
  _research.js          ← coleta evidências (Places + Brave + fetch site)
  analise-iniciar.js    ← dispara análise de presença digital de um lead
  analise-revisar.js    ← reabre análise existente
  analise-status.js     ← polling do status da análise
  gerar-texto-proposta.js
  normalizar-segmento.js
  proposta-aprovar.js
  proposta-publica.js
  proposta-responder.js
  prospeccao-material.js
supabase/
  migration_*.sql       ← histórico de migrations (não aplicar sem revisão)
.claude/
  CLAUDE.md             ← este arquivo (carregado automaticamente)
  agents/               ← personas e contratos dos agentes internos Desiberne
```

## Convenções de desenvolvimento

- **Nunca introduzir build tooling** (webpack, vite, tsc). Projeto é zero-build por decisão.
- **JS puro** no frontend — sem imports de módulos no browser (ESM só no `api/`).
- **Prompts centralizados** em `api/_prompts.js`. Nunca espalhar strings de prompt pelo código.
- **Bump de versão obrigatório**: `PROMPT_VERSION` a cada mudança de texto, `AGENT_VERSION` a cada mudança de lógica em `_prompts.js`.
- **Migrations sequenciais**: arquivos `supabase/migration_*.sql` — não editar migrations já aplicadas, criar nova.
- **Supabase key pública** (`sb_publishable_*`) é segura para expor no frontend — não é um vazamento.
- **Variáveis de ambiente nas funções**: `OPENAI_API_KEY`, `BRAVE_API_KEY`, `GOOGLE_MAPS_KEY` via Vercel env.

## Sistema de Agentes Desiberne IA

Arquitetura multi-agente para produção de inteligência de marketing e conteúdo.
JARBAS é o orquestrador central. Os demais são especialistas que ele coordena.

Agentes definidos em `.claude/agents/`:

| Agente | Papel |
|--------|-------|
| JARBAS | Orquestrador — recebe brief, delega, monta entrega final |
| RADAR | Mercado e tendências — monitora movimentos do setor |
| BENCH | Referências — engenharia reversa de concorrentes e cases |
| COPY | Conteúdo — textos, roteiros, legendas, e-mails |
| DESIGNER | Direção visual — briefings e prompts para ferramentas de imagem |
| SENTINELA | Qualidade — revisa output dos outros agentes |
| PLANNER | Calendário editorial — planejamento e sequenciamento |
| ANALYTICS | Performance — leitura de métricas e recomendações |

Para detalhes de um agente: leia `.claude/agents/NOME.md`.
