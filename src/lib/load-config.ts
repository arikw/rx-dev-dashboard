import baseConfig from '../../projects.config';
import type { ProjectsConfig } from '../types/config';

// Vite glob picks up projects.config.local.ts if it exists (gitignored).
// When absent, the glob returns {} and we use the base config as-is.
const localModules = import.meta.glob<{ default: ProjectsConfig }>(
  '../../projects.config.local.*',
  { eager: true }
);
const localConfig: ProjectsConfig | undefined = Object.values(localModules)[0]?.default;

function mergeConfig(base: ProjectsConfig, override?: ProjectsConfig): ProjectsConfig {
  if (!override) return base;
  return {
    ...base,
    ...override,
    deployment: { ...base.deployment, ...override.deployment },
    user: { ...base.user, ...override.user },
    sources: {
      github: { ...base.sources.github, ...override.sources?.github },
      npm: { ...base.sources.npm, ...override.sources?.npm },
      docker: { ...base.sources.docker, ...override.sources?.docker },
      chrome: { ...base.sources.chrome, ...override.sources?.chrome },
      gnome: { ...base.sources.gnome, ...override.sources?.gnome },
    },
    ui: {
      ...base.ui,
      ...override.ui,
      hero: { ...base.ui.hero, ...override.ui?.hero },
    },
  };
}

const merged = mergeConfig(baseConfig, localConfig);

// Default empty npm/docker handles to the github handle.
if (!merged.user.npm) merged.user.npm = merged.user.github;
if (!merged.user.docker) merged.user.docker = merged.user.github;

export default merged;
