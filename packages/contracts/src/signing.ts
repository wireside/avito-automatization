import { z } from 'zod';
const signerId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  hash = z.string().regex(/^[0-9a-f]{64}$/);
export const signingClaimRequest = z.object({ signerId }).strict();
export const signingSubmitRequest = z
  .object({
    taskId: z.uuid(),
    leaseId: z.uuid(),
    signerId,
    payloadHash: hash,
    signatureBase64: z.base64().min(16).max(180000),
    certificateBase64: z.base64().min(16).max(48000),
    verification: z
      .object({
        valid: z.literal(true),
        chainValid: z.literal(true),
        revocationChecked: z.literal(true),
        signerInn: z.string().regex(/^\d{12}$/),
        payloadHash: hash,
      })
      .strict(),
  })
  .strict();
export const signerHeartbeatRequest = z
  .object({
    signerId,
    certificateThumbprint: z.string().regex(/^[0-9A-Fa-f]{40}$/),
    certificateExpiresAt: z.iso.datetime({ offset: true }),
    ready: z.boolean(),
    errorCode: z
      .string()
      .regex(/^[A-Z0-9_]{1,80}$/)
      .optional(),
  })
  .strict();
export function signingOpenApiPaths() {
  const schemas = {
    claim: signingClaimRequest,
    submit: signingSubmitRequest,
    heartbeat: signerHeartbeatRequest,
  };
  return Object.fromEntries(
    Object.entries(schemas).map(([action, schema]) => [
      `/api/v1/local-signer/${action}`,
      {
        post: {
          operationId: 'localSigner_' + action,
          tags: ['LocalSigner'],
          security: [{ localSignerToken: [] }],
          description:
            'Managed Windows CryptoPro agent. Exact bytes and pinned certificate. No private key or PIN is accepted.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: z.toJSONSchema(schema) } },
          },
          responses: {
            '200': { description: 'Agent response' },
            '401': { description: 'Unauthorized' },
            '409': { description: 'Payload or certificate mismatch' },
            '503': { description: 'Agent not configured' },
          },
        },
      },
    ]),
  );
}

export const signerInstallRequest = z
  .object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const signerRegisterRequest = signerInstallRequest
  .extend({
    signerId,
    deviceTokenHash: hash,
    pairingCode: z.string().regex(/^\d{6}$/),
    certificateBase64: z.base64().min(16).max(48000),
  })
  .strict();
export const signerInstallLinkResponse = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});

export function signerEnrollmentOpenApiPaths() {
  const post = (
    name: string,
    schema: z.ZodType | null,
    security: Record<string, never[]>[],
    description: string,
  ) => ({
    post: {
      operationId: 'signer_' + name,
      tags: ['LocalSigner'],
      security,
      description,
      ...(schema
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: z.toJSONSchema(schema) },
              },
            },
          }
        : {}),
      responses: {
        '200': {
          description:
            name === 'install'
              ? 'ZIP installer with a one-use bootstrap; no permanent agent credential'
              : 'Enrollment response',
        },
        '401': { description: 'Unauthorized' },
        '403': { description: 'Only owner can enroll' },
        '409': {
          description: 'Link expired, already used or certificate mismatch',
        },
        '429': { description: 'Wait before requesting another link' },
      },
    },
  });
  return {
    '/api/v1/local-signer/install-link': post(
      'install-link',
      null,
      [{ telegramInitData: [] }],
      'Owner receives a 30-minute HTTPS install link; its capability is carried in the URL fragment, never a query string.',
    ),
    '/api/v1/local-signer/install': post(
      'install',
      signerInstallRequest,
      [],
      'Download exact installer assets with an expiring enrollment ticket.',
    ),
    '/api/v1/local-signer/register': post(
      'register',
      signerRegisterRequest,
      [],
      'Register a public certificate and credential hash; Telegram owner approval is required before the agent can sign.',
    ),
    '/api/v1/local-signer/status': post(
      'status',
      null,
      [{ localSignerToken: [] }],
      'Agent polls its own approval state.',
    ),
  };
}
