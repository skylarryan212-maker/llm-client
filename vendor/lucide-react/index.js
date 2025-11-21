const React = require('react')

function createIcon(name) {
  const Icon = React.forwardRef(function Icon(props, ref) {
    const { children, ...rest } = props || {}
    return React.createElement(
      'svg',
      { ref, role: 'img', width: '1em', height: '1em', viewBox: '0 0 24 24', ...rest, 'data-lucide-icon': name },
      children || React.createElement('title', null, name)
    )
  })
  Icon.displayName = name
  return Icon
}

const iconNames = [
  'Copy',
  'ExternalLink',
  'Check',
  'ArrowLeft',
  'ArrowRight',
  'CheckIcon',
  'ChevronDownIcon',
  'ChevronUpIcon',
  'ChevronRightIcon',
  'CircleIcon',
  'Archive',
  'Menu',
  'Share2',
  'Plus',
  'Mic',
  'ArrowUp',
  'MoreHorizontal',
  'Edit3',
  'Trash2',
  'Sparkles',
  'ChevronDown',
  'ChevronRight',
  'FolderPlus',
  'X',
  'Paperclip',
  'Search',
  'Image',
  'Network',
  'BookOpen',
  'Settings',
  'Bell',
  'User',
  'Grid3x3',
  'Calendar',
  'ShoppingCart',
  'Database',
  'Shield',
  'Users2',
  'UserCircle',
  'ChevronUp',
  'Crown',
  'Code2',
  'Clock',
  'Share',
  'FolderInput'
]

const exportsObj = { createIcon }
iconNames.forEach((name) => {
  exportsObj[name] = createIcon(name)
})

module.exports = exportsObj
