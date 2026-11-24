# FLUXOS — Kit de implementação para Codex

**Versão do briefing:** 1.0 — 22/11/2026  
**Estado:** referência visual aprovada + especificação e prompt. **Não é o código do aplicativo nem um APK pronto.**

## Comece por aqui

1. Extraia todo este ZIP em uma pasta de projeto no computador.
2. Abra essa pasta no ambiente usado pelo Codex.
3. Dê ao Codex o conteúdo de `PROMPT_GERAL_CODEX.md` (ou peça para ler e executar esse arquivo).
4. Mantenha a imagem `assets/references/EDITOR_INTERFACE_APROVADA.png` acessível. Ela é a referência visual principal aprovada.
5. O aplicativo deve ficar em `app/`, preservando documentos e imagem de referência.
6. Ao concluir, rode no PC com as instruções do `app/README.md`.

## Conteúdo do kit

- `PROMPT_GERAL_CODEX.md` — instrução consolidada e executável para o Codex.
- `assets/references/EDITOR_INTERFACE_APROVADA.png` — mockup aprovado, com layout limpo, canvas dominante e árvore retrátil.
- `docs/01-VISAO_E_ESCOPO.md` — decisões do produto e limites da primeira entrega.
- `docs/02-INTERFACE_E_INTERACOES.md` — comportamentos, ergonomia de tablet e fidelidade visual.
- `docs/03-MODELO_DADOS_E_INTEGRIDADE.md` — modelo, regras de hierarquia e persistência.
- `docs/04-CRITERIOS_DE_ACEITE.md` — checagens de homologação direcionadas.
- `docs/05-REFERENCIAS_TECNICAS.md` — documentação e cautelas de versões.
- `config/design-tokens.json` — sugestões de tokens visuais extraídos conceitualmente da referência.
- `samples/operacao-velluto.sample.json` — dados de exemplo, sem dados reais.

## Prioridades do kit

1. Aplicativo funcional no navegador do PC, inclusive navegação hierárquica, edição, persistência local e exportação/importação.
2. Fidelidade à composição do mockup: área generosa para o fluxograma; árvore retrátil, sem terceira coluna fixa obrigatória.
3. Código compartilhável com Android.
4. Autenticação/sincronização, publicação web e APK final como fases posteriores, sem comprometer o modelo de dados.

## Observação sobre a imagem

A imagem é uma referência de composição, não uma especificação pixel a pixel. Preserve a arquitetura visual e implemente controles com comportamento real. VELLUTO aparece apenas no projeto de exemplo, não no branding do aplicativo.
