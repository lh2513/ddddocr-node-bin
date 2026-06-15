import { Elysia } from 'elysia';

import { jsonRpcResponseSchema } from './model';
import { handleMcpMessage } from './service';

export const mcpController = new Elysia({ name: 'mcp/controller' }).post(
  '/mcp',
  async ({ body }) => {
    const data = await handleMcpMessage(body);
    return data;
  },
  {
    response: {
      200: jsonRpcResponseSchema,
    },
  },
);

export default mcpController;
