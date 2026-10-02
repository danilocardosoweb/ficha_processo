# Sala de controle — validação de 11/09/2026

## Implementado

- Workspace v3 com painéis reposicionáveis, seleção por função e programação em painel próprio.
- Janela exclusiva vinculada à aba principal; fechar retorna o conteúdo. Não é processo independente: a aba principal precisa permanecer aberta.
- Contagem de pareceres realmente concluídos, falhas, tempo decorrido e histórico de consultas; não é porcentagem estimada de tempo.
- Teste sintético de ferramenta separado da análise de produção.
- Catálogo atualizado de modelos gratuitos do OpenRouter, com suporte declarado a ferramentas. Modelos `:free` e `openrouter/free` usam preço máximo de entrada/saída zero.
- LM Studio e OpenRouter permanecem separados, sem fallback local para nuvem.
- Evidências paginadas e explicitamente parciais; totais continuam calculados sobre a carga inteira.
- Até oito chamadas por agente, dez consultas/testes e tempo máximo limitado. Oito etapas permitem consultas sequenciais, conclusão e correção. Rodada completa: até 40 chamadas.
- Ferramentas anunciam apenas seções permitidas ao papel; validação de evidências continua obrigatória.
- Checagem de origem compara a autoridade solicitada pelo navegador, sem aceitar origem arbitrária encaminhada.

## Evidência dos testes

- Compilação de produção e verificação estática concluídas.
- 35 testes automáticos aprovados; três integrações optativas não executadas pela suíte padrão.
- Catálogo autenticado carregou 17 modelos gratuitos no momento da consulta. Essa quantidade não é fixa.
- Testes reais de dois modelos gratuitos retornaram HTTP 404 por política de privacidade. A resposta do OpenRouter especificou `Free model training` e indicou as configurações de privacidade da conta. A proteção não foi relaxada.
- Qwen3-8B: teste sintético de ferramentas aprovado em 2,9 s.
- Qwen3-8B: PCP concluiu a análise da carga real de 65 ordens em seis etapas, 25 s, zero falhas. Nenhuma proposta aplicada.
- A ida à janela exclusiva e o retorno preservaram a seleção do provedor/modelo. O navegador integrado não expôs o conteúdo da janela secundária para inspeção visual completa.
- Última rodada real: quatro de cinco pareceres concluídos em 182 s (PCP, operador, qualidade e líder). O líder recebeu três pareceres anteriores. O montador atingiu o limite de análise sem concluir. Nenhuma proposta aceita ou aplicada.
- Uma rodada anterior concluiu o montador, mas falhou em outros papéis. O resultado do Qwen3-8B é inconsistente: não considerar a integração homologada nem anunciar cinco agentes estáveis.
- A entrega local foi limitada por instrução a um parecer conciso; há uma tentativa adicional de correção de formato dentro das oito etapas. Texto sem chamada de ferramenta nunca é aceito como parecer.

## Limitações

Leituras são pontuais por análise, não monitoramento contínuo. Não há execução física automática nem liberação automática de qualidade. OpenClaw ainda não está integrado. Pareceres e decisões ficam no histórico pessoal local; não substituem a persistência do cenário e os registros operacionais.

O Qwen3 original usa o controle documentado `/no_think` para reservar a resposta às chamadas de ferramentas; isso não é aplicado indiscriminadamente a outros modelos. Referência: https://github.com/QwenLM/Qwen3/blob/main/docs/source/getting_started/quickstart.md
