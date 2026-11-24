import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.fluxos.editor',
  appName: 'Fluxos',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: {
    FirebaseAuthentication: {
      providers: ['google.com'],
    },
  },
};

export default config;
