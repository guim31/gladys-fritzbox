// -----------------------------------------------------------------------------
// The one place that opens HTTP connections to the FRITZ!Box: a small request
// function over node:http / node:https, bounded in time and size. It is the
// seam the tests replace with a simulated box (test/helpers/fakeFritz.js).
//
// HTTPS (port 49443): the box serves a self-signed certificate, so it is not
// verified — the same choice as fritzconnection and Home Assistant. It still
// encrypts the traffic on the local network.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

export const DEFAULT_TIMEOUT_MS = 10000;
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * @param {object} request
 * @param {string} request.method
 * @param {string} request.url absolute URL
 * @param {Record<string, string>} [request.headers]
 * @param {string} [request.body]
 * @param {number} [request.timeoutMs]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export function httpRequest({ method, url, headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const secure = target.protocol === 'https:';
    const payload = body === undefined ? undefined : Buffer.from(body, 'utf8');
    const req = (secure ? https : http).request(
      target,
      {
        method,
        headers: payload ? { ...headers, 'content-length': payload.length } : headers,
        timeout: timeoutMs,
        ...(secure ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(Object.assign(new Error('Response too large'), { code: 'ETOOBIG' }));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' }));
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}
