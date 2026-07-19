---
name: Admin panel fetch pattern
description: How to call the API correctly from admin panel pages — blank page bug root cause
---

Pages in artifacts/admin-panel/src/pages/ MUST call the API using raw fetch(), NOT an apiClient object.

**The rule:**
```ts
function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}
async function apiFetch(method: string, path: string, body?: unknown): Promise<any> {
  const opts: RequestInit = { method, headers: { ...authHeader(), "Content-Type": "application/json" } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`/api${path}`, opts)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
```

**Why:** The generated api-client exports hooks (useGetBotLogs etc.) and customFetch, but does NOT export an `apiClient` object with `.get/.put/.post` methods. Calling non-existent methods causes a silent JS crash at runtime → blank white page with no visible error.

**How to apply:** Every new admin panel page must use the raw fetch pattern above. For read queries with auto-refresh, the generated hooks (useGetBotXxx from @workspace/api-client-react) are also valid.
