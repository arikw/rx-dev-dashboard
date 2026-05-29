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
