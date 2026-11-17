# EduClass 2.0 — Android
Esta ramificação **educlass-apk-build** contém exclusivamente o aplicativo EduClass para Android e não altera a branch principal do site Blood Petals.

O workflow [Compilar EduClass APK](.github/workflows/educlass-apk.yml) compila o APK de testes via GitHub Actions automaticamente a cada envio para esta ramificação.

## Instalação
1. Abra **Actions** e escolha **Compilar EduClass APK**.
2. Após a conclusão com sucesso, baixe o artefato **EduClass-2.0-APK**.
3. Extraia o ZIP, abra `app-debug.apk` no Android e autorize a instalação de aplicativos desse navegador/gerenciador de arquivos.

Este APK é de **desenvolvimento**, assinado automaticamente pela chave de debug do Android. Não use para publicação na Google Play. Os dados ficam apenas no dispositivo, sem sincronização; faça backups JSON regularmente e restaure-os pelo menu Configurações.
