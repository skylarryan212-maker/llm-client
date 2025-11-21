const React = require('react')

const Root = React.forwardRef(function Label(props, ref) {
  return React.createElement('label', { ...props, ref })
})

module.exports = { Root, default: Root }
