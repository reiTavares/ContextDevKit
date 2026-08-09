# Escrever documentação no nível certo

A documentação do ContextDevKit segue Diátaxis.

## Escolha a categoria pelo objetivo do leitor

- `tutorials/`: ensinar uma primeira conquista passo a passo;
- `how-to/`: resolver uma tarefa concreta;
- `reference/`: contrato exato, opções, formatos e APIs;
- `explanation/`: explicar conceitos, razões e trade-offs.

## Internacionalização

A documentação canônica em inglês vive em `docs/`. Locales ficam em raízes declaradas por `docs/locales.json`, como `docs/pt-BR/`.

Mantenha o mesmo nome relativo de arquivo sempre que possível para facilitar paridade e links previsíveis.

Não traduza nomes de comandos, ids, paths, JSON keys ou símbolos de código.

Árabe e hebraico usam `rtl`; blocos de código continuam no formato técnico original.

## Índices

O `docs-reindex` gera o índice canônico inglês e ignora roots de locale. Cada locale mantém seu próprio README/índice.
