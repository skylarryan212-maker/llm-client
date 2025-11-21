const React = require('react')

const SelectContext = React.createContext({
  open: false,
  value: undefined,
  setValue: () => {},
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

const Root = ({ children, value: controlledValue, defaultValue, onValueChange, open: controlledOpen }) => {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue)
  const [openInternal, setOpenInternal] = React.useState(Boolean(controlledOpen))

  const isControlled = typeof controlledValue !== 'undefined'
  const value = isControlled ? controlledValue : uncontrolledValue
  const setValue = (next) => {
    if (!isControlled) setUncontrolledValue(next)
    if (onValueChange) onValueChange(next)
  }

  const open = typeof controlledOpen !== 'undefined' ? controlledOpen : openInternal
  const toggle = () => setOpenInternal((v) => !v)
  const close = () => setOpenInternal(false)

  const ctx = React.useMemo(() => ({ open, value, setValue, toggle, close }), [open, value])

  return React.createElement(SelectContext.Provider, { value: ctx }, children)
}

const Group = create('div')

const Value = React.forwardRef(({ placeholder, children, ...props }, ref) => {
  const ctx = React.useContext(SelectContext)
  return React.createElement(
    'span',
    { ...props, ref, 'data-state': ctx.open ? 'open' : 'closed' },
    children || ctx.value || placeholder || null
  )
})

const TriggerBase = create('button')
const Trigger = React.forwardRef(({ children, ...props }, ref) => {
  const ctx = React.useContext(SelectContext)
  return React.createElement(
    TriggerBase,
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

const Icon = create('span')
const Portal = ({ children }) => React.createElement(React.Fragment, null, children)
const Content = React.forwardRef(({ children, ...props }, ref) => {
  const ctx = React.useContext(SelectContext)
  if (!ctx.open) return null
  return React.createElement('div', { ...props, ref, 'data-state': 'open' }, children)
})
const Viewport = create('div')
const Label = create('div')
const Item = React.forwardRef(({ children, value, onSelect, ...props }, ref) => {
  const ctx = React.useContext(SelectContext)
  const handleSelect = (e) => {
    if (onSelect) onSelect(e)
    ctx.setValue(value)
    ctx.close()
    if (props.onClick) props.onClick(e)
  }
  return React.createElement(
    'div',
    { ...props, ref, role: 'option', 'data-state': ctx.value === value ? 'checked' : 'unchecked', onClick: handleSelect },
    children
  )
})
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
