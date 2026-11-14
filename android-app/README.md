# Silent Garden Motion Studio — Android Alpha 0.1 🌸

Aplicativo Android 7+ usando Capacitor 8, Three.js e interface mobile de Blood Petals.

## Compilar
Requer Node.js 22+, Java 21 e Android SDK. Execute:
```bash
npm install
npm run build
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
```

A versão de testes fica em `android/app/build/outputs/apk/debug/app-debug.apk`.

## Recursos
- Editor 3D e rig com seleção e rotação de ossos
- Timeline, clips, keyframes e prévia
- Materiais e importação de texturas para malhas com UV
- Importação experimental de FBX
- Bibliotecas gráficas disponíveis offline depois de instalar
- Projetos JSON e exportação GLB por compartilhamento Android

## Limitações
A exportação FBX requer conversor Blender externo. O salvamento no Android usa o menu Compartilhar, em vez de baixar diretamente em Downloads. Não há nuvem da equipe nem teste completo em aparelho real nesta Alpha. Modelos FBX grandes podem ser lentos. O APK debug poderá precisar ser desinstalado antes de instalar compilação com assinatura diferente; exporte projetos antes de desinstalar.

O workflow do repositório usa `studio/index.html` como fonte, preservando o site e a versão Windows.
