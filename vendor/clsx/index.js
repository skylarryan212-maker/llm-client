function toVal(mix) {
  if (!mix) return ''
  if (typeof mix === 'string' || typeof mix === 'number') return String(mix)
  if (Array.isArray(mix)) return mix.map(toVal).filter(Boolean).join(' ')
  if (typeof mix === 'object') return Object.entries(mix).filter(([, v]) => Boolean(v)).map(([k]) => k).join(' ')
  return ''
}

function clsx(...args) {
  return args.map(toVal).filter(Boolean).join(' ')
}

module.exports = clsx
module.exports.clsx = clsx
module.exports.default = clsx
