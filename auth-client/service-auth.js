/**
 * Service-to-Service JWT Authentication
 *
 * Each service has its own RSA keypair. When calling another service,
 * it signs a short-lived JWT (60s) with its private key. The receiving
 * service verifies the signature against the caller's published JWKS.
 *
 * Usage:
 *   const { initServiceAuth, authenticateService, serviceRequest, getServiceJWKSHandler } = require('./vendor/service-auth');
 *
 *   // On startup
 *   await initServiceAuth({ serviceName: 'payment-service' });
 *
 *   // Mount JWKS endpoint
 *   app.get('/.well-known/service-jwks.json', getServiceJWKSHandler());
 *
 *   // Protect internal routes (dual-mode: accepts ServiceJWT or legacy X-Internal-Key)
 *   router.use(authenticateService());
 *
 *   // Call another service
 *   const data = await serviceRequest('auth-service', '/internal/users/bulk', { method: 'POST', body: {...} });
 */

const crypto = require('crypto');
const { SignJWT, jwtVerify, importPKCS8, importSPKI, exportJWK, createRemoteJWKSet } = require('jose');
const fs = require('fs');
const path = require('path');

const ALG = 'RS256';
const TOKEN_TTL = '60s';

let _serviceName = null;
let _privateKey = null;
let _publicKey = null;
let _kid = null;
let _jwksCache = {};         // { serviceName: { jwks, timestamp } }
const JWKS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Trusted services registry: { name: url }
let _trustedServices = {};

/**
 * Initialize service auth — load or generate RSA keypair
 */
async function initServiceAuth({ serviceName, keysDir } = {}) {
  _serviceName = serviceName || process.env.SERVICE_NAME;
  if (!_serviceName) throw new Error('SERVICE_NAME required for service-auth');

  // Parse trusted services from env
  const trustedStr = process.env.TRUSTED_SERVICES || '';
  for (const entry of trustedStr.split(',').filter(Boolean)) {
    const [name, url] = entry.split(':http');
    if (name && url) {
      _trustedServices[name.trim()] = 'http' + url.trim();
    }
  }

  // Try loading from env (production)
  if (process.env.SERVICE_RSA_PRIVATE_KEY && process.env.SERVICE_RSA_PUBLIC_KEY) {
    const privPem = process.env.SERVICE_RSA_PRIVATE_KEY.replace(/\\n/g, '\n');
    const pubPem = process.env.SERVICE_RSA_PUBLIC_KEY.replace(/\\n/g, '\n');
    _privateKey = await importPKCS8(privPem, ALG);
    _publicKey = await importSPKI(pubPem, ALG);
    _kid = process.env.SERVICE_RSA_KID || crypto.randomBytes(8).toString('hex');
    console.log(`[service-auth] Loaded keys from env for ${_serviceName} (kid: ${_kid})`);
    return;
  }

  // Try loading from files (development)
  const dir = keysDir || path.join(process.cwd(), 'src', 'keys');
  const privPath = path.join(dir, 'service-private.pem');
  const pubPath = path.join(dir, 'service-public.pem');
  const kidPath = path.join(dir, 'service-kid.txt');

  if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
    _privateKey = await importPKCS8(fs.readFileSync(privPath, 'utf8'), ALG);
    _publicKey = await importSPKI(fs.readFileSync(pubPath, 'utf8'), ALG);
    _kid = fs.existsSync(kidPath) ? fs.readFileSync(kidPath, 'utf8').trim() : crypto.randomBytes(8).toString('hex');
    console.log(`[service-auth] Loaded keys from files for ${_serviceName} (kid: ${_kid})`);
    return;
  }

  // Generate new keypair
  const { generateKeyPair } = require('crypto');
  const { privateKey, publicKey } = await new Promise((resolve, reject) => {
    generateKeyPair('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    }, (err, pub, priv) => err ? reject(err) : resolve({ privateKey: priv, publicKey: pub }));
  });

  _kid = crypto.randomBytes(8).toString('hex');

  // Save to files for reuse
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(privPath, privateKey);
  fs.writeFileSync(pubPath, publicKey);
  fs.writeFileSync(kidPath, _kid);

  _privateKey = await importPKCS8(privateKey, ALG);
  _publicKey = await importSPKI(publicKey, ALG);
  console.log(`[service-auth] Generated new keys for ${_serviceName} (kid: ${_kid})`);
}

/**
 * Get JWKS for publishing this service's public key
 */
async function getServiceJWKS() {
  if (!_publicKey) throw new Error('Service auth not initialized');
  const jwk = await exportJWK(_publicKey);
  return {
    keys: [{
      ...jwk,
      kid: _kid,
      alg: ALG,
      use: 'sig'
    }]
  };
}

/**
 * Express handler for /.well-known/service-jwks.json
 */
