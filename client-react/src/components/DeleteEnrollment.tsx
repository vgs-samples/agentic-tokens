import { useState } from "react";
import { deleteAmexEnrollment } from "../amex";
import { useAppState, useStepStatus } from "../useAppState";
import { Step } from "./Step";
import { Field, Button } from "./ui";

export function DeleteEnrollment() {
  const { state, setState, log, setLoading, completeStep } = useAppState();
  const { loading, num } = useStepStatus("deleteEnrollment");
  const [enrollmentId, setEnrollmentId] = useState(state.tokenId ?? "");
  const [response, setResponse] = useState<unknown>(null);
  const [responseMeta, setResponseMeta] = useState<string | null>(null);
  const [deletedId, setDeletedId] = useState<string | null>(null);

  async function handleDelete() {
    const id = enrollmentId.trim();
    if (!id || loading) return;
    setLoading("deleteEnrollment", true);
    setDeletedId(null);
    setState((s) => {
      const completedSteps = new Set(s.completedSteps);
      completedSteps.delete("deleteEnrollment");
      return { ...s, completedSteps };
    });
    log(`Step ${num}: Deleting Amex enrollment ${id}...`);
    try {
      const result = await deleteAmexEnrollment(id);
      setResponse(result.body);
      setResponseMeta(`API response · HTTP ${result.status}`);
      if (result.ok && result.body?.data?.id === id && result.body.data.attributes?.status === "deleted") {
        setDeletedId(id);
        log(`Step ${num}: Enrollment deleted — ${id}`);
        completeStep("deleteEnrollment");
      } else {
        log(`Step ${num}: Deletion not confirmed — HTTP ${result.status}`);
      }
    } catch (err) {
      const detail = (err as Error).message;
      setResponse({ error: "client_error", detail });
      setResponseMeta("Client error before API response");
      log(`Step ${num}: Error — ${detail}`);
    } finally {
      setLoading("deleteEnrollment", false);
    }
  }

  if (!state.completedSteps.has("cryptogram")) return null;

  return (
    <Step stepKey="deleteEnrollment" title="Delete Enrollment (Amex)" response={response} responseMeta={responseMeta}>
      <Field label="Enrollment ID">
        <input className="input" value={enrollmentId} disabled={loading} onChange={(e) => setEnrollmentId(e.target.value)} />
      </Field>
      <p className="text-xs text-gray-500">Prefilled with the latest enrollment from this flow. Paste another enrollment ID to delete it.</p>
      <Button onClick={handleDelete} disabled={loading || !enrollmentId.trim() || deletedId === enrollmentId.trim()}>
        Delete Enrollment
      </Button>
      {deletedId && <p className="text-sm text-green-700">Enrollment {deletedId} deleted.</p>}
    </Step>
  );
}
