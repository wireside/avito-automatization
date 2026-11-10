import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import {
  PipelineError,
  requirePipeline,
  type SignerCertificate,
} from '@avito/domain';
export function inspectSignerCertificate(base64: string): SignerCertificate {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(Buffer.from(base64, 'base64'));
  } catch {
    throw new PipelineError('CERTIFICATE_INVALID');
  }
  const inn =
    /(?:^|\n|,\s*)(?:ИНН|INN|1\.2\.643\.3\.131\.1\.1)\s*=\s*"?(\d{12})(?:"|\n|,|$)/i.exec(
      cert.subject,
    )?.[1];
  requirePipeline(inn, 'CERTIFICATE_INN_UNREADABLE');
  requirePipeline(
    Date.parse(cert.validFrom) <= Date.now() &&
      Date.parse(cert.validTo) > Date.now(),
    'SIGNER_CERTIFICATE_EXPIRED',
  );
  return {
    sellerInn: inn,
    certificateThumbprint: cert.fingerprint.replaceAll(':', '').toUpperCase(),
    certificateExpiresAt: new Date(cert.validTo).toISOString(),
  };
}
export async function buildSignerInstaller(connection: {
  backendUrl: string;
  ticket: string;
}) {
  const names = [
    'install.ps1',
    'agent.ps1',
    'policy.ps1',
    'uninstall.ps1',
    'Установить.cmd',
    'ПРОЧИТАЙТЕ.txt',
  ];
  const files = await Promise.all(
    names.map(
      async (name) =>
        [
          name,
          new Uint8Array(
            await readFile(
              new URL('../../../local-signer/' + name, import.meta.url),
            ),
          ),
        ] as const,
    ),
  );
  return Buffer.from(
    zipSync(
      {
        ...Object.fromEntries(files),
        'connection.json': strToU8(JSON.stringify(connection)),
      },
      { level: 6 },
    ),
  );
}
