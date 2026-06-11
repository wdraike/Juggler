/**
 * GetFeatureCatalog — application query use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `getFeatureCatalog` handler (feature-catalog.controller.js:199-202):
 *
 *   const productId = await getProductId();
 *   res.json({ ...CATALOG, product_id: productId || CATALOG.product_id });
 *
 * over the W4 EntitlementPort (`resolveProductId` ⇔ the legacy `getProductId`). The
 * static CATALOG object is INJECTED (it is pricing-agnostic static data owned by
 * the legacy controller; W6 supplies it). The slug-based `CATALOG.product_id`
 * default (PRODUCT_LABEL) is preserved verbatim via the `|| CATALOG.product_id`
 * fallback the legacy handler used — NOT a new fallback.
 *
 * The route-layer X-Service-Key auth (golden-master H4-1/H4-2/H4-5/H4-6) stays in
 * the W6 route middleware — it is NOT part of the handler body this use-case
 * reproduces.
 *
 * @typedef {Object} GetFeatureCatalogDeps
 * @property {import('../../domain/ports/EntitlementPort')} entitlement
 * @property {Object} catalog  the static CATALOG object (with a product_id slug
 *   default), injected by the facade (W6).
 */

'use strict';

/** @param {GetFeatureCatalogDeps} deps */
function GetFeatureCatalog(deps) {
  if (!deps || !deps.entitlement || !deps.catalog) {
    throw new Error('GetFeatureCatalog: { entitlement, catalog } are required');
  }
  this.entitlement = deps.entitlement;
  this.catalog = deps.catalog;
}

/**
 * @returns {Promise<{ status: number, body: Object }>}
 */
GetFeatureCatalog.prototype.execute = async function execute() {
  var productId = await this.entitlement.resolveProductId();
  // Legacy: { ...CATALOG, product_id: productId || CATALOG.product_id }
  var body = Object.assign({}, this.catalog, {
    product_id: productId || this.catalog.product_id
  });
  return { status: 200, body: body };
};

module.exports = GetFeatureCatalog;
