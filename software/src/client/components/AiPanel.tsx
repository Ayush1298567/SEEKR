import { Bot, CheckCircle2, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import type { AiProposal } from "../../shared/types";
import type { AiStatus } from "../api";

export function AiPanel({
  proposals,
  aiStatus,
  onPropose,
  onApprove
}: {
  proposals: AiProposal[];
  aiStatus?: AiStatus;
  onPropose: () => void;
  onApprove: (id: string) => void;
}) {
  const latest = proposals[0];

  return (
    <section className="data-panel ai-panel">
      <div className="panel-title compact">
        <h2>AI Copilot</h2>
        <span className="ai-provider" data-ok={aiStatus?.ok ?? false}>
          {aiStatus ? `${aiStatus.provider}:${aiStatus.model}` : "checking"}
        </span>
        <button onClick={onPropose} title="Generate proposal">
          <Sparkles size={15} /> Propose
        </button>
      </div>

      {latest ? (
        <article className="proposal" data-status={latest.status}>
          <div className="proposal-head">
            <Bot size={18} />
            <div>
              <strong>{latest.title}</strong>
              <span>{latest.status} / {latest.provider}:{latest.model}</span>
            </div>
          </div>
          <p>{latest.rationale}</p>
          <div className="proposal-diff">
            {latest.diff.length ? (
              latest.diff.map((diff) => (
                <span key={diff.field}>{diff.field}: {String(diff.currentValue)} {"->"} {String(diff.proposedValue)}</span>
              ))
            ) : (
              <>
                <span>{latest.plan.kind}</span>
                <span>{latest.plan.droneId ?? "no drone"}</span>
                <span>{latest.plan.zoneId ?? (latest.plan.coords ? "targeted" : "no target")}</span>
              </>
            )}
          </div>
          <div className="validator-box" data-ok={latest.validator.ok}>
            {latest.validator.ok ? <ShieldCheck size={16} /> : <TriangleAlert size={16} />}
            <span>{latest.validator.ok ? "Validated" : latest.validator.blockers.join("; ")}</span>
          </div>
          {latest.validator.warnings.length > 0 && (
            <ul className="warning-list">
              {latest.validator.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <div className="tool-trace">
            {latest.toolCalls.map((call) => (
              <span key={`${call.tool}-${call.createdAt}`}>{call.tool}: {call.result}</span>
            ))}
          </div>
          <button disabled={!latest.validator.ok || latest.status === "executed"} onClick={() => onApprove(latest.id)} title="Approve proposal">
            <CheckCircle2 size={15} /> Approve
          </button>
        </article>
      ) : (
        <div className="empty-panel">
          <Bot size={22} />
          <span>No active proposal</span>
        </div>
      )}
    </section>
  );
}
