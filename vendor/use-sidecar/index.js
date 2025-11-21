const React = require('react');

function resolveImporter(importer, setComponent) {
  Promise.resolve()
    .then(importer)
    .then((mod) => setComponent(() => mod.default || mod))
    .catch((error) => {
      // Surface the error on next render
      setComponent(() => {
        throw error;
      });
    });
}

function useSidecar(importer, component) {
  const [Comp, setComp] = React.useState(component || null);

  React.useEffect(() => {
    if (!Comp) {
      resolveImporter(importer, setComp);
    }
  }, [Comp, importer]);

  return Comp || (() => null);
}

function sidecar(importer) {
  const Lazy = React.lazy(importer);
  return React.forwardRef((props, ref) =>
    React.createElement(
      React.Suspense,
      { fallback: null },
      React.createElement(Lazy, Object.assign({}, props, { ref }))
    )
  );
}

function exportSidecar(importer, component) {
  const Exported = component || sidecar(importer);
  Exported.__sidecar__ = importer;
  return Exported;
}

function renderCar(Comp, props) {
  return Comp ? React.createElement(Comp, props) : null;
}

module.exports = {
  useSidecar,
  sidecar,
  exportSidecar,
  renderCar,
  default: useSidecar,
};
