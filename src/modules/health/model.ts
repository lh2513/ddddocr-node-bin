import { t } from 'elysia';

import { schema } from '@/utils/response';

export const healthResponseSchema = schema(t.Object({ version: t.String(), timestamp: t.Number() }));
