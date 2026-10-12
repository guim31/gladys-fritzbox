// -----------------------------------------------------------------------------
// A simulated FRITZ!Box, built from the fixtures (real descriptions and host
// list of fritzconnection's tests, real action outputs of Home Assistant's
// tests): a `request` double for the TR-064 client (src/fritz/http.js) that
// checks the Digest authentication like the box does, answers SOAP actions
// and faults, serves the host list and the phone book; and a socket double for
// the call monitor. `serve()` exposes the same box over real HTTP and TCP,
// for the manual check in the locked-down Docker container (never used by the
// tests, which do not touch the network).
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';

process.env.LOG_LEVEL ??= 'silent';

export const fixture = (name) =>
  readFileSync(new URL(`../fixtures/fritz/${name}`, import.meta.url), 'utf8');

export const RESPONSES = JSON.parse(fixture('soap-responses.json'));
export const USERNAME = 'gladys';
export const PASSWORD = 'secret password';
const REALM = 'HTTPS Access';

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');

/** Control URL → { name, type }, read from a description the plain way. */
function servicesOf(xml) {
  const services = new Map();
  for (const [, block] of xml.matchAll(/<service>([\s\S]*?)<\/service>/g)) {
    const type = block.match(/<serviceType>([^<]+)</)?.[1];
    const id = block.match(/<serviceId>([^<]+)</)?.[1];
    const url = block.match(/<controlURL>([^<]+)</)?.[1];
    if (type && id && url && !services.has(url)) {
      services.set(url, { name: id.slice(id.lastIndexOf(':') + 1), type });
    }
  }
  return services;
}

function envelope(action, type, args) {
  const body = Object.entries(args)
    .map(
      ([key, value]) =>
        `<${key}>${String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</${key}>`,
    )
    .join('');
  return (
    '<?xml version="1.0"?>\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">\n<s:Body>\n' +
    `<u:${action}Response xmlns:u="${type}">\n${body}\n</u:${action}Response>\n</s:Body>\n</s:Envelope>\n`
  );
}

// The fault the box answers, as in fritzconnection's tests.
const fault = (code, description) =>
  '<?xml version="1.0"?>\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
  's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">\n<s:Body>\n<s:Fault>\n' +
  '<faultcode>s:Client</faultcode>\n<faultstring>UPnPError</faultstring>\n<detail>\n' +
  '<UPnPError xmlns="urn:schemas-upnp-org:control-1-0">\n' +
  `<errorCode>${code}</errorCode>\n<errorDescription>${description}</errorDescription>\n` +
  '</UPnPError>\n</detail>\n</s:Fault>\n</s:Body>\n</s:Envelope>\n';

const UNAUTHORIZED_HTML =
  '<HTML><HEAD><TITLE>401 Unauthorized</TITLE></HEAD><BODY>Unauthorized</BODY></HTML>';

/**
 * @param {object} [options]
 * @param {string} [options.host] the address it answers on
 * @param {boolean} [options.tr064] false: "Allow access for applications" is off
 * @param {boolean} [options.igd] false: "Transmit status information over UPnP" is off
 * @param {string[]} [options.denied] `Service#Action` refused with 606
 * @param {Record<string, number>} [options.faults] `Service#Action` → UPnP error code
 * @param {string} [options.hostList] content of devicehostlist.lua
 * @param {string} [options.tr64desc] content of tr64desc.xml
 */
