// -----------------------------------------------------------------------------
// TR-064 client: AVM's documented local interface (SOAP over HTTP, port 49000,
// or HTTPS, port 49443, with Digest authentication).
//
// - `loadDescriptions()` reads `tr64desc.xml` (TR-064 services, served only
//   when "Allow access for applications" is on) and `igddesc.xml` (UPnP IGD
//   services, served only when "Transmit status information over UPnP" is
//   on): the services a box offers vary with the model and FRITZ!OS, so the
//   control URLs are read, never assumed. Services are named like
//   fritzconnection does: the end of their serviceId (`DeviceInfo1`,
//   `WLANConfiguration3`, `WANCommonIFC1`…).
// - `call(service, action, args)` sends one SOAP action and resolves its
//   output arguments as strings.
// - `fetchText(url)` reads a document the box links to (host list, phone
//   book) from the same address.
//
// Errors are `Tr064Error`s with a `kind` the caller can act on: `unreachable`,
// `auth` (wrong user or password: stop and say so, the box blocks logins after
// failures), `disabled` (TR-064 off), `fault` (UPnP error code: 606 = the user
// lacks a right, 401 = unknown action…), `http`, `service` (not on this box).
// -----------------------------------------------------------------------------

import { authorization, parseChallenge } from './digest.js';
import { DEFAULT_TIMEOUT_MS, httpRequest } from './http.js';
import { blocks, children, escapeXml, readTag } from './xml.js';

export const TR064_PORT = 49000;
export const TR064_TLS_PORT = 49443;

export class Tr064Error extends Error {
  constructor(kind, message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'Tr064Error';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

const NETWORK_ERRORS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
]);

/** The services of a UPnP description, by short name. */
export function parseServices(xml) {
  const services = new Map();
  for (const block of blocks(xml, 'service')) {
    const fields = children(block);
    const id = fields.serviceId ?? '';
    const name = id.slice(id.lastIndexOf(':') + 1);
    if (name && fields.serviceType && fields.controlURL && !services.has(name)) {
      services.set(name, { type: fields.serviceType, controlUrl: fields.controlURL });
    }
  }
  return services;
}

/** Identity of the root device of `tr64desc.xml`. */
export function parseDescription(xml) {
  return {
    friendlyName: readTag(xml, 'friendlyName'),
    modelName: readTag(xml, 'modelName'),
    udn: readTag(xml, 'UDN'),
    firmware: readTag(xml, 'Display'),
  };
}

/** The UPnP error code of a SOAP fault, as a number, or null. */
export function faultCode(xml) {
  const code = readTag(xml, 'errorCode');
  return code && /^\d+$/.test(code) ? Number(code) : null;
}

export class Tr064Client {
  /**
   * @param {object} options
   * @param {string} options.host address or name of the box
   * @param {boolean} [options.https] TLS on port 49443
   * @param {number} [options.port]
   * @param {string} [options.username]
   * @param {string} [options.password]
   * @param {Function} [options.request] test seam, see src/fritz/http.js
   * @param {number} [options.timeoutMs]
   */
  constructor({ host, https = false, port, username = '', password = '', request, timeoutMs }) {
    this.host = host;
    this.https = https;
    this.port = port ?? (https ? TR064_TLS_PORT : TR064_PORT);
    this.username = username;
    this.password = password;
    this.request = request ?? httpRequest;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.challenge = null;
    this.nc = 0;
    this.services = new Map();
    this.description = null;
    this.igd = false;
  }

  get base() {
    const host = this.host.includes(':') ? `[${this.host}]` : this.host;
    return `${this.https ? 'https' : 'http'}://${host}:${this.port}`;
  }

