import base from './eslint.config.js'

// Diagnostic findings require triage; no automatic production-code rewriting.
export default [
  ...base,
  { ignores: ['coverage/**', 'audit-results/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'server/**/*.ts'],
    rules: {
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 5],
      'max-lines-per-function': ['warn', { max: 100, skipBlankLines: true, skipComments: true }],
      'max-nested-callbacks': ['warn', 3],
      'no-warning-comments': ['warn', { terms: ['todo', 'fixme', 'xxx'], location: 'anywhere' }],
    },
  },
]
