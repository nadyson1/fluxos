# Fluxos

Editor de fluxogramas com biblioteca de projetos, subprocessos, busca global e salvamento local.

## Executar no computador

No PowerShell, a partir desta pasta:

```powershell
npm install
npm run dev
```

Abra o endereço informado pelo Vite, normalmente `http://localhost:5173`.

## Publicação Web e PWA

O GitHub Actions publica o app no GitHub Pages a partir da branch `main`, no endereço `https://nadyson1.github.io/fluxos/`. O workflow executa `npm ci`, os testes e o build antes de publicar.

O build local e o build Android usam a base padrão `/`. O workflow do Pages configura `VITE_BASE_PATH=/fluxos/`, para que scripts, ícones, manifest e service worker funcionem no caminho do projeto.

No Windows, abra o endereço HTTPS no Chrome ou Edge e use o ícone **Instalar Fluxos** na barra de endereço (ou o menu do navegador → **Instalar Fluxos**). Após abrir uma vez online, o shell da PWA fica disponível offline. Os projetos continuam armazenados localmente no IndexedDB daquele navegador/perfil.

Para validar ou gerar a versão de produção:

```powershell
npm test
npm run build
npm run preview
```

## Dados e exportação

Os projetos ficam no IndexedDB do navegador, no banco `fluxos-local`. Eles permanecem após recarregar a página, mas não são sincronizados entre navegadores, computadores ou dispositivos. No menu do editor, use **Exportar projeto JSON** para criar uma cópia de segurança e **Importar projeto JSON** para restaurá-la em outro navegador.

## PWA e Android

O build gera o manifesto e o service worker da PWA. A instalação pelo navegador requer uma origem segura, como HTTPS ou `localhost`.

O projeto nativo Android do Capacitor fica em `android/`. Depois de alterar o app web, sincronize os arquivos e plugins com:

```powershell
npm run cap:sync
npm run cap:open
```

Com Android Studio e o Android SDK configurados, também é possível gerar um APK de depuração pelo Gradle:

```powershell
Set-Location android
.\gradlew.bat assembleDebug
```

O APK de depuração fica em `android/app/build/outputs/apk/debug/app-debug.apk`. A configuração e a sincronização do Capacitor foram verificadas; a compilação e a instalação em um dispositivo Android ainda precisam ser feitas com o SDK disponível.
