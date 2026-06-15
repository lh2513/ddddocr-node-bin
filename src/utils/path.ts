import { dirname, resolve } from 'node:path';

import { isPackaged } from './systeminfo';

export const ROOT_PATH = isPackaged ? dirname(process.execPath) : resolve(import.meta.dir, '../..');
