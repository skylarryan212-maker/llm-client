const React = require('react')

const create = (tag = 'div') =>
  React.forwardRef(({ asChild, children, ...props } = {}, ref) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, { ...props, ref })
    }
    return React.createElement(tag, { ...props, ref }, children)
  })

const Root = create('div')
const Portal = ({ children }) => React.createElement(React.Fragment, null, children)
const Trigger = create('button')
const Content = create('div')
const Group = create('div')
const Label = create('div')
const Item = create('div')
const CheckboxItem = create('div')
const RadioGroup = create('div')
const RadioItem = create('div')
const ItemIndicator = create('span')
const Separator = create('div')
const Sub = create('div')
const SubTrigger = create('button')
const SubContent = create('div')

module.exports = {
  Root,
  Portal,
  Trigger,
  Content,
  Group,
  Label,
  Item,
  CheckboxItem,
  RadioGroup,
  RadioItem,
  ItemIndicator,
  Separator,
  Sub,
  SubTrigger,
  SubContent,
  default: Root,
}
