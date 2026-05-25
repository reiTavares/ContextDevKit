/**
 * Stack presets — opt-in config fragments that tune VibeDevKit to a stack.
 *
 * Applied by `install.mjs --preset <name>` (and offered by `/setupvibedevkit`).
 * Each preset UNIONS its array fields onto the config (stack paths ADD to the
 * generic defaults, they don't replace them) and sets stack-specific high-risk /
 * QA-critical paths. Zero-dependency.
 */
export const PRESETS = {
  next: {
    ledger: { important: ['app/', 'components/', 'lib/', 'pages/', 'src/'] },
    l5: { highRiskPaths: ['app/api/', 'middleware.ts'] },
    qa: { criticalPaths: ['app/', 'components/'] },
  },
  go: {
    ledger: { important: ['cmd/', 'internal/', 'pkg/'] },
    l5: { highRiskPaths: ['internal/auth/'] },
    qa: { criticalPaths: ['internal/', 'pkg/'] },
  },
  python: {
    ledger: { important: ['src/', 'app/', 'tests/'] },
    l5: { highRiskPaths: ['*/auth/', '*/security/'] },
    qa: { criticalPaths: ['src/'] },
  },
};

export function listPresets() {
  return Object.keys(PRESETS);
}

const uniq = (arr) => [...new Set(arr)];

/**
 * Returns a NEW config with the named preset merged in (array fields unioned).
 * Unknown name → the config is returned unchanged.
 */
export function applyPreset(config, name) {
  const preset = PRESETS[name];
  if (!preset) return config;
  const cfg = { ...config };
  cfg.ledger = { ...(cfg.ledger || {}), important: uniq([...(cfg.ledger?.important || []), ...(preset.ledger.important || [])]) };
  cfg.l5 = { ...(cfg.l5 || {}), highRiskPaths: uniq([...(cfg.l5?.highRiskPaths || []), ...(preset.l5.highRiskPaths || [])]) };
  cfg.qa = { ...(cfg.qa || {}), criticalPaths: uniq([...(cfg.qa?.criticalPaths || []), ...(preset.qa.criticalPaths || [])]) };
  return cfg;
}
