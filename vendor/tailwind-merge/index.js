const clsx = require('clsx')

function twMerge(...inputs) {
  return clsx(...inputs)
}

module.exports = { twMerge, default: twMerge }
