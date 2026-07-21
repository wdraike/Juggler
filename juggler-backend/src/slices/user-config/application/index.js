/**
 * User-config application layer — barrel re-export (Phase H4 / W5).
 *
 * The orchestration use-cases that reproduce the legacy 5 controllers + 3
 * middleware's flows over the W3 ConfigRepositoryPort + W4 EntitlementPort + the
 * W2 pure domain logic + injected cross-table collaborators (NO direct
 * DB/express/fetch here). The W6 facade wires the adapters → these use-cases; the
 * thin controllers/middleware map req→input / result→res|next.
 *
 * Each use-case returns a `{ status, body }` (or `{ status: null }` for the gate
 * allow→next) envelope — express-free, behavior-identical to the legacy
 * res.status(...).json(...) the golden-master (W1) pins.
 *
 * Handler/middleware → use-case mapping:
 *   config.controller getAllConfig       → queries/GetConfig
 *   config.controller getProjects        → queries/GetProjects
 *   config.controller getLocations       → queries/GetLocations
 *   config.controller getTools           → queries/GetTools
 *   config.controller updateConfig       → commands/UpdateConfig
 *   config.controller resetScheduleTemplates → commands/ResetScheduleTemplates (999.2144)
 *   config.controller createProject      → commands/CreateProject
 *   config.controller updateProject      → commands/UpdateProject
 *   config.controller deleteProject      → commands/DeleteProject
 *   config.controller reorderProjects    → commands/ReorderProjects
 *   config.controller replaceLocations   → commands/ReplaceLocations
 *   config.controller replaceTools       → commands/ReplaceTools
 *   data.controller   exportData         → queries/ExportData
 *   data.controller   importData         → commands/ImportData
 *   feature-catalog   getFeatureCatalog  → queries/GetFeatureCatalog
 *   impersonation     getImpersonationTargets → queries/ListImpersonationTargets
 *   impersonation     getImpersonationLog → queries/GetImpersonationLog
 *   impersonation     startImpersonation → commands/Impersonate
 *   impersonation     stopImpersonation  → commands/StopImpersonation
 *   plan-features     resolvePlanFeatures → commands/CheckEntitlement
 *   feature-gate      requireFeature / requireFeatureIncludes / checkUsageLimit → commands/GateFeature
 *   entity-limits     check* middleware  → commands/EnforceEntityLimit
 *   billing-webhooks  handleWebhook      → commands/HandleBillingWebhook
 *   jwt-auth          resolve-or-provision → commands/ProvisionUserOnFirstLogin (999.1197)
 *   my-plan.routes    GET /                → queries/GetMyPlan (999.1196)
 *   feature-events.routes GET /            → queries/GetFeatureEventsReport (999.1196)
 *   config.controller updateTimezone      → commands/UpdateUserTimezone (999.1447)
 */

'use strict';

module.exports = {
  // queries
  GetConfig: require('./queries/GetConfig'),
  GetProjects: require('./queries/GetProjects'),
  ListProjects: require('./queries/ListProjects'),
  GetLocations: require('./queries/GetLocations'),
  GetTools: require('./queries/GetTools'),
  GetFeatureCatalog: require('./queries/GetFeatureCatalog'),
  ExportData: require('./queries/ExportData'),
  ListImpersonationTargets: require('./queries/ListImpersonationTargets'),
  GetImpersonationLog: require('./queries/GetImpersonationLog'),
  GetMyPlan: require('./queries/GetMyPlan'),
  GetFeatureEventsReport: require('./queries/GetFeatureEventsReport'),
  // commands
  UpdateConfig: require('./commands/UpdateConfig'),
  ResetScheduleTemplates: require('./commands/ResetScheduleTemplates'),
  CreateProject: require('./commands/CreateProject'),
  UpdateProject: require('./commands/UpdateProject'),
  DeleteProject: require('./commands/DeleteProject'),
  ReorderProjects: require('./commands/ReorderProjects'),
  ReplaceLocations: require('./commands/ReplaceLocations'),
  ReplaceTools: require('./commands/ReplaceTools'),
  ImportData: require('./commands/ImportData'),
  MergeImportData: require('./commands/MergeImportData'),
  CheckEntitlement: require('./commands/CheckEntitlement'),
  GateFeature: require('./commands/GateFeature'),
  EnforceEntityLimit: require('./commands/EnforceEntityLimit'),
  HandleBillingWebhook: require('./commands/HandleBillingWebhook'),
  Impersonate: require('./commands/Impersonate'),
  StopImpersonation: require('./commands/StopImpersonation'),
  ProvisionUserOnFirstLogin: require('./commands/ProvisionUserOnFirstLogin'),
  UpdateUserTimezone: require('./commands/UpdateUserTimezone')
};
