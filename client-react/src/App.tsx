import { useState } from "react";
import { useAppState } from "./useAppState";
import { CreateCard } from "./components/CreateCard";
import { EnrollToken } from "./components/EnrollToken";
import { DeviceBinding } from "./components/DeviceBinding";
import { CreateIntent } from "./components/CreateIntent";
import { GetCryptogram } from "./components/GetCryptogram";
import { Log } from "./components/Log";

export default function App() {
  const { state, setState, logs, log, setLoading, completeStep, reset, sessionRef } = useAppState();
  const [consumerEmail, setConsumerEmail] = useState("user@example.com");

  function handleReset() {
    reset();
    setConsumerEmail("user@example.com");
  }

  return (
    <div className="max-w-[860px] mx-auto p-6 bg-gray-50 min-h-screen text-gray-900">
      <div className="flex justify-between items-baseline">
        <h1 className="text-2xl font-bold mb-1">Agentic Tokens API — Sample App</h1>
        <button
          className="bg-gray-500 text-white text-xs px-3.5 py-1.5 rounded cursor-pointer hover:bg-gray-600"
          onClick={handleReset}
        >
          Start Over
        </button>
      </div>
      <p className="text-gray-500 text-sm mb-6">Step-by-step integration reference for the VGS Agentic Tokens API</p>

      <CreateCard state={state} setState={setState} log={log} setLoading={setLoading} completeStep={completeStep} />
      <EnrollToken state={state} setState={setState} log={log} setLoading={setLoading} completeStep={completeStep} consumerEmail={consumerEmail} setConsumerEmail={setConsumerEmail} />
      <DeviceBinding state={state} setState={setState} log={log} setLoading={setLoading} completeStep={completeStep} consumerEmail={consumerEmail} sessionRef={sessionRef} />
      <CreateIntent state={state} setState={setState} log={log} setLoading={setLoading} completeStep={completeStep} />
      <GetCryptogram state={state} setState={setState} log={log} setLoading={setLoading} completeStep={completeStep} />
      <Log entries={logs} />
    </div>
  );
}
