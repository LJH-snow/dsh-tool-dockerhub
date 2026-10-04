import { describe, expect, it, vi } from 'vitest'
import { DockerHubClient, DockerHubError } from '../src/client.ts'

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function client(fetchImpl: ReturnType<typeof vi.fn>) {
  return new DockerHubClient({ username: 'octocat', personalAccessToken: 'dckr_pat_secret', fetchImpl })
}

describe('DockerHubClient', () => {
  it('exchanges a PAT for a bearer token without exposing it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ token: 'bearer-secret-token' }))
    const result = await client(fetchImpl).authTest()
    expect(result).toEqual({ username: 'octocat', namespace: 'octocat' })
    expect(JSON.stringify(result)).not.toContain('bearer-secret-token')
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://hub.docker.com/v2/auth/token')
    expect(init.method).toBe('POST')
    expect(String(init.body)).toContain('octocat')
    expect(String(init.body)).toContain('dckr_pat_secret')
  })

  it('lists repositories with pagination and bearer authentication', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: 'bearer-token' }))
      .mockResolvedValueOnce(jsonResponse({ count: 1, next: 'https://hub.docker.com/v2/next', previous: '', results: [{ namespace: 'octocat', name: 'demo', description: 'Demo image', pull_count: 12, star_count: 3, is_private: false, last_updated: '2026-01-01T00:00:00Z' }] }))
    const result = await client(fetchImpl).listRepositories({ page: 2, pageSize: 10, query: 'dem', order: '-last_updated' })
    expect(result).toMatchObject({ count: 1, next: 'https://hub.docker.com/v2/next' })
    expect(result.items[0]).toMatchObject({ namespace: 'octocat', name: 'demo', pullCount: 12, starCount: 3, isPrivate: false })
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit]
    expect(url).toContain('/v2/repositories/octocat/')
    expect(url).toContain('page=2')
    expect(url).toContain('page_size=10')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer bearer-token')
  })

  it('maps repository details and tag image metadata', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: 'bearer-token' }))
      .mockResolvedValueOnce(jsonResponse({ name: 'demo', namespace: 'octocat', description: 'Demo', pull_count: 20, star_count: 4, is_private: true, last_updated: '2026-01-02' }))
      .mockResolvedValueOnce(jsonResponse({ name: 'latest', last_updated: '2026-01-02', full_size: 1234, images: [{ digest: 'sha256:abc', architecture: 'arm64', os: 'linux' }] }))
    const pd = new DockerHubClient({ username: 'octocat', personalAccessToken: 'token', fetchImpl })
    const repository = await pd.getRepository('octocat', 'demo')
    const tag = await pd.getTag('octocat', 'demo', 'latest')
    expect(repository).toMatchObject({ name: 'demo', pullCount: 20, isPrivate: true })
    expect(tag).toMatchObject({ name: 'latest', digest: 'sha256:abc', fullSize: 1234, architecture: 'arm64', os: 'linux' })
  })

  it('searches public repositories without credentials', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ count: 1, next: '', previous: '', results: [{ name: 'nginx', namespace: 'library', description: 'Official nginx', pull_count: 100, star_count: 50, is_official: true, is_automated: false }] }))
    const result = await new DockerHubClient({ fetchImpl }).searchRepositories({ query: 'nginx' })
    expect(result.items[0]).toMatchObject({ name: 'nginx', namespace: 'library', isOfficial: true, isAutomated: false })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('reads rate-limit headers and authentication status', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: 'bearer-token' }))
      .mockResolvedValueOnce(jsonResponse({}, 200, { 'ratelimit-limit': '200', 'ratelimit-remaining': '199', 'ratelimit-reset': '1700000000' }))
    const result = await client(fetchImpl).getRateLimits()
    expect(result).toEqual({ limit: '200', remaining: '199', reset: '1700000000', authenticated: true })
  })

  it('rejects missing credentials for auth test and maps HTTP errors', async () => {
    await expect(new DockerHubClient({}).authTest()).rejects.toThrow(DockerHubError)
    const fetchImpl = vi.fn(async () => jsonResponse({ detail: 'Not found' }, 404))
    await expect(new DockerHubClient({ fetchImpl }).searchRepositories({ query: 'nope' })).rejects.toThrow('Not found')
  })
})
