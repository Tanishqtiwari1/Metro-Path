// Anonymous per-browser id used to keep favourites and history apart (no accounts).
const KEY = 'metromind.clientId'
let memory: string | null = null

function generate(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'c-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function getClientId(): string {
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = generate()
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    memory ??= generate()
    return memory
  }
}

export function resetClientId(): string {
  const id = generate()
  try {
    localStorage.setItem(KEY, id)
  } catch {
    memory = id
  }
  return id
}
