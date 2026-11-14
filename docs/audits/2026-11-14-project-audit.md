# Auditoria técnica do Opanel — 14 de novembro de 2026

- Estado: relatório para revisão; recomendações não aprovadas para implementação.
- Base analisada: commit `c0cafd36e3846b90c5c6279b9ea2363bb51c02d5`.
- Método: inspeção estática de código, especificações, testes e configuração.
- Âmbito: segurança, correção, concorrência, arquitetura, qualidade e preparação operacional.
- Alterações desta entrega: este relatório e a sua entrada no índice documental.

## 1. Avaliação executiva

O Opanel tem uma base de engenharia consistente: contratos Zod, permissões explícitas,
serviços com transações, migrações versionadas e testes de vários níveis. O principal
risco observado está nas fronteiras públicas e nos percursos excecionais: trabalho
criptográfico antes de rejeições previsíveis, emissão concorrente de links e tratamento
de erros que confia na segurança das mensagens de bibliotecas.

A recomendação é resolver ou validar os achados prioritários antes de uma instalação
acessível pela Internet. Esta conclusão não significa que exista uma intrusão comprovada
ou uma vulnerabilidade explorada: nenhum ataque foi executado e os testes não puderam
ser corridos neste ambiente.

O projeto encontra-se no fim da WI-031. Agentes, sincronização em tempo real, triagem e
outras funcionalidades planeadas não foram classificadas como defeitos por ainda não
estarem implementadas. Também não se atribui uma nota numérica de segurança ou cobertura
sem medições que a sustentem.

## 2. Método, evidência e limitações

Foram consultados `AGENTS.md`, o índice documental, os documentos canónicos, especificações
relevantes e os principais percursos de autenticação, gestão de contas, equipas, projetos,
colunas e tarefas. Foram inspecionados contratos da API, auxiliares HTTP, esquema de dados,
testes, configuração do Playwright e workflow de CI.

Distinguem-se três níveis de evidência:

- **Observado no código:** uma propriedade é diretamente visível, como a ordem das chamadas.
- **Cenário inferido:** o código permite uma sequência problemática, mas esta não foi
  reproduzida com a aplicação e PostgreSQL em execução.
- **Hipótese dependente de versão ou infraestrutura:** exige confirmação adicional antes
  de ser tratada como vulnerabilidade confirmada.

### Verificações executadas

| Verificação                                        | Resultado                                                        | Interpretação                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Estado Git antes da entrega                        | Limpo                                                            | A análise partiu da revisão identificada acima                |
| Inventário dos testes                              | 100 ficheiros de testes                                          | Contagem de ficheiros; não é percentagem de cobertura         |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | Bloqueados por `EPERM` na preparação automática das dependências | Não produziram resultados de qualidade do código              |
| TypeScript local                                   | `node_modules/typescript/bin/tsc` ausente                        | Não foi possível usar diretamente o compilador local          |
| `docker compose ps`                                | Engine do Docker indisponível                                    | Integração e E2E não foram executados                         |
| Revisão dos testes existentes                      | Estática                                                         | A existência de um teste não comprova que passa nesta revisão |

Não foram realizados testes de carga, pentest dinâmico, auditoria completa de dependências
ou verificação de CVEs, revisão de infraestrutura em produção, nem medição de cobertura.
Nenhum segredo de configuração foi necessário para esta análise.

## 3. Quadro de prioridades

As prioridades abaixo são propostas de triagem, não pontuações CVSS.

| ID   | Tema                                          | Gravidade proposta                  | Evidência                                                        | Ação                                |
| ---- | --------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------- | ----------------------------------- |
| A-01 | Cálculo Argon2 em `/setup` após instalação    | Alta, se publicamente acessível     | Ordem observada; impacto de carga não medido                     | Corrigir antes de exposição pública |
| A-02 | Duas emissões podem deixar dois links válidos | Média                               | Cenário concorrente inferido                                     | Incluir na WS-040                   |
| A-03 | Corpo JSON sem limite explícito na aplicação  | Média, dependente da infraestrutura | Leitura integral observada                                       | Definir limite e contrato de erro   |
| A-04 | Mensagens de exceções sem filtragem nos logs  | Potencialmente alta                 | Logging observado; conteúdo do ORM por confirmar na versão usada | Validar com prioridade e endurecer  |

