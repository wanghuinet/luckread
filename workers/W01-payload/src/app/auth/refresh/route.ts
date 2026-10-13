// Legacy compatibility alias. This endpoint does not rotate access/refresh
// tokens; new clients must use GET /api/v1/auth/session.
export { GET as POST } from '../session/route.js'
