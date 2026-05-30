import type { ConnectorResult } from '../types/project';
import type { ProjectsConfig } from '../types/config';

export type ConnectorOptions = {
  /** Read from tests/fixtures/<source>.json instead of hitting the live API. */
  fixtureMode?: boolean;
};

export type Connector = (
  config: ProjectsConfig,
  options?: ConnectorOptions,
) => Promise<ConnectorResult[]>;

/**
 * Tells the builder how to derive an `(origin platform, id)` from a URL. A
 * connector exports one or more of these alongside its `fetch*` function so
 * the builder can recognise a project's identity from arbitrary URLs (e.g. a
 * GitHub repo's `homepage` pointing at a Chrome Web Store listing). When the
 * builder groups results into projects, two results merge if a URL on one
 * extracts to the other's origin.
 */
export type UrlIdExtractor = {
  hostnames: string[];
  extract: (url: URL) => { platform: string; id: string } | null;
};
