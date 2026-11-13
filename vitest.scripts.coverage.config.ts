import {defineConfig,mergeConfig} from 'vitest/config'
import base from './vitest.coverage.config'

// Extend the application denominator; do not replace it with only these tools.
export default mergeConfig(base,defineConfig({test:{coverage:{
 include:['src/**/*.{ts,tsx}','server/**/*.ts','scripts/**/*.ts','templates/**/*.mjs'],
 reportsDirectory:'coverage-scripts-expanded',
}}}))
