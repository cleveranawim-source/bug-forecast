import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yeolstudio.neighborhoodbugforecast',
  appName: '우리동네 벌레예보',
  webDir: 'dist',
  bundledWebRuntime: false,
  plugins: {
    Geolocation: {
      permissions: ['location'],
    },
  },
};

export default config;