## 4. Achados e propostas de resolução

### A-01 — Trabalho criptográfico anónimo depois de concluída a configuração

**Evidência:** `src/server/services/setup.ts`, linhas 40–46; endpoint público em
`src/app/api/v1/setup/route.ts`. A função chama `hashPassword` antes de `isSetupNeeded`.
O perfil Argon2 está em `src/server/auth/password.ts`.

**Cenário:** numa instalação já configurada, um cliente envia repetidamente pedidos com
um nome, email e password sintaticamente válidos. Cada pedido calcula um hash antes de
descobrir que a instalação já tem contas e devolver `404`. O limitador usado no sign-in
não protege esse percurso, porque a função termina antes de chegar ao sign-in.

O controlo de `Origin` protege contra determinados pedidos de outros sites; não impede
um cliente HTTP de enviar o valor esperado. Não deve ser usado como proteção de capacidade.

**Impacto:** consumo desnecessário de CPU e memória e possibilidade de degradação do
serviço. O limiar de saturação depende do servidor e não foi medido. Não há evidência de
criação de um segundo administrador: o bloqueio transacional existente protege essa regra.

**Resolução proposta:**

1. Fazer uma consulta barata a `isSetupNeeded` antes do hash e recusar imediatamente se
   já existir uma conta.
2. Manter a verificação dentro da transação e o bloqueio atual. A consulta preliminar é
   uma otimização defensiva; não resolve a corrida de criação do primeiro administrador.
3. Definir proteção para o período em que a instalação ainda está vazia: token de setup
   e política de limitação antes de qualquer operação dispendiosa.
4. Definir limites de pedidos no proxy como proteção complementar.

**Testes de aceitação:**

- Instalação configurada: `404` e zero chamadas ao hasher.
- Instalação vazia: primeira criação bem-sucedida, com credencial e auditoria.
- Criações concorrentes: exatamente uma conta inicial criada.
- Recusa por limite ou token inválido: nenhum hash, conta, credencial ou evento criado.
- Falha da auditoria: rollback de conta e credencial, preservando o teste atual.

**Enquadramento documental:** o código segue a sequência da WS-016; a melhoria exige
rever essa decisão numa nova especificação. Não deve ser apresentada como simples
correção de uma implementação que desobedeceu à especificação. Se surgir `429` ou outra
resposta nova, atualizar o contrato Zod/OpenAPI.

### A-02 — Emissão concorrente não garante um único link pendente

**Evidência:** `src/server/services/account-management.ts`, linhas 266–272;
`src/server/services/account-tokens.ts`, linhas 50–52; esquema em
`src/server/db/schema/account-tokens.ts`.

`issueResetLink` abre uma transação sem adquirir `lockAccount`. `issueLink` elimina os
links anteriores e depois insere o novo. O esquema garante unicidade de `token_hash`,
mas não de um link pendente por conta.

**Intercalação problemática, partindo de uma conta sem links pendentes:**

| Passo | Transação A        | Transação B        |
| ----- | ------------------ | ------------------ |
| 1     | Lê a conta         | Lê a mesma conta   |
| 2     | Elimina zero links | Elimina zero links |
| 3     | Insere o link A    | Insere o link B    |
| 4     | Commit             | Commit             |

**Impacto:** ambos os links podem ficar elegíveis para aceitação até um deles ser usado.
Isto quebra a expectativa de que emitir um novo link invalida o anterior. Não significa
que o mesmo link possa ser reutilizado ou que ambos possam necessariamente ser aceites:
o percurso de aceitação tem bloqueios e elimina links pendentes.

**Resolução proposta:** adquirir `lockAccount(tx, accountId)` no início da transação de
emissão, antes de leituras e alterações. A WS-040 já propõe esse mecanismo para evitar
deadlocks entre emissão e aceitação; o mesmo trabalho deve incluir esta garantia.

