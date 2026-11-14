# 🌸 Silent Garden Motion Studio — Windows portátil (Alpha 0.8.0)

Aplicativo Windows com Female Rig IK e assistente de saia para o editor de animações **Blood Petals**, da equipe Silent Garden.

## O que este pacote entrega

- Projeto Electron completo da interface desktop Alpha 0.8, importação FBX, edição de ossos, keyframes, materiais e texturas.
- Bibliotecas Three.js copiadas para dentro do aplicativo durante a compilação: **depois de compilado, funciona offline**.
- Janelas nativas de **Salvar como...** para projetos e exportações.
- Exportação FBX via **Blender instalado localmente**; o usuário pode escolher o `blender.exe`.
- Build automático no GitHub Actions para gerar um único arquivo `SilentGardenMotionStudio-Portable-0.8.0.exe`.

## Como gerar o EXE no GitHub (sem usar seu PC)

1. Abra o repositório `BloodPetalsdev/blood_petals_site` no GitHub.
2. Vá até **Actions** e escolha **Motion Studio — Portable Windows**.
3. Abra a execução da branch `main` ou clique **Run workflow** se disponível.
4. Quando o build estiver concluído, entre no job e baixe o artefato **SilentGardenMotionStudio-Portable-Windows**.
5. Extraia o ZIP do GitHub Actions; dentro estará o `.exe` portátil.

O workflow está em `.github/workflows/motion-studio-portable.yml` dentro deste pacote; no repositório ele fica na raiz `.github/workflows/` e o aplicativo na pasta `desktop/`.

## Compilar no seu Windows 10/11 (64 bits)

1. Instale Node.js (22 ou mais recente).
2. Extraia o projeto e execute `CONSTRUIR_PORTATIL.bat` ou no terminal:

```powershell
npm install --no-audit --no-fund
npm run dist:win
```

O executável ficará em `dist/` e poderá ser movido para qualquer pasta, HD externo ou pen drive.
Para testar durante o desenvolvimento: `npm start`.

## Exportação FBX e Unity Legacy

- Para usar **Exportar FBX**, instale o Blender no PC. O app tenta localizar `blender.exe` em `Arquivos de Programas\Blender Foundation`.
- Se não encontrar, clique em **Localizar Blender no PC** e selecione o `blender.exe`.
- A conversão usa Blender em segundo plano, sem abrir sua interface. **Não exige Python instalado nem servidor online.**
- Verifique os bones, as animações e as escalas dentro da Unity; **o caminho GLB → Blender → FBX ainda precisa de testes com o arquivo real da Ayame**.

## Observações de segurança e compatibilidade

- O app executa a interface num renderer com `sandbox` e `contextIsolation` ativos, acesso limitado por `preload` e protocolo local seguro.
- Não aceita navegação para sites externos dentro da janela do editor.
- `node_modules` e as bibliotecas do editor são baixados durante a compilação, por isso o **build precisa de internet**.
- O `.exe` final é portátil, mas pode guardar preferências na pasta de dados do Windows e o Windows SmartScreen pode alertar por não haver assinatura digital.
- Projeto protótipo. **Não foi possível compilar nem validar um `.exe` Windows neste ambiente**.
- Electron ocupa mais espaço e memória que um app nativo. Em computadores com Intel HD 2500, teste o desempenho e a compatibilidade de WebGL.

## Organização

- `renderer/index.html` / `renderer/app.js`: editor 3D e interface.
- `main.cjs`: janela Windows, segurança e interface com arquivos locais.
- `preload.cjs`: ponte limitada entre editor e Windows.
- `prepare-assets.cjs`: incorpora o Three.js offline.
- `blender/export_to_fbx.py`: conversão FBX pelo Blender local.
- `package.json`: dependências e destino de build portátil.
- `.github/workflows/motion-studio-portable.yml`: build em Windows no GitHub.

A licença do código-base original do editor pertence ao projeto da Silent Garden; não publique modelos, texturas ou outros arquivos privados da equipe sem permissão.

## Blood Petals Female Rig (Alpha 0.8)
- IK para braços (incluindo ossos intermediários ArmRoll/ForeArmRoll) e pernas.
- Assistente de saia: 12 ossos nas cadeias Front_skart, Left_skart, Back_skart e Right_skart.
- Perfis foram feitos a partir da análise estrutural de SweaterUniformRIGGED.fbx, mas o FBX privado NÃO acompanha o aplicativo.
- É uma ajuda de animação (não simulação de tecido). Testar na Unity Legacy antes de usar em produção.
