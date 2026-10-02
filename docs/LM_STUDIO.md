# LM Studio para os cinco agentes

1. No LM Studio, abra Developer e carregue um modelo de chat com suporte a chamadas de ferramentas.
2. Inicie o servidor. O endereço padrão usado pelo aplicativo é http://127.0.0.1:1234/v1.
3. Na Sala de controle, em “Onde os agentes vão pensar?”, selecione “LM Studio · local”.
4. Clique em “Testar conexão / listar modelos”. Selecione o identificador de um modelo no campo Modelo local (ou informe-o exatamente como aparece no LM Studio).
5. Clique em “Iniciar rodada dos cinco agentes”. A IA deve estar ativada nos critérios do aplicativo.

A lista verifica conectividade, não prova que o modelo sabe usar ferramentas. Modelos pequenos, contexto insuficiente e falta de memória podem causar falhas. A interface apresenta esses erros sem aplicar operações. A primeira análise pode demorar durante o carregamento do modelo.

## Configuração do servidor do aplicativo

Sem alterações de ambiente, usa localhost:1234 e não exige chave. Para instalação diferente, configure no ambiente do servidor e reinicie o aplicativo:

```
LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1
LM_STUDIO_API_KEY=<somente se a autenticação do LM Studio estiver ativada>
```

Não coloque a chave em campos NEXT_PUBLIC. O endereço é definido pelo administrador no ambiente, não é recebido do navegador. Redirecionamentos HTTP são recusados. OpenRouter e LM Studio têm chaves e parâmetros separados. A seleção local não exige OPENROUTER_API_KEY e nunca cai automaticamente para a nuvem.

Localhost é o computador que executa o servidor Next.js. Se o aplicativo estiver hospedado em outro computador, seu navegador não encaminha automaticamente as chamadas para o LM Studio do seu PC. O administrador precisa configurar um endereço acessível ao servidor e proteger o acesso à rede.

Esta escolha altera somente a equipe de cinco agentes. O analista de IA das outras seções continua com sua configuração existente. A seleção fica no estado da sala; não altera preferências globais nem o banco. Trocar o provedor ou modelo descarta os pareceres locais. Não há monitoramento automático. Aprovações e skills continuam iguais.

Limites: chamadas locais podem durar até 120 segundos, com até 300 segundos por agente; o ambiente de hospedagem pode impor um limite menor.

Referências oficiais:
- https://lmstudio.ai/docs/developer/openai-compat
- https://lmstudio.ai/docs/developer/openai-compat/tools
- https://lmstudio.ai/docs/developer/openai-compat/models
