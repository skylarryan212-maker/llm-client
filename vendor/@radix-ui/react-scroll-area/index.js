const React = require('react')

const Root = React.forwardRef((props, ref) => React.createElement('div', { ...props, ref }))
const Viewport = React.forwardRef((props, ref) => React.createElement('div', { ...props, ref }))
const ScrollAreaScrollbar = React.forwardRef((props, ref) => React.createElement('div', { ...props, ref }))
const ScrollAreaThumb = React.forwardRef((props, ref) => React.createElement('div', { ...props, ref }))
const Corner = React.forwardRef((props, ref) => React.createElement('div', { ...props, ref }))

module.exports = {
  Root,
  Viewport,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  Corner,
  default: Root,
}