export function createFakeFritz({
  host = '192.0.2.1',
  tr064 = true,
  igd = true,
  denied = [],
  faults = {},
  hostList = fixture('devicehostlist.xml'),
  tr64desc = fixture('tr64desc.xml'),
} = {}) {
  const igddesc = fixture('igddesc.xml');
  const services = new Map([...servicesOf(tr64desc), ...servicesOf(igddesc)]);
  const igdUrls = new Set(servicesOf(igddesc).keys());
  const nonces = new Map();

  const box = {
    host,
    tr064,
    igd,
    denied: new Set(denied),
    faults: { ...faults },
    reachable: true,
    users: { [USERNAME]: PASSWORD },
    connected: true,
    uptime: 57199,
    externalIp: '203.0.113.17',
    nextIp: '203.0.113.42',
    // Reads of the connection status before a reconnection completes.
    reconnectReads: 2,
    pendingReconnect: 0,
    download: 67649,
    upload: 3438,
    guestEnabled: false,
    hostList,
    phonebook: fixture('phonebook.xml'),
    requests: [],
    actions: [],
    failedLogins: 0,
    sockets: [],
    callMonitor: true,

    /** The TR-064 client's request seam. */
    async request({ method, url, headers = {}, body = '' }) {
      const target = new URL(url);
      box.requests.push({ method, path: `${target.pathname}${target.search}`, headers, body });
      if (!box.reachable || target.hostname !== box.host.replace(/^\[|\]$/g, '')) {
        throw Object.assign(new Error(`connect ECONNREFUSED ${target.hostname}`), {
          code: 'ECONNREFUSED',
        });
      }
      return box.answer(method, target, headers, body);
    },

    answer(method, target, headers, body) {
      const path = target.pathname;
      if (method === 'GET' && path === '/tr64desc.xml') {
        return box.tr064 ? ok(tr64desc) : notFound();
      }
      if (method === 'GET' && path === '/igddesc.xml') {
        return box.igd ? ok(igddesc) : notFound();
      }
      if (method === 'GET' && path === '/devicehostlist.lua') {
        return target.searchParams.get('sid') ? ok(box.hostList) : forbidden();
      }
      if (method === 'GET' && path === '/phonebook.lua') {
        return target.searchParams.get('sid') ? ok(box.phonebook) : forbidden();
      }
      const service = services.get(path);
      if (method !== 'POST' || !service) {
        return notFound();
      }
      const igdService = igdUrls.has(path);
      if (!igdService && !box.tr064) {
        return notFound();
      }
      // UPnP IGD has no authentication; TR-064 always asks for one.
      if (
        !igdService &&
        !box.authorized(method, `${path}${target.search}`, headers.authorization)
      ) {
        return {
          status: 401,
          headers: { 'www-authenticate': box.challenge() },
          body: UNAUTHORIZED_HTML,
        };
      }
      const action = String(headers.soapaction ?? '').split('#')[1];
      if (headers.soapaction !== `${service.type}#${action}` || !body.includes(`<u:${action} `)) {
        return { status: 500, headers: {}, body: fault(401, 'Invalid Action') };
      }
      const args = Object.fromEntries(
        [...body.matchAll(/<(New[\w-]+)>([^<]*)<\/\1>/g)].map(([, key, value]) => [key, value]),
      );
      const key = `${service.name}#${action}`;
      box.actions.push({ key, args });
      if (box.denied.has(key)) {
        return { status: 500, headers: {}, body: fault(606, 'Action not authorized') };
      }
      if (box.faults[key]) {
        return { status: 500, headers: {}, body: fault(box.faults[key], 'Error') };
      }
      const output = box.run(key, args);
      if (output === undefined) {
        return { status: 500, headers: {}, body: fault(401, 'Invalid Action') };
      }
      return {
        status: 200,
        headers: { 'content-type': 'text/xml' },
        body: envelope(action, service.type, output),
      };
    },

    run(key, args) {
      switch (key) {
        case 'WANPPPConnection1#GetInfo': {
          if (box.pendingReconnect > 0) {
            box.pendingReconnect -= 1;
            if (box.pendingReconnect === 0) {
              box.connected = true;
              box.uptime = 4;
              box.externalIp = box.nextIp;
            }
          }
          return {
            ...RESPONSES[key],
            NewConnectionStatus: box.connected ? 'Connected' : 'Disconnected',
            NewUptime: box.connected ? box.uptime : 0,
            NewExternalIPAddress: box.connected ? box.externalIp : '0.0.0.0',
          };
        }
        case 'WANPPPConnection1#ForceTermination':
          box.connected = false;
          box.pendingReconnect = box.reconnectReads;
          return {};
        case 'WANCommonIFC1#GetAddonInfos':
          return {
            ...RESPONSES[key],
            NewByteReceiveRate: box.download,
            NewByteSendRate: box.upload,
          };
        case 'WLANConfiguration3#GetInfo':
          return {
            ...RESPONSES[key],
            NewEnable: box.guestEnabled ? 1 : 0,
            NewStatus: box.guestEnabled ? 'Up' : 'Disabled',
          };
        case 'WLANConfiguration3#SetEnable':
          box.guestEnabled = args.NewEnable === '1';
          return {};
        case 'X_AVM-DE_OnTel1#GetPhonebook':
          return {
            ...RESPONSES[key],
            NewPhonebookURL: `http://fritz.box:49000/phonebook.lua?sid=0123456789abcdef&pbid=${args.NewPhonebookID}`,
          };
        default:
          return RESPONSES[key];
      }
    },

    challenge() {
      const nonce = randomBytes(8).toString('hex').toUpperCase();
      nonces.set(nonce, 0);
      return `Digest realm="${REALM}", nonce="${nonce}", algorithm=MD5, qop="auth"`;
    },

    /** RFC 2617 check of an Authorization header, nonce counter included. */
    authorized(method, uri, header) {
      if (!header || !header.startsWith('Digest ')) {
        return false;
      }
      const params = Object.fromEntries(
        [...header.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)].map(
          ([, key, quoted, bare]) => [key, quoted ?? bare],
        ),
      );
      const password = box.users[params.username];
      const count = parseInt(params.nc, 16);
      if (
        password === undefined ||
        params.realm !== REALM ||
        params.uri !== uri ||
        !nonces.has(params.nonce) ||
        !(count > nonces.get(params.nonce))
      ) {
        box.failedLogins += password === undefined ? 1 : 0;
        return false;
      }
      const ha1 = md5(`${params.username}:${REALM}:${password}`);
      const ha2 = md5(`${method}:${uri}`);
      const expected = md5(`${ha1}:${params.nonce}:${params.nc}:${params.cnonce}:auth:${ha2}`);
      if (params.response !== expected || params.qop !== 'auth') {
        box.failedLogins += 1;
        return false;
      }
      nonces.set(params.nonce, count);
      return true;
    },

    /** Drop every nonce, as the box does after a while. */
    expireNonces() {
      nonces.clear();
    },

    /** The call monitor's socket seam: `({ host, port }) => socket`. */
    connectSocket({ host: target, port }) {
      const socket = new EventEmitter();
      socket.setEncoding = () => {};
      socket.setKeepAlive = () => {};
      socket.destroyed = false;
      socket.destroy = () => {
        if (!socket.destroyed) {
          socket.destroyed = true;
          box.sockets = box.sockets.filter((entry) => entry !== socket);
          setImmediate(() => socket.emit('close'));
        }
      };
      setImmediate(() => {
        if (target !== box.host || port !== 1012 || !box.callMonitor) {
          socket.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
          socket.destroy();
          return;
        }
        box.sockets.push(socket);
        socket.emit('connect');
      });
      return socket;
    },

    /** Send call monitor lines to every connected socket. */
    callLine(...lines) {
      for (const socket of box.sockets) {
        socket.emit('data', lines.map((line) => `${line}\r\n`).join(''));
      }
    },
  };
  return box;
}

