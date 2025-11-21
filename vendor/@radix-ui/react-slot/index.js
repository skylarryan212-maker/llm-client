const React = require('react')

const Slot = React.forwardRef(function Slot({ children, ...props }, ref) {
  if (React.isValidElement(children)) {
    return React.cloneElement(children, { ...props, ref })
  }
  return React.createElement('span', { ...props, ref }, children)
})

module.exports = { Slot, Root: Slot, default: Slot }
