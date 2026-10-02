<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Regras do motor de planejamento

- `docs/planning-spec.md` é a fonte principal das regras de negócio.
- A Simplificada é um baseline imutável: nunca deve ser sobrescrita por busca,
  sugestão, IA ou aplicação de cenário.
- O planejamento é determinístico. LLMs podem explicar resultados, mas não
  definem sequência, disponibilidade ou capacidade.
- Todos os perfis usam o mesmo snapshot, simulador e restrições físicas. O
  perfil altera objetivo, não a realidade operacional.
- Restrições obrigatórias eliminam candidatos; parâmetros `PENDENTE` não podem
  virar valores implícitos.
- Qualquer alteração no motor exige teste de regressão e validação de cenário.
