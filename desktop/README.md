# Silent Garden Motion Studio Alpha 0.9.9 · Rig Control & Toon

- Todos os ossos FBX são editáveis. Filtros: Corpo, Todos, Rosto, Dedos, Saia, Auxiliares.
- IK das pernas com direção frontal baseada nos ossos de dedos dos pés. Flexão máxima aproximada de 150 graus; pole control continua disponível.
- Influência individual da coxa/braço e canela/antebraço em cada cadeia IK, salva no projeto.
- Prévia Toon de três níveis de luz: apenas viewport, sem modificar materiais e texturas exportados.
- Ctrl+Z desfaz, Ctrl+Y / Ctrl+Shift+Z refaz, Ctrl+S salva o projeto.
- Câmera persistente entre Layout / Animation / Shading e ao voltar de vista ortográfica à perspectiva.
- Preservados: G/R/S, espelho, cabeça, quadril, Rig Assist, saia, timeline, materiais e modelo feminino.
- Recursos do modelo original e música seguem como arquivos privados na pasta assets ao lado do EXE, e NÃO fazem parte do repositório público.
- Exportação FBX continua exigindo Blender instalado e deve ser validada na Unity Legacy.

## Executável
Na página do GitHub Actions, baixe o artefato SilentGardenMotionStudio-Windows-Alpha-0.9.9 e extraia o EXE. Se tiver o pacote assets da 0.9.8, mantenha-o ao lado.

## Limitações atuais
A simulação de IK é uma assistência de dois segmentos com influências; não substitui um rig Rigify completo. O joelho é limitado por direção e distância, mas cenas extremas requerem ajuste do pole e verificação visual. O histórico não captura todas as operações externas e importações de arquivos binários.

# Silent Garden Motion Studio — Alpha 0.9 (Windows portátil)

**Workspace & Materials Update** — atualização da Alpha 0.8 que preserva o Rig Assist IK, 12 ossos de saia e o formato de animações Blood Petals.

## Novidades
- MainMenu separado do 3D Editor: New Project, Open Project, Recent Projects e Settings
- Recent Projects: snapshots JSON no IndexedDB do aplicativo (para FBX importados, é necessário selecionar o arquivo original ao restaurar)
- Aviso antes de voltar ao menu quando há alterações não salvas
- Zoom sem scroll: +/=, -, Alt+botão direito arrastar, botões na viewport
- F: enquadrar osso ou malha selecionada; Home: enquadrar personagem inteiro
- Auto Focus baseado nos limites da malha visível, com clipping adaptativo
- Material Inspector mostra quantidades de faces por slot; clique diretamente numa face da viewport para selecionar material
- Destacar/Isolar temporariamente os demais slots em malha com grupos de materiais
- PNG/JPG/WebP e propriedades materiais herdadas da versão anterior
- Salvar projeto .sgmotion.json continua incluindo clipes, rig assist e texturas importadas
- Atalhos Ctrl+S (salvar) e Ctrl+O (abrir projeto)

## Como usar
1. Abra o executável Windows portátil.
2. No MainMenu clique em New Project, importe o FBX e aguarde o enquadramento.
3. Para editar materiais, escolha Shading, clique numa face da malha ou selecione o slot no inspector.
4. Use Destacar / Isolar / Restaurar para identificar faces de cada material.
5. Salve o arquivo `.sgmotion.json` e guarde o FBX original.

## Observações e limites
- Seleção/isolamento de faces depende dos `geometry.groups` originais do FBX. Se um arquivo possuir nomes de materiais mas não mapear as faces para cada slot, o editor informa a limitação e **não inventa atribuições**.
- Isolar materiais é uma visualização temporária; geometria, grupos, UVs, skin weights e hierarquia não são modificados.
- O FBX exportado pelo Blender deve ser reimportado e conferido na Unity Legacy: propriedades avançadas de material e fidelidade da skin não são garantidas pelo exportador GLB→FBX.
- Recent Projects depende do armazenamento local do aplicativo, não substitui arquivos salvos. É necessário fornecer o FBX original ao reabrir projetos de personagens importados.
- A versão portátil pode guardar preferências e recentes no perfil do Windows.
- Exportação FBX: instale Blender localmente, ou selecione `blender.exe` pela interface do Motion Studio.
- Compilação ainda não equivale a um teste visual em Windows com os FBX reais.

## Desenvolvimento
Execute `npm install` e `npm run dist:win` com Node.js 22+ em Windows. O GitHub Actions pode montar o aplicativo em uma máquina Windows hospedada.

Silent Garden Team · Blood Petals · 2026