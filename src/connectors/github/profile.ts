import type { ProfileFact } from '../../types/project';
import { isPlaceholderHandle } from '../../lib/fixtures';

type GithubUser = {
  public_repos: number;
  followers: number;
  html_url: string;
};

/** Fetch the GitHub user profile (one cheap REST call) — surfaces public
 *  repo count and follower count as a ProfileFact. Achievements aren't on the
 *  REST API (only GraphQL), so we skip them. Returns null when the handle
 *  is unset, the API errors, or the user has zero public repos. */
export async function fetchGithubProfile(
  handle: string,
  token: string | undefined,
): Promise<ProfileFact | null> {
  if (!handle || isPlaceholderHandle(handle)) return null;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'rx-dev-dashboard',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(handle)}`,
      { headers },
    );
    if (!res.ok) return null;
    const u = (await res.json()) as GithubUser;
    if (typeof u.public_repos !== 'number' || !u.html_url) return null;

    return {
      source: 'github',
      url: u.html_url,
      label: 'GitHub',
      headline: { value: u.public_repos, label: 'public repos' },
      details: u.followers > 0 ? [{ label: 'followers', value: u.followers }] : [],
    };
  } catch {
    return null;
  }
}
