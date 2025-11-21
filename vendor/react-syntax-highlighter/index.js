const React = require('react')

function Prism({ style, customStyle, children, language, ...rest }) {
  return React.createElement(
    'pre',
    { ...rest, style: { ...style, ...customStyle }, 'data-language': language },
    children,
  )
}

module.exports = { Prism, default: Prism }
