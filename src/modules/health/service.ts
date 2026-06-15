import { APP_VERSION } from '@/utils/appInfo';

export interface HealthInfo {
  version: string;
  timestamp: number;
}

export const getHealth = (): HealthInfo => ({
  version: APP_VERSION,
  timestamp: Date.now(),
});