Uma restrição parcial de unicidade por conta para `used_at IS NULL` pode ser avaliada como
defesa adicional. Não substitui uma ordem de bloqueios coerente, exige migração e precisa
de uma decisão sobre linhas expiradas ainda não utilizadas. Não é necessária para a
correção mínima com serialização.

**Testes de aceitação:**

- Duas emissões concorrentes para uma conta inicialmente sem links: resta um só link
  pendente e apenas o correspondente token é elegível.
- Emissões concorrentes com link anterior: o anterior deixa de funcionar.
- Emissão versus aceitação e emissão versus revogação: sem deadlock e estado final válido.
- Falha na auditoria: emissão e substituição de links são revertidas.

Usar PostgreSQL real e sincronização controlada entre transações. Repetir operações sem
controlar a intercalação pode produzir um teste que passa sem exercitar a corrida.

### A-03 — Ausência de limite explícito antes de carregar o JSON

**Evidência:** `src/server/http/route.ts`, linha 222. `request.json()` consome o corpo
completo; a validação Zod só acontece depois.

**Impacto:** os limites de comprimento dos campos não limitam a memória necessária para
receber e interpretar um documento muito grande. Endpoints públicos expõem este percurso
a clientes sem sessão. O efeito depende dos limites aplicados pelo servidor e proxy;
esta auditoria não demonstrou que toda a infraestrutura aceite corpos ilimitados.

**Resolução proposta:**

1. Definir um orçamento de bytes por pedido ou por classe de endpoint, compatível com os
   limites dos campos existentes. Não escolher um valor definitivo sem verificar os
   contratos de tarefas e os futuros relatórios de bugs.
2. Recusar antecipadamente um `Content-Length` acima do orçamento, quando disponível.
3. Contabilizar os bytes efetivamente lidos e interromper a leitura ao ultrapassar o limite.
   O cabeçalho pode estar ausente ou incorreto; a proteção não pode depender só dele.
4. Interpretar e validar o JSON apenas após a leitura limitada.
5. Definir `413` no modelo de erros e nos contratos aplicáveis, com resposta coerente com
   os restantes erros da API, e alinhar os limites do proxy.

**Testes de aceitação:** corpo abaixo, exatamente no limite e acima do limite; ausência de
`Content-Length`; declaração incorreta; JSON malformado dentro do limite; caracteres UTF-8
multibyte; fluxo interrompido; ausência de chamadas ao serviço para pedidos recusados.

Adicionar pelo menos um teste contra o servidor real. Um teste apenas com objetos
`Request` não comprova os limites do transporte HTTP ou do proxy.

### A-04 — Logging confia no conteúdo das mensagens de exceção

**Evidência local:** `src/server/http/route.ts`, linhas 84–85, concatena `error.name` e
`error.message` sem sanitização. A resposta ao cliente é genérica, o que protege esse
canal, mas não protege os logs.

