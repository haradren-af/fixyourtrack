const reservedWindowsNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export function sanitizeFilename(name, fallback = 'fixed-track') {
  const cleaned = Array.from(String(name ?? ''), (char) => (
    /[<>:"/\\|?*]/.test(char) || char.charCodeAt(0) < 32 ? '-' : char
  ))
    .join('')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120)

  const safeName = cleaned || fallback
  return reservedWindowsNames.test(safeName) ? `track-${safeName}` : safeName
}
