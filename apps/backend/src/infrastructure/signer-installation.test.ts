import { describe, it, expect } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import {
  inspectSignerCertificate,
  buildSignerInstaller,
} from './signer-installation.js';
const certificate = `-----BEGIN CERTIFICATE-----
MIIDMTCCAhmgAwIBAgIUGA8oGrf1Q2kWngb4eayl+zLmWA8wDQYJKoZIhvcNAQEL
BQAwQDEiMCAGA1UEAwwZU2lnbmVyIGVucm9sbG1lbnQgZml4dHVyZTEaMBgGCCqF
AwOBAwEBEgwxMjM0NTY3ODkwMTIwIBcNMjYxMTA2MTIzMjU5WhgPMjEyNjEwMTMx
MjMyNTlaMEAxIjAgBgNVBAMMGVNpZ25lciBlbnJvbGxtZW50IGZpeHR1cmUxGjAY
BggqhQMDgQMBARIMMTIzNDU2Nzg5MDEyMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A
MIIBCgKCAQEAtErhWn1VVz4fXQlWmb3F4wgE3VlGqpX/eolhwENNAD7h8L4dmDv0
h5owxqgqmwExEUEScuMz4Wduvjzfm7gXutl1U5SyZ1JMhignj8kBtNjpbfBa2Ext
zkQUqkhDoDsoMXHembQPXIPLYOLADS5+JHkvnUHw7YqXB8B0DkMlso1rbOas9aG/
qzD15bxkgjnHFh11CdAGAoYzonjeMhqcc3rMW2N7XcD+5Lnm+jmt/0zRTEEMrAH8
2+WLtKmmT6DJ8Y/s1LrCBO7kjKLBgUnMxI/ltesaOhJKcolOnntrh9DKp+wRAKc5
zwHomhGiUJu9SVN1fQ/4Md1rsXPFebvnBwIDAQABoyEwHzAdBgNVHQ4EFgQUffTg
cpAW8wKNRdd8+Fz8bC1WJmswDQYJKoZIhvcNAQELBQADggEBACkgzhakIjSqtnRX
ovBUWj2Bpoi8j6sTG9baQuotlR8/hgvf/9f1qV7dkGAjXL9efjNu/FEpF4jIwEXv
wkE5u49bQvmeGUzW+iLFVl5YUJtirfSCxfMlYYYNnC/LoqL05gwcq5Cxz2T+wnuc
fvhE4P+Nx1b4vm+TU++Z4EaMiQOFR1Br4Pz3332e0T9hVKtfFlpS9Nj4WLf6l26j
a+Vt3EdRCSXbC4qelgsjGFOmcr2evsOmB/kXvAktO5WhM1k2pFG6+4MJg4QvZY1F
kTg2tYnKlz6XO9t4c/4EzqXDC1YVnx/uwVeAaQtsC337f6t5GgX5Bayv8ElilDXJ
kudypBc=
-----END CERTIFICATE-----
`;
describe('Windows installer', () => {
  it('extracts the actual INN and public fingerprint, without trusting client metadata', () => {
    const c = new X509Certificate(certificate);
    expect(inspectSignerCertificate(c.raw.toString('base64'))).toMatchObject({
      sellerInn: '123456789012',
      certificateThumbprint: c.fingerprint.replaceAll(':', ''),
    });
    expect(() => inspectSignerCertificate('invalid')).toThrow(
      'CERTIFICATE_INVALID',
    );
  });
  it('builds a complete ZIP without a permanent backend credential', async () => {
    const ticket = 'a'.repeat(43),
      zip = unzipSync(
        await buildSignerInstaller({
          backendUrl: 'https://api.example.com',
          ticket,
        }),
      );
    expect(Object.keys(zip).sort()).toEqual(
      [
        'agent.ps1',
        'policy.ps1',
        'crypto-check.ps1',
        'connection.json',
        'install.ps1',
        'uninstall.ps1',
        'ПРОЧИТАЙТЕ.txt',
        'Установить.cmd',
      ].sort(),
    );
    expect(JSON.parse(strFromU8(zip['connection.json']!))).toEqual({
      backendUrl: 'https://api.example.com',
      ticket,
    });
    expect(strFromU8(zip['install.ps1']!)).toContain('AgentTokenProtected');
    expect(strFromU8(zip['install.ps1']!)).not.toContain('Read-Host');
    expect(strFromU8(zip['Установить.cmd']!)).not.toContain('Bypass');
    expect([...zip['agent.ps1']!.slice(0, 3)]).toEqual([239, 187, 191]);
  });
});
