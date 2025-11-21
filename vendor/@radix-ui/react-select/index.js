const React = require('react')

const create = (tag = 'div') =>
  React.forwardRef(({ asChild, children, ...props } = {}, ref) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, { ...props, ref })
    }
    return React.createElement(tag, { ...props, ref }, children)
  })

const Root = create('div')
const Group = create('div')
const Value = create('span')
const Trigger = create('button')
const Icon = create('span')
const Portal = ({ children }) => React.createElement(React.Fragment, null, children)
const Content = create('div')
const Viewport = create('div')
const Label = create('div')
const Item = create('div')
const ItemIndicator = create('span')
const ItemText = create('span')
const Separator = create('div')
const ScrollUpButton = create('button')
const ScrollDownButton = create('button')

module.exports = {
  Root,
  Group,
  Value,
  Trigger,
  Icon,
  Portal,
  Content,
  Viewport,
  Label,
  Item,
  ItemIndicator,
  ItemText,
  Separator,
  ScrollUpButton,
  ScrollDownButton,
  default: Root,
}
