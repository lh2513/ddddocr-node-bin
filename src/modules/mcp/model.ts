import { t } from 'elysia';

// JSON-RPC 2.0 error object
const jsonRpcError = t.Object({
  code: t.Number(),
  message: t.String(),
  data: t.Optional(t.Any()),
});

// JSON-RPC 2.0 success response
const jsonRpcSuccess = t.Object({
  jsonrpc: t.Literal('2.0'),
  id: t.Nullable(t.Union([t.String(), t.Number()])),
  result: t.Any(),
});

// JSON-RPC 2.0 error response
const jsonRpcErrorResp = t.Object({
  jsonrpc: t.Literal('2.0'),
  id: t.Nullable(t.Union([t.String(), t.Number()])),
  error: jsonRpcError,
});

export const jsonRpcResponseSchema = t.Union([jsonRpcSuccess, jsonRpcErrorResp]);