  /** Read the service lists; resolves the identity of the box. */
  async loadDescriptions() {
    const tr64 = await this.send('GET', '/tr64desc.xml');
    if (tr64.status === 404) {
      throw new Tr064Error('disabled', 'tr64desc.xml not served: TR-064 access is off', {
        status: 404,
      });
    }
    if (tr64.status !== 200) {
      throw new Tr064Error('http', `tr64desc.xml answered HTTP ${tr64.status}`, {
        status: tr64.status,
      });
    }
    this.services = parseServices(tr64.body);
    this.description = parseDescription(tr64.body);
    // The IGD description is optional: only some status values come from it.
    try {
      const igd = await this.send('GET', '/igddesc.xml');
      this.igd = igd.status === 200;
      if (this.igd) {
        for (const [name, service] of parseServices(igd.body)) {
          if (!this.services.has(name)) {
            this.services.set(name, { ...service, igd: true });
          }
        }
      }
    } catch (err) {
      if (err.kind === 'auth') {
        throw err;
      }
      this.igd = false;
    }
    return this.description;
  }

  has(service) {
    return this.services.has(service);
  }

  /**
   * One SOAP action.
   * @param {string} serviceName e.g. `DeviceInfo1`
   * @param {string} action e.g. `GetInfo`
   * @param {Record<string, string|number|boolean>} [args]
   * @returns {Promise<Record<string, string>>} the output arguments
   */
  async call(serviceName, action, args = {}) {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Tr064Error('service', `${serviceName} is not offered by this box`);
    }
    const argumentsXml = Object.entries(args)
      .map(([key, value]) => {
        const text = typeof value === 'boolean' ? (value ? '1' : '0') : value;
        return `<${key}>${escapeXml(text)}</${key}>`;
      })
      .join('');
    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" ' +
      'xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
      `<u:${action} xmlns:u="${escapeXml(service.type)}">${argumentsXml}</u:${action}>` +
      '</s:Body></s:Envelope>';
    const response = await this.send('POST', service.controlUrl, body, {
      'content-type': 'text/xml; charset="utf-8"',
      soapaction: `${service.type}#${action}`,
    });
    if (response.status !== 200) {
      const code = faultCode(response.body);
      if (code !== null) {
        throw new Tr064Error('fault', `${serviceName}.${action}: UPnP error ${code}`, {
          status: response.status,
          code,
        });
      }
      throw new Tr064Error('http', `${serviceName}.${action}: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    const [inner] = blocks(response.body, `${action}Response`);
    return children(inner ?? '');
  }

  /**
   * GET a document the box links to. Only the path and query of `url` are
   * kept: the box writes its own name in the links (`fritz.box`), which the
   * container may not resolve, while the configured address always works.
   */
  async fetchText(url) {
    let path = url;
    try {
      const parsed = new URL(url, this.base);
      path = `${parsed.pathname}${parsed.search}`;
    } catch {
      // keep the path as given
    }
    const response = await this.send('GET', path);
    if (response.status !== 200) {
      throw new Tr064Error('http', `GET ${path.split('?')[0]}: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    return response.body;
  }

  /**
   * One request, answered by Digest when the box asks for it: sent with the
   * last challenge when there is one, and once more with a fresh challenge on
   * a 401 (an expired nonce). A second 401 means wrong credentials.
   */
  async send(method, path, body, headers = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sent = { ...headers };
      if (this.challenge && this.username) {
        this.nc += 1;
        sent.authorization = authorization({
          challenge: this.challenge,
          username: this.username,
          password: this.password,
          method,
          uri: path,
          nc: this.nc,
        });
      }
      let response;
      try {
        response = await this.request({
          method,
          url: `${this.base}${path}`,
          headers: sent,
          body,
          timeoutMs: this.timeoutMs,
        });
      } catch (err) {
        if (NETWORK_ERRORS.has(err.code)) {
          throw new Tr064Error('unreachable', `${this.host}: ${err.code}`);
        }
        throw new Tr064Error('unreachable', `${this.host}: ${err.message}`);
      }
      if (response.status !== 401) {
        return response;
      }
      const challenge = parseChallenge(response.headers?.['www-authenticate']);
      if (!challenge || !this.username) {
        throw new Tr064Error('auth', 'The FRITZ!Box asks for a user name and password', {
          status: 401,
        });
      }
      const retried = Boolean(sent.authorization) && attempt === 1;
      this.challenge = challenge;
      this.nc = 0;
      if (retried) {
        break;
      }
    }
    this.challenge = null;
    throw new Tr064Error('auth', 'The FRITZ!Box refused the user name or password', {
      status: 401,
    });
  }
}
