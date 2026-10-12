// -----------------------------------------------------------------------------
// Finding the box without typing its address. The integration container sits
// on a bridge network and never sees SSDP: the core sends the M-SEARCH for the
// TR-064 root device (`urn:dslforum-org:device:InternetGatewayDevice:1`) and
// relays the raw answers (mediated discovery, manifest `network_discovery`).
// A FRITZ!Box answers with the location of its `tr64desc.xml` on port 49000.
// -----------------------------------------------------------------------------

import { isIPv4 } from 'node:net';

export const SSDP_SEARCH_TARGET = 'urn:dslforum-org:device:InternetGatewayDevice:1';
export const SCAN_TIMEOUT_SECONDS = 4;

/** Headers of one raw SSDP answer, keys lower-cased. */
export function parseSsdpHeaders(text) {
  const headers = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0) {
      const key = line.slice(0, at).trim().toLowerCase();
      if (!(key in headers)) {
        headers[key] = line.slice(at + 1).trim();
      }
    }
  }
  return headers;
}

/**
 * The boxes among the answers of `scanNetwork('ssdp')`, one per address: a
 * TR-064 description served by the answering address itself.
 * @param {Array<{ source_ip: string, headers: string }>} results
 * @returns {Array<{ address: string, server: string|null }>}
 */
export function boxCandidates(results) {
  const byAddress = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const address = result?.source_ip;
    if (typeof address !== 'string' || !isIPv4(address) || byAddress.has(address)) {
      continue;
    }
    const headers = parseSsdpHeaders(result.headers);
    let location;
    try {
      location = new URL(headers.location);
    } catch {
      continue;
    }
    const tr064 =
      /tr64desc\.xml$/i.test(location.pathname) || /dslforum-org/i.test(headers.st ?? '');
    if (tr064 && location.hostname === address) {
      byAddress.set(address, { address, server: headers.server || null });
    }
  }
  // A FRITZ!Box first (a repeater or another router may answer too).
  return [...byAddress.values()].sort(
    (a, b) => Number(/FRITZ!Box/i.test(b.server ?? '')) - Number(/FRITZ!Box/i.test(a.server ?? '')),
  );
}
