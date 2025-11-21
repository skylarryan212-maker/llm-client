const React = require('react')

const DropdownContext = React.createContext({
  open: false,
  toggle: () => {},
  close: () => {},
})

const create = (tag = 'div') =>
  React.forwardRef(({ asChild, children, ...props } = {}, ref) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, { ...props, ref })
    }
    return React.createElement(tag, { ...props, ref }, children)
  })

const Root = ({ children, defaultOpen = false }) => {
  const [open, setOpen] = React.useState(defaultOpen)
  const value = React.useMemo(
    () => ({ open, toggle: () => setOpen((v) => !v), close: () => setOpen(false) }),
    [open]
  )
  return React.createElement(DropdownContext.Provider, { value }, children)
}

const Portal = ({ children }) => React.createElement(React.Fragment, null, children)

const Trigger = create('button')

const TriggerWithContext = React.forwardRef(({ asChild, children, ...props }, ref) => {
  const ctx = React.useContext(DropdownContext)
  const Comp = Trigger
  return React.createElement(
    Comp,
    {
      ...props,
      ref,
      'data-state': ctx.open ? 'open' : 'closed',
      onClick: (e) => {
        ctx.toggle()
        if (props.onClick) props.onClick(e)
      },
    },
    children
  )
})

const Content = React.forwardRef(({ children, ...props }, ref) => {
  const ctx = React.useContext(DropdownContext)
  if (!ctx.open) return null
  return React.createElement('div', { ...props, ref, 'data-state': 'open' }, children)
})

const Group = create('div')
const Label = create('div')
const Item = React.forwardRef(({ children, onSelect, ...props }, ref) => {
  const ctx = React.useContext(DropdownContext)
  return React.createElement(
    'div',
    {
      ...props,
      ref,
      role: 'menuitem',
      onClick: (e) => {
        if (onSelect) onSelect(e)
        ctx.close()
        if (props.onClick) props.onClick(e)
      },
    },
    children
  )
})

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
  Trigger: TriggerWithContext,
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
