import {defineConfig,mergeConfig} from 'vitest/config'
import base from './vitest.coverage.config.ts'

// Use the same application denominator; write these reports separately.
export default mergeConfig(base,defineConfig({test:{coverage:{
 reportsDirectory:'coverage-scripts-expanded',
}}}))
