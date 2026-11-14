/** Test-only fixture writer; never deletes projects or retries a concurrent conflict. */
export interface FixtureResponse {
  ok(): boolean
  status(): number
  json(): Promise<unknown>
}
export interface FixtureRequest {
  get(url: string): Promise<FixtureResponse>
  put(url: string, options: { data: unknown }): Promise<FixtureResponse>
}
export async function seedProject(request: FixtureRequest, project: { id: string; [key: string]: unknown }): Promise<void> {
  if (project.id !== 'editorial-shell-fixture') throw new Error('Fixture ID is not allowlisted')
  const url = `/api/projects/${encodeURIComponent(project.id)}`
  const existing = await request.get(url)
  let revision: string | undefined
  if (existing.status() !== 404) {
    if (!existing.ok()) throw new Error(`Fixture GET failed: ${existing.status()}`)
    const body = await existing.json()
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        !('id' in body) || body.id !== project.id || !('revision' in body) ||
        typeof body.revision !== 'string' || !body.revision) throw new Error('Invalid existing fixture')
    revision = body.revision
  }
  const response = await request.put(url, { data: { ...project, revision } })
  if (!response.ok()) throw new Error(`Fixture PUT failed: ${response.status()}`)
}
