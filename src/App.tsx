import React, { useState } from "react";
import "./App.css";
import { Button, Input } from "antd";
import { MainView } from "./MainView";

function App() {
  const [sipURI, setSipURI] = useState("");
  const [isSubmitted, setSubmitted] = useState(false);

  if (isSubmitted) {
    return <MainView sipURI={sipURI} />;
  }
  return (
    <div className="App">
      <Input
        title="Enter SIP URI"
        value={sipURI}
        onChange={e => setSipURI(e.target.value)}
      />
      <Button
        color="red"
        onClick={e => {
          setSubmitted(true)
        }}
        >Submit</Button>
    </div>
  );
}

export default App;
