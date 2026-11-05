# Blood Petals — página inicial

Landing page em português do projeto Blood Petals, da equipe Silent Garden. HTML, CSS e JavaScript nativos, sem instalação de dependências, serviços externos, rastreamento ou etapa de build.

## Executar

Abra `index.html` diretamente no navegador, ou execute na raiz:

```sh
python3 -m http.server 8000
```

Acesse http://localhost:8000. A navegação e os detalhes das rivais também funcionam sem JavaScript; o script apenas recolhe o menu em telas pequenas, com suporte à tecla Escape.

## Organização

- `index.html`: conteúdo, metadados e estrutura semântica.
- `assets/css/styles.css`: identidade visual, layout responsivo, foco e preferência por movimento reduzido. Cores e fontes centralizadas em variáveis CSS.
- `assets/js/main.js`: comportamento do menu mobile.
- `assets/images/`: ilustrações SVG locais e ícone. O jardim é decorativo, não uma captura do jogo nem uma representação definitiva do cenário.

A base existente foi preservada. Futuras páginas podem reutilizar `assets/`; materiais oficiais podem ser adicionados sem alterar o conteúdo introdutório.

## Conteúdo confirmado

A página usa o contexto fornecido pelo responsável pelo projeto: equipe Silent Garden; Ayame Kurohana; Ren Hayato; escola Hanakawa High no Japão; cinco semanas e cinco rivais (Sakura Mizuno, Haruka Aizawa, Mei Tanaka, Yui Hoshino e Rika Fujimoto). PC, mobile e dublagem brasileira aparecem como planejamento. Não são anunciados lançamento, download, trailer, requisitos ou funcionalidades concluídas.

## Hospedagem

Pode ser servido por qualquer hospedagem estática, inclusive GitHub Pages. Para usar Pages neste repositório, selecione **Settings → Pages → Deploy from a branch → main → / (root)**. Nenhuma configuração de hospedagem ou domínio é alterada por estes arquivos. Todos os caminhos de assets são relativos para funcionar também em subdiretórios.

## Revisão manual

- Verifique desktop e celular (incluindo 320 px), navegação por teclado e foco visível.
- Abra e feche o menu mobile; Escape devolve o foco ao botão.
- Teste as âncoras, os cinco detalhes de rivais e o link do repositório.
- Desative JavaScript: menu e conteúdo devem continuar acessíveis.
- Confira a preferência de movimento reduzido e ausência de rolagem horizontal.

Não foi adicionada licença ao código nem aos personagens; decisões sobre licenciamento ficam com os responsáveis pelo projeto.
