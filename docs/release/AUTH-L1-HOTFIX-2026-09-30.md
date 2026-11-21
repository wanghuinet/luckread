# LuckRead W02 authentication L1 hotfix marker

AUTH_L1_HOTFIX=AUTHORIZED_BY_MAIN_MERGE

This unique marker triggers the one-time W02 auth runtime deployment.

Post-deployment sync trigger: redeploy the already-authorized W02 source currently on main so AUTH-010 can re-verify the stale-token boundary in production.
