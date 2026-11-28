import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

const w07UnitTestMode = process.env.LUCKREAD_VITEST_SCOPE === 'w07-unit'
const w07CommerceE2ETestMode = process.env.LUCKREAD_VITEST_SCOPE === 'w07-commerce-e2e'

export default defineConfig({
  // W07 worker tests are dependency-light Node tests. W01 retains its normal
  // React/jsdom integration-test environment and setup.
  plugins: w07UnitTestMode ? [] : [tsconfigPaths(), react()],
  test: {
    environment: w07UnitTestMode ? 'node' : 'jsdom',
    ...(w07UnitTestMode ? {} : { setupFiles: ['./vitest.setup.ts'] }),
    // The W01 default is intentionally integration-only. The W07 CI job uses
    // --root ../.. plus the explicit scope so its worker unit tests are not
    // silently filtered out by this W01-only include pattern.
    include: w07UnitTestMode
      ? ['workers/W07-subscription-commerce/src/**/*.test.ts']
      : w07CommerceE2ETestMode
        ? ['tests/int/commerce-order-e2e-security.int.spec.mjs']
        : ['tests/int/**/*.int.spec.ts'],
  },
})