const ok = (body) => ({ status: 200, headers: { 'content-type': 'text/xml' }, body });
const notFound = () => ({ status: 404, headers: {}, body: '<HTML>404 Not Found</HTML>' });
const forbidden = () => ({ status: 403, headers: {}, body: '<HTML>403 Forbidden</HTML>' });

/**
 * Serve a simulated box over real HTTP (TR-064) and TCP (call monitor), for
 * the manual check in Docker. Resolves `{ close, callLine }`.
 */
export async function serve(box, { httpPort = 49000, callPort = 1012, address = '0.0.0.0' } = {}) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const target = new URL(req.url, `http://${box.host}:${httpPort}`);
      box.requests.push({ method: req.method, path: req.url, headers: req.headers, body });
      const answer = box.answer(req.method, target, req.headers, body);
      res.writeHead(answer.status, answer.headers);
      res.end(answer.body);
    });
  });
  const sockets = new Set();
  const calls = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(httpPort, address, resolve));
  await new Promise((resolve) => calls.listen(callPort, address, resolve));
  return {
    callLine(...lines) {
      for (const socket of sockets) {
        socket.write(lines.map((line) => `${line}\r\n`).join(''));
      }
    },
    connections: () => sockets.size,
    close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close();
      calls.close();
    },
  };
}
