import { createIntegrationAdapters } from '@construktor/renderer';
import { APP_BASE_PATH } from '../routing/basePath.js';

const API_ROOT = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

export const rendererAdapters = createIntegrationAdapters({
  apiBaseUrl: API_ROOT,
  basePath: APP_BASE_PATH,
});

export const resolveRendererAsset = rendererAdapters.assetResolver;
