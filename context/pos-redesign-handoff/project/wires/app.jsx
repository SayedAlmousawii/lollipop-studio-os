// Root — composes the DesignCanvas with the chosen direction + supporting states.

function App() {
  return (
    <DesignCanvas>

      <DCSection id="main" title="Studio OS — Sales workspace wireframe" subtitle="Composition tab · adjustment mode on a finalized order">
        <DCArtboard id="dir-a" label="Sales workspace · Composition (chosen direction)" width={1440} height={1000}><DirA /></DCArtboard>
      </DCSection>

      <DCSection id="states" title="Supporting states" subtitle="Tablet portrait + dense table mode">
        <DCArtboard id="tablet" label="iPad portrait · compressed" width={820} height={1180}><TabletA /></DCArtboard>
        <DCArtboard id="dense"  label="Very large order · dense table mode" width={1280} height={820}><DenseState /></DCArtboard>
      </DCSection>

    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
