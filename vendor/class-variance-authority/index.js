const clsx = require('clsx')

function cva(base = '', options = {}) {
  const { variants = {}, defaultVariants = {}, compoundVariants = [] } = options
  return (props = {}) => {
    const classes = [base]

    for (const variantKey of Object.keys(variants)) {
      const variantValue = props[variantKey] ?? defaultVariants[variantKey]
      const variantClasses = variants[variantKey]?.[variantValue]
      if (variantClasses) classes.push(variantClasses)
    }

    for (const compound of compoundVariants) {
      const { class: compoundClass, ...conditions } = compound
      const matches = Object.entries(conditions).every(([key, value]) => {
        const current = props[key] ?? defaultVariants[key]
        return Array.isArray(value) ? value.includes(current) : current === value
      })
      if (matches && compoundClass) classes.push(compoundClass)
    }

    if (props.class) classes.push(props.class)
    if (props.className) classes.push(props.className)

    return clsx(...classes)
  }
}

module.exports = { cva, default: cva }