**Evidência externa e limite:** o
[código público de erros do Drizzle](https://raw.githubusercontent.com/drizzle-team/drizzle-orm/main/drizzle-orm/src/errors.ts)
inclui uma classe cuja mensagem incorpora a consulta e os parâmetros. Essa referência é
à branch `main`, consultada nesta auditoria; não comprova o comportamento de
`drizzle-orm@0.45.4`, declarado pelo projeto. A cópia instalada não estava disponível.

**Impacto potencial:** falhas em consultas com dados sensíveis podem colocar parâmetros
nos logs. Um hash de password continua a ser material sensível. Não foi demonstrada
exposição de passwords em claro, tokens de sessão ou qualquer segredo real nesta revisão.

**Resolução proposta:**

- Inspecionar primeiro o código da versão exata usada pelo projeto e os caminhos de erro
  do adaptador PostgreSQL.
- Criar um formato de erro seguro com campos permitidos: `requestId`, categoria controlada,
  operação conhecida e, quando validado, código técnico do banco.
- Evitar serializar arbitrariamente `message`, `cause`, parâmetros SQL e objetos de erro.
- Usar códigos de diagnóstico para correlacionar falhas sem registar os dados do pedido.
- Definir acesso e retenção dos logs na documentação operacional.

**Testes de aceitação:** provocar uma falha real numa consulta que tenha um marcador
sensível como parâmetro; capturar o logger; verificar que nem a resposta nem os logs
contêm esse marcador, hashes ou tokens. Preservar um identificador útil para diagnóstico.
Uma exceção sintética com texto genérico não substitui o teste do erro real do ORM.

Se o risco se confirmar, existe uma divergência com a regra 7 de `AGENTS.md`, que proíbe
segredos nos logs. Deve ser explicitamente registada e resolvida pelo fluxo documental.

## 5. Pendências conhecidas que continuam relevantes

Estas questões já constam dos documentos do projeto. São incluídas para permitir uma
priorização conjunta, sem as apresentar como descobertas novas.

| Pendência                       | Situação                                   | Sugestão de resolução                                                                               | Evidência de conclusão                                         |
| ------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Endurecimento de links          | WI-040 / WS-040 propostas                  | Validar o link antes do hash, serializar emissão e tratar o sign-in após prova válida da credencial | Testes previstos na WS-040 mais os cenários de A-02            |
| Cabeçalhos e CSP                | WI-041 / WS-041 propostas                  | Implementar a política documentada e validar nonces, redirects, temas e produção                    | E2E com build de produção e verificação de cabeçalhos          |
| Apropriação da instalação vazia | `SETUP_TOKEN` ainda pendente               | Definir o mecanismo de prova de posse antes de tornar a instalação pública                          | Pedido sem prova não cria administrador nem executa hash       |
| Único administrador sem acesso  | Recuperação depende de outro administrador | Especificar recuperação local pelo operador com link temporário e auditoria                         | Recuperação testada sem introduzir bypass público              |
| Publicação em produção          | Sem work-track dedicado                    | Definir imagem, proxy, TLS, IP confiável, limites e procedimento de atualização                     | Instalação e atualização reproduzidas a partir da documentação |
| Email de conta já aceite        | Sem alteração/correção definida            | Decidir autorização, unicidade, efeitos sobre sessões e auditoria                                   | Fluxo aprovado e testes de colisões e permissões               |
| Tipos de rotas desatualizados   | Workaround em CONTRIBUTING                 | Tornar typecheck independente de artefactos antigos, usando a documentação da versão instalada      | Mesmo resultado em checkout limpo e após alterações de rotas   |

No caso de IPs, a configuração do proxy deve assegurar que o cabeçalho confiável é
normalizado ou acrescentado de forma consistente. Configurar apenas o nome do cabeçalho
na aplicação não demonstra que o valor veio de uma origem confiável.

## 6. Melhorias de arquitetura, testes e operação

### Preservar os mecanismos que já funcionam

Manter os controlos de acesso declarados nos contratos, as verificações nos serviços e
os testes que ligam rotas a contratos. Preservar validação Zod, transações com auditoria,
PostgreSQL real em integração e controlo de versões para alterações concorrentes.

Os testes de movimento de tarefas já incluem múltiplos movimentos e criações concorrentes.
Esta abordagem deve ser estendida aos percursos de credenciais e links em vez de criar
uma infraestrutura de testes diferente para cada serviço.

### Documentar a ordem de bloqueios

Criar, na especificação relevante, uma tabela com recurso, tipo de bloqueio, operações
que o adquirem e ordem obrigatória. Incluir projeto, coluna, tarefa, conta, credencial e
link. A documentação deve refletir os bloqueios existentes, e qualquer alteração deve
ser acompanhada por testes que controlem a intercalação das transações.

### Rever concorrência de passwords como decisão de produto

A WS-021 permite explicitamente que duas alterações simultâneas de password tenham
sucesso e que a última prevaleça. O código correspondente não foi classificado como
defeito por implementar essa decisão.

Como melhoria, avaliar separadamente a interação entre alteração própria, aceitação de
reset, revogação de sessões e desativação da conta. Definir quais pedidos em curso podem
concluir depois de uma revogação e testar o comportamento escolhido. Não alterar
silenciosamente a semântica aprovada de concorrência.

### Melhorar cobertura por risco

Acrescentar uma matriz que associe cada regra crítica a um teste: autorização, isolamento
por projeto quando aplicável, atomicidade, concorrência, rejeição barata de pedidos e
ausência de segredos em logs. A quantidade de ficheiros não substitui esta matriz.

Medir cobertura quando o ambiente estiver funcional e usar os resultados para encontrar
percursos sem testes. Não estabelecer uma meta percentual arbitrária nem escrever testes
que apenas repitam a implementação para aumentar o número.

### Preparar operação e recuperação

No futuro work-track de produção, incluir backups e ensaio de restauro, separação de
permissões entre migração e execução quando viável, gestão de segredos, limites de
conexões, retenção de logs e procedimento de rollback compatível com migrações.

Estes pontos são propostas de preparação operacional, não falhas comprovadas numa
infraestrutura que não foi inspecionada. O primeiro marco útil é conseguir restaurar uma
instalação de teste a partir de backup e confirmar contas, tarefas e histórico.

### Rever dependências com evidência atual

As atualizações de Node.js, pnpm, Playwright e TypeScript já aparecem como follow-ups.
Antes de atuar, verificar versões suportadas, compatibilidade e advisories oficiais.
Esta auditoria não afirma que uma versão declarada esteja vulnerável e não recomenda
atualizar indiscriminadamente todas as dependências.

## 7. Plano de execução sugerido

| Ordem | Entrega                            | Dependência                                  | Critério de saída                                                         |
| ----- | ---------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| 1     | Restabelecer ambiente de validação | Dependências exatas, Docker e bases de teste | Quality gate executável, resultados guardados                             |
| 2     | Confirmar A-04 na versão exata     | Ambiente funcional                           | Teste demonstra exposição ou afasta a hipótese específica                 |
| 3     | Especificar e resolver A-01        | Aprovação do proprietário                    | Pedidos recusados após setup não calculam hashes                          |
| 4     | Concluir WS-040 e cobrir A-02      | Aprovação da WS-040 revista                  | Um link pendente por conta e ausência de deadlocks nos cenários previstos |
| 5     | Especificar e resolver A-03        | Decisão sobre limites e contrato             | Rejeição limitada por bytes, com testes de transporte                     |
| 6     | Concluir WS-041                    | Aprovação existente ainda pendente           | Política validada no build de produção                                    |
| 7     | Preparar publicação e recuperação  | Decisões operacionais                        | Instalação, atualização e restauro demonstrados                           |

Se A-04 confirmar exposição de material sensível, a sua correção deve subir imediatamente
na ordem de execução. A confirmação é prioritária precisamente para não deixar uma
hipótese grave indefinida.

Para A-01, A-03 e eventual correção de A-04, propor work-items independentes e respetivas
work-specs. Não reservar números neste relatório: devem ser atribuídos a partir do índice
quando o trabalho for formalizado. A-02 deve aproveitar a WS-040, evitando duplicar scope.

Cada implementação segue o processo aprovado: especificação, aprovação do proprietário,
teste vermelho, implementação mínima, refatoração e atualização documental. O relatório
não substitui uma work-spec nem constitui autorização para alterar a aplicação.

## 8. Validação final e encerramento dos achados

Com as dependências exatas instaladas e PostgreSQL disponível, executar o quality gate
completo nas bases dedicadas a testes:

```text
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:e2e
```

Registar por achado: work-item/PR, revisão corrigida, teste de regressão, resultado local
e resultado de CI. Um achado só deve ser encerrado após evidência de correção; uma
decisão de aceitar risco deve ser explícita, com responsável e condição de reavaliação.

O resultado esperado desta auditoria é uma sequência de alterações pequenas e verificáveis,
preservando a estrutura existente. As maiores melhorias imediatas são rejeitar cedo o
trabalho anónimo desnecessário, serializar a emissão de links, limitar a leitura de pedidos
e garantir que os logs permanecem úteis sem transportar dados sensíveis.
