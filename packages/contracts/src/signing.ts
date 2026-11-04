import { z } from 'zod';
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const signingClaimRequest = z
  .object({
    signerId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    acceptSimulation: z.boolean().default(false),
  })
  .strict();
export const signingSubmitRequest = z
  .object({
    taskId: z.uuid(),
    leaseId: z.uuid(),
    signerId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    payloadHash: hash,
    signatureBase64: z.base64().min(16).max(180000),
    certificateBase64: z.base64().min(16).max(48000),
  })
  .strict();
export function signingOpenApiPaths() {
  const endpoints = {
    claim: signingClaimRequest,
    submit: signingSubmitRequest,
  };
  return Object.fromEntries(
    Object.entries(endpoints).map(([action, schema]) => [
      `/api/v1/local-signer/${action}`,
      {
        post: {
          operationId: 'localSigner_' + action,
          tags: ['LocalSigner'],
          security: [{ localSignerToken: [] }],
          description:
            'Outbound local agent. Exact bytes, detached CMS; private key/PIN never sent. Received signatures remain unverified until a cryptographic adapter validates them.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: z.toJSONSchema(schema) } },
          },
          responses: {
            '200': {
              description: 'Lease (or null), or unverified signature receipt',
            },
            '401': { description: 'Invalid local agent bearer token' },
            '409': {
              description:
                'Expired lease, changed payload or conflicting signature',
            },
            '503': { description: 'Local signer is not configured' },
          },
        },
      },
    ]),
  );
}