function getServiceJWKSHandler() {
  return async (req, res) => {
    try {
      const jwks = await getServiceJWKS();
      res.json(jwks);
    } catch (err) {
      res.status(500).json({ error: 'Service JWKS unavailable' });
    }
  };
}

/**
 * Generate a signed JWT for calling another service
 */
async function generateServiceToken(targetServiceName) {
  if (!_privateKey || !_serviceName) throw new Error('Service auth not initialized');

  return new SignJWT({})
    .setProtectedHeader({ alg: ALG, kid: _kid })
    .setIssuer(_serviceName)
    .setSubject(`service:${_serviceName}`)
    .setAudience(targetServiceName)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .setJti(crypto.randomBytes(16).toString('hex'))
    .sign(_privateKey);
}

/**
 * Fetch and cache a service's JWKS
 */
async function getRemoteJWKS(serviceName) {
  const cached = _jwksCache[serviceName];
  if (cached && (Date.now() - cached.timestamp) < JWKS_CACHE_TTL) {
    return cached.jwks;
  }

  const serviceUrl = _trustedServices[serviceName];
  if (!serviceUrl) return null;

  try {
    const jwks = createRemoteJWKSet(new URL(`${serviceUrl}/.well-known/service-jwks.json`));
    _jwksCache[serviceName] = { jwks, timestamp: Date.now() };
    return jwks;
  } catch (err) {
    console.error(`[service-auth] Failed to fetch JWKS for ${serviceName}:`, err.message);
    return cached?.jwks || null;
  }
}

/**
 * Express middleware — verifies incoming service JWTs
 * Dual-mode: also accepts legacy X-Internal-Key during transition
 */
function authenticateService(allowedIssuers) {
  return async (req, res, next) => {
    // Check for ServiceJWT first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('ServiceJWT ')) {
      const token = authHeader.substring(11);
      try {
        // Decode header to get issuer for JWKS lookup
        const [headerB64] = token.split('.');
        const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());

        // We need the payload's iss to find the right JWKS
        const [, payloadB64] = token.split('.');
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
        const issuer = payload.iss;

        if (allowedIssuers && !allowedIssuers.includes(issuer)) {
          return res.status(403).json({ error: `Service "${issuer}" not allowed` });
        }

        if (!_trustedServices[issuer]) {
          return res.status(401).json({ error: `Unknown service: ${issuer}` });
        }

        const jwks = await getRemoteJWKS(issuer);
        if (!jwks) {
          return res.status(401).json({ error: `Cannot verify service: ${issuer}` });
        }

        const { payload: verified } = await jwtVerify(token, jwks, {
          issuer,
          audience: _serviceName
        });

        req.serviceAuth = {
          service: issuer,
          subject: verified.sub,
          jti: verified.jti
        };

        return next();
      } catch (err) {
        if (err.code === 'ERR_JWT_EXPIRED') {
          return res.status(401).json({ error: 'Service token expired' });
        }
        return res.status(401).json({ error: 'Invalid service token: ' + err.message });
      }
    }

    // Legacy fallback: X-Internal-Key
    const internalKey = req.headers['x-internal-key'];
    const expectedKey = process.env.INTERNAL_SERVICE_KEY;

    if (internalKey && expectedKey) {
      try {
        const keyBuf = Buffer.from(internalKey);
        const expectedBuf = Buffer.from(expectedKey);
        if (keyBuf.length === expectedBuf.length && crypto.timingSafeEqual(keyBuf, expectedBuf)) {
          req.serviceAuth = { service: 'legacy', subject: 'legacy' };
          return next();
        }
      } catch { /* fall through */ }
    }

    return res.status(401).json({ error: 'Service authentication required' });
  };
}

/**
 * Helper: make an authenticated request to another service
 */
async function serviceRequest(targetServiceName, urlPath, options = {}) {
  const serviceUrl = _trustedServices[targetServiceName];
  if (!serviceUrl) throw new Error(`Unknown service: ${targetServiceName}`);

  const token = await generateServiceToken(targetServiceName);

  const { body, ...restOptions } = options;
  const fetchOptions = {
    ...restOptions,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `ServiceJWT ${token}`,
      ...(options.headers || {})
    },
    signal: options.signal || AbortSignal.timeout(options.timeout || 5000)
  };

  if (body && typeof body === 'object') {
    fetchOptions.body = JSON.stringify(body);
  } else if (body) {
    fetchOptions.body = body;
  }

  const response = await fetch(`${serviceUrl}${urlPath}`, fetchOptions);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Service call to ${targetServiceName}${urlPath} failed: ${response.status} ${text}`);
  }

  return response.json();
}

module.exports = {
  initServiceAuth,
  getServiceJWKS,
  getServiceJWKSHandler,
  generateServiceToken,
  authenticateService,
  serviceRequest
};
