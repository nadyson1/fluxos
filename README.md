# Fluxos

Editor offline-first de fluxogramas, com subprocessos, busca global, exportação JSON e aplicativo Android via Capacitor.

## Desenvolvimento

```powershell
cd app
npm ci
npm run dev
```

Os projetos são salvos localmente no IndexedDB do perfil do navegador. Não há sincronização em nuvem configurada.

## Testes e build

```powershell
cd app
npm test
npm run build
```

## Publicação e PWA

O workflow do GitHub Actions testa e publica o app em <https://nadyson1.github.io/fluxos/>. No Windows, abra esse endereço no Chrome ou Edge e escolha **Instalar Fluxos**. Após o primeiro carregamento online, o shell da PWA fica disponível offline.

O build do Pages configura `/fluxos/` como base; o Vite e o Capacitor continuam usando `/` por padrão.

Veja [app/README.md](app/README.md) para detalhes de exportação, instalação e build Android.
