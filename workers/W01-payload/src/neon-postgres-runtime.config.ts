import schemaConfig from './neon-postgres-schema.config.js'

// Reuse the official local-only PostgreSQL schema config. It loads the same
// production W01 Users/Media collections, hooks, redirects plugin and R2 field
// definitions without booting Cloudflare's D1/R2 local proxy in this DB-only
// Payload Local API rehearsal.
export default schemaConfig
