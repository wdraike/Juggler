/**
 * Feature Catalog Controller
 *
 * Exposes StriveRS's configurable features in a pricing-agnostic format.
 * The payment service fetches this to know what can be configured
 * when building pricing tiers.
 *
 * 999.1192 (JUG-HEX-SLICES-CALL-CONTROLLERS): the static CATALOG moved
 * VERBATIM into the user-config slice's domain data
 * (slices/user-config/domain/featureCatalog.js) — the slice facade now reads
 * it there instead of requiring this HTTP controller (which also closed the
 * user-config facade ↔ feature-catalog.controller require cycle). This module
 * re-exports `CATALOG` unchanged for its external consumers.
 */

const { CATALOG } = require('../slices/user-config/domain/featureCatalog');

/**
 * GET /api/feature-catalog — THIN HTTP adapter (Phase H4 / W6).
 *
 * The catalog read (product-id resolution via the entitlement adapter, then
 * `{ ...CATALOG, product_id }`) was extracted into the user-config slice
 * (GetFeatureCatalog query). This handler delegates to the facade and maps the
 * `{ status, body }` envelope onto express. The static CATALOG (whose
 * `product_id: PRODUCT_LABEL` slug-keys the product at module load) lives in the
 * slice's domain (featureCatalog.js) and is wired into GetFeatureCatalog by the
 * facade. No DB access (never had any).
 *
 * The service-key auth guard (feature-catalog.routes.js authenticateServiceKey)
 * stays at the route edge — preserved.
 */
exports.getFeatureCatalog = async (req, res) => {
  const facade = require('../slices/user-config/facade');
  const result = await facade.getFeatureCatalog();
  res.status(result.status).json(result.body);
};

// Back-compat re-export (external consumers + the 999.1192 shim contract).
exports.CATALOG = CATALOG;
