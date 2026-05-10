import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  Bot,
  Check,
  CirclePause,
  CirclePlay,
  ClipboardList,
  Copy,
  Download,
  FileText,
  History,
  Map,
  MessageSquareText,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ScrollText,
  ShieldAlert,
  Siren,
  StepBack,
  StepForward,
  WifiOff
} from "lucide-react";
import type { AiProposal, Detection, EvidenceAsset, MissionState, OperatorInputRequest, PassivePlan, ReadinessReport, SessionManifest, SourceHealthReport, SpatialAsset, TrustMode } from "../shared/types";
import { commands, type AiStatus, type ReplaySession, type ReplaySummary, type ScenarioSummary, type SpatialPreview, stateSocket } from "./api";
import { AlertFeed } from "./components/AlertFeed";
import { AiPanel } from "./components/AiPanel";
import { DetectionPanel } from "./components/DetectionPanel";
import { DronePanel } from "./components/DronePanel";
import { MapView, type MapLayers } from "./components/MapView";
import { SpatialPanel } from "./components/SpatialPanel";
import { ZonePanel } from "./components/ZonePanel";

const SpatialViewer = lazy(() => import("./components/SpatialViewer").then((module) => ({ default: module.SpatialViewer })));

export function App() {
  const [liveState, setLiveState] = useState<MissionState | null>(null);
  const [replaySession, setReplaySession] = useState<ReplaySession | null>(null);
  const [viewMode, setViewMode] = useState<"live" | "replay">("live");
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [sessionManifest, setSessionManifest] = useState<SessionManifest | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | undefined>();
  const [socketStatus, setSocketStatus] = useState<"connected" | "disconnected">("disconnected");
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [replaySummaries, setReplaySummaries] = useState<ReplaySummary[]>([]);
  const [selectedReplayId, setSelectedReplayId] = useState<string | null>(null);
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);
  const [reportText, setReportText] = useState<string | null>(null);
  const [incidentLogText, setIncidentLogText] = useState<string | null>(null);
  const [passivePlan, setPassivePlan] = useState<PassivePlan | null>(null);
  const [artifactStatus, setArtifactStatus] = useState<{ label: string; state: "loading" | "error"; message?: string } | null>(null);
  const [operatorInputRequest, setOperatorInputRequest] = useState<OperatorInputRequest | null>(null);
  const [readinessReport, setReadinessReport] = useState<ReadinessReport | null>(null);
  const [sourceHealth, setSourceHealth] = useState<SourceHealthReport | null>(null);
  const [sourceHealthStatus, setSourceHealthStatus] = useState<SourceHealthReport | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<{ detection: Detection; asset?: EvidenceAsset } | null>(null);
  const [selectedSpatial, setSelectedSpatial] = useState<{ asset: SpatialAsset; preview: SpatialPreview; viewerKey: number } | null>(null);
  const [noFlyDraft, setNoFlyDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [layers, setLayers] = useState<MapLayers>({
    occupancy: true,
    frontier: true,
    zones: true,
    detections: true,
    conflicts: true,
    staleSources: true,
    noFlyZones: true,
    spatial: true
  });

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    const loadState = () => {
      commands.state()
        .then((state) => {
          if (!cancelled) setLiveState(state);
        })
        .catch(() => {
          if (cancelled) return;
          setSocketStatus("disconnected");
          retryTimer = window.setTimeout(loadState, 500);
        });
    };
    loadState();
    commands.session().then(setSessionManifest).catch(() => setSessionManifest(null));
    commands.aiStatus().then(setAiStatus).catch(() => setAiStatus(undefined));
    commands.scenarios().then(setScenarios).catch(() => setScenarios([]));
    commands.sourceHealth().then(setSourceHealthStatus).catch(() => setSourceHealthStatus(null));
    refreshReplays().catch(() => undefined);
    const closeSocket = stateSocket(setLiveState, setSocketStatus);
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      closeSocket();
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPendingProposalId(null);
      setSelectedEvidence(null);
      setReportText(null);
      setIncidentLogText(null);
      setPassivePlan(null);
      setArtifactStatus(null);
      setOperatorInputRequest(null);
      setReadinessReport(null);
      setSourceHealth(null);
      setSelectedSpatial(null);
      setNoFlyDraft(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    if (viewMode !== "replay" || !replaySession?.playing) return;
    const interval = window.setInterval(() => {
      setReplaySession((session) => {
        if (!session || !session.playing) return session;
        const nextSeq = Math.min(session.totalEventCount, session.currentSeq + 1);
        commands.seekReplay(session.replayId, nextSeq).then((next) => {
          setReplaySession({ ...next, playing: nextSeq < next.totalEventCount });
        });
        return session;
      });
    }, Math.max(250, 1000 / replaySession.speed));
    return () => window.clearInterval(interval);
  }, [viewMode, replaySession?.playing, replaySession?.speed, replaySession?.replayId]);

  const state = viewMode === "replay" && replaySession ? replaySession.state : liveState;

  const orderedAlerts = useMemo(
    () => [...(state?.alerts ?? [])].sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || b.createdAt - a.createdAt),
    [state?.alerts]
  );

  async function runCommand(action: () => Promise<unknown>) {
    setBusy(true);
    setLastError(null);
    try {
      const result = await action();
      if (isMissionState(result)) {
        setLiveState(result);
        setViewMode("live");
      }
    } catch (error) {
      setLastError(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(label);
      window.setTimeout(() => setCopiedValue((current) => (current === label ? null : current)), 1200);
    } catch (error) {
      setLastError(`Copy failed: ${formatError(error)}`);
    }
  }

  async function exportMission() {
    setBusy(true);
    setLastError(null);
    try {
      const manifest = await commands.exportMission(liveState!.missionId);
      await refreshReplays(manifest.replayId);
    } catch (error) {
      setLastError(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function showReport() {
    setBusy(true);
    setLastError(null);
    setArtifactStatus({ label: "Mission report", state: "loading" });
    try {
      setReportText(await commands.missionReport(liveState!.missionId));
      setArtifactStatus(null);
    } catch (error) {
      const message = formatError(error);
      setLastError(message);
      setArtifactStatus({ label: "Mission report", state: "error", message });
    } finally {
      setBusy(false);
    }
  }

  async function showIncidentLog() {
    setBusy(true);
    setLastError(null);
    setArtifactStatus({ label: "Incident log", state: "loading" });
    try {
      setIncidentLogText(await commands.incidentLog(liveState!.missionId));
      setArtifactStatus(null);
    } catch (error) {
      const message = formatError(error);
      setLastError(message);
      setArtifactStatus({ label: "Incident log", state: "error", message });
    } finally {
      setBusy(false);
    }
  }

  async function showPassivePlan() {
    setBusy(true);
    setLastError(null);
    setArtifactStatus({ label: "Passive plan", state: "loading" });
    try {
      const result = await commands.passivePlan();
      setPassivePlan(result.plan);
      setArtifactStatus(null);
    } catch (error) {
      const message = formatError(error);
      setLastError(message);
      setArtifactStatus({ label: "Passive plan", state: "error", message });
    } finally {
      setBusy(false);
    }
  }

  async function showOperatorInputRequest() {
    setBusy(true);
    setLastError(null);
    setArtifactStatus({ label: "Operator input", state: "loading" });
    try {
      const result = await commands.operatorInputRequest();
      setOperatorInputRequest(result.request);
      setArtifactStatus(null);
    } catch (error) {
      const message = formatError(error);
      setLastError(message);
      setArtifactStatus({ label: "Operator input", state: "error", message });
    } finally {
      setBusy(false);
    }
  }

  async function showReadiness() {
    setBusy(true);
    setLastError(null);
    setArtifactStatus({ label: "Readiness", state: "loading" });
    try {
      setReadinessReport(await commands.readiness());
      setArtifactStatus(null);
    } catch (error) {
      const message = formatError(error);
      setLastError(message);
      setArtifactStatus({ label: "Readiness", state: "error", message });
    } finally {
      setBusy(false);
    }
  }

  async function showSourceHealth() {
    setBusy(true);
    setLastError(null);
    setArtifactStatus({ label: "Source health", state: "loading" });
    try {
      const report = await commands.sourceHealth();
      setSourceHealthStatus(report);
      setSourceHealth(report);
      setArtifactStatus(null);
    } catch (error) {
      const message = formatError(error);
      setLastError(message);
      setArtifactStatus({ label: "Source health", state: "error", message });
    } finally {
      setBusy(false);
    }
  }

  async function startReplay() {
    const replayId = selectedReplayId ?? replaySummaries[0]?.replayId;
    if (!replayId) return;
    setBusy(true);
    setLastError(null);
    try {
      const session = await commands.startReplay(replayId);
      setReplaySession(session);
      setViewMode("replay");
    } catch (error) {
      setLastError(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function refreshReplays(preferredReplayId?: string) {
    const replays = await commands.replays();
    setReplaySummaries(replays);
    setSelectedReplayId((current) => {
      if (preferredReplayId && replays.some((replay) => replay.replayId === preferredReplayId)) return preferredReplayId;
      if (current && replays.some((replay) => replay.replayId === current)) return current;
      return replays[0]?.replayId ?? null;
    });
    return replays;
  }

  async function seekReplay(seq: number) {
    if (!replaySession) return;
    setBusy(true);
    setLastError(null);
    try {
      const session = await commands.seekReplay(replaySession.replayId, seq);
      setReplaySession({ ...session, playing: replaySession.playing });
      setViewMode("replay");
    } catch (error) {
      setLastError(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function openSpatialAsset(asset: SpatialAsset) {
    setBusy(true);
    setLastError(null);
    try {
      const result = await commands.spatialPreview(asset.assetId);
      setSelectedSpatial({ asset, preview: result.preview, viewerKey: Date.now() });
    } catch (error) {
      setLastError(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function importSpatialFixture() {
    await runCommand(async () => {
      const result = await commands.importFixture("spatial-manifest");
      return result.state;
    });
  }

  const pendingProposal = state?.proposals.find((proposal) => proposal.id === pendingProposalId);
  const sourceWarningIds = sourceHealthStatus?.summary.staleSourceIds ?? [];
  const footerMessage = lastError
    ? lastError
    : socketStatus === "disconnected"
      ? "API disconnected; retrying live state"
      : sourceWarningIds.length
        ? `Source warning: ${sourceWarningIds.join(", ")}`
        : state?.auditTail[0]?.message ?? "Audit log ready";
  const footerTime = lastError || socketStatus === "disconnected" || sourceWarningIds.length ? Date.now() : state?.auditTail[0]?.createdAt;

  if (!state) {
    return (
      <main className="loading">
        <Radio size={28} />
        <span>Connecting to SEEKR GCS</span>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="mark">
            <Map size={19} />
          </div>
          <div>
            <h1>SEEKR GCS</h1>
            <p>
              <span>{state.missionId}{sessionManifest ? ` / v${sessionManifest.softwareVersion}` : ""}</span>
              <button className="inline-copy" onClick={() => copyValue("mission-build", `${state.missionId} ${sessionManifest?.softwareVersion ?? ""}`.trim())} title="Copy mission id and build version">
                {copiedValue === "mission-build" ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </p>
          </div>
        </div>

        <div className="status-strip" aria-label="Mission status">
          <Metric label="Phase" value={state.phase.toUpperCase()} tone={state.phase === "running" ? "ok" : "neutral"} />
          <Metric label="Coverage" value={`${state.metrics.coveragePct}%`} />
          <Metric label="Active" value={`${state.metrics.activeDrones}/${state.drones.length}`} />
          <Metric label="P1" value={String(state.metrics.p1Open)} tone={state.metrics.p1Open ? "danger" : "ok"} />
          <Metric label="Battery" value={`${state.metrics.averageBatteryPct}%`} />
          <Metric label="Map" value={`${state.metrics.mapLatencyMs}ms`} tone={state.metrics.conflictCells ? "danger" : state.metrics.staleSources ? "neutral" : "ok"} />
        </div>

        <button className="mode-pill" data-mode={viewMode} onClick={() => setViewMode("live")} title="Return to live mission view">
          {viewMode === "replay" ? `REPLAY #${replaySession?.currentSeq ?? 0}` : "LIVE"}
        </button>

        <div className="connection-pill" data-status={socketStatus}>
          {socketStatus === "connected" ? <Radio size={16} /> : <WifiOff size={16} />}
          {socketStatus}
        </div>
      </header>

      <section className="control-row">
        <div className="command-bar">
          <button disabled={busy} onClick={() => runCommand(commands.start)} title="Start mission">
            <CirclePlay size={17} /> Start
          </button>
          <button disabled={busy} onClick={() => runCommand(commands.pause)} title="Pause mission">
            <CirclePause size={17} /> Pause
          </button>
          <button disabled={busy} onClick={() => runCommand(commands.reset)} title="Reset mission">
            <RotateCcw size={17} /> Reset
          </button>
          <button disabled={busy} onClick={exportMission} title="Export mission package">
            <Download size={17} /> Export
          </button>
          <button disabled={busy} onClick={showReport} title="Generate mission report">
            <FileText size={17} /> Report
          </button>
          <button disabled={busy} onClick={showIncidentLog} title="Export incident log">
            <ScrollText size={17} /> Incident
          </button>
          <button disabled={busy} onClick={showReadiness} title="Open readiness checklist">
            <Check size={17} /> Readiness
          </button>
          <button disabled={busy} onClick={showSourceHealth} title="Open source health">
            <Activity size={17} /> Sources
          </button>
          <button disabled={busy} onClick={showPassivePlan} title="Generate passive read-only plan">
            <ClipboardList size={17} /> Passive
          </button>
          <button disabled={busy} onClick={showOperatorInputRequest} title="Generate operator input request">
            <MessageSquareText size={17} /> Input
          </button>
          <button
            disabled={busy}
            onClick={() =>
              setNoFlyDraft({
                x: Math.max(1, Math.floor(state.map.width * 0.42)),
                y: Math.max(1, Math.floor(state.map.height * 0.42)),
                width: Math.max(3, Math.floor(state.map.width * 0.08)),
                height: Math.max(3, Math.floor(state.map.height * 0.08))
              })
            }
            title="Add local no-fly zone"
          >
            <ShieldAlert size={17} /> No-fly
          </button>
        </div>

        <label className="scenario-picker">
          <span>Scenario</span>
          <select
            value={state.scenarioId}
            disabled={busy || state.phase === "running"}
            onChange={(event) => runCommand(() => commands.loadScenario(event.target.value))}
          >
            {scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name}
              </option>
            ))}
          </select>
        </label>

        <TrustSelector value={state.trustMode} disabled={busy} onChange={(mode) => runCommand(() => commands.trustMode(mode))} />

        <div className="replay-controls" aria-label="Replay controls">
          <button disabled={busy || !replaySession} onClick={() => seekReplay(0)} title="Seek replay start">
            <StepBack size={16} />
          </button>
          <select
            className="replay-select"
            value={selectedReplayId ?? ""}
            disabled={busy || !replaySummaries.length}
            onChange={(event) => setSelectedReplayId(event.target.value || null)}
            aria-label="Replay manifest"
            title="Select replay manifest"
          >
            {replaySummaries.length ? (
              replaySummaries.map((replay) => (
                <option key={replay.replayId} value={replay.replayId}>
                  {formatReplayLabel(replay)}
                </option>
              ))
            ) : (
              <option value="">no replay</option>
            )}
          </select>
          <button disabled={busy || !selectedReplayId} onClick={startReplay} title="Start selected replay">
            <History size={16} /> Replay
          </button>
          <button
            disabled={busy || !replaySession}
            onClick={() => replaySession && setReplaySession({ ...replaySession, playing: !replaySession.playing })}
            title={replaySession?.playing ? "Pause replay" : "Play replay"}
          >
            {replaySession?.playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <select
            className="speed-select"
            value={replaySession?.speed ?? 1}
            disabled={!replaySession}
            onChange={(event) => replaySession && setReplaySession({ ...replaySession, speed: Number(event.target.value) })}
            aria-label="Replay speed"
          >
            {[0.25, 0.5, 1, 2, 4].map((speed) => (
              <option key={speed} value={speed}>{speed}x</option>
            ))}
          </select>
          <button
            disabled={busy || !replaySession}
            onClick={() => replaySession && seekReplay(Math.min(replaySession.totalEventCount, replaySession.currentSeq + 10))}
            title="Seek replay to current sequence"
          >
            <StepForward size={16} />
          </button>
          <span className="replay-seq">{replaySession ? `${replaySession.currentSeq}/${replaySession.totalEventCount}` : "no replay"}</span>
        </div>
      </section>

      <section className="workspace">
        <MapView
          state={state}
          layers={layers}
          onToggleLayer={(layer) => setLayers((current) => ({ ...current, [layer]: !current[layer] }))}
        />

        <aside className="right-rail">
          <AlertFeed alerts={orderedAlerts} onAck={(id) => runCommand(() => commands.acknowledgeAlert(id))} />
          <DetectionPanel
            detections={state.detections}
            evidenceAssets={state.evidenceAssets}
            onEvidence={(detection, asset) => setSelectedEvidence({ detection, asset })}
            onReview={(id, review) => runCommand(() => commands.reviewDetection(id, review))}
          />
        </aside>

        <section className="lower-grid">
          <DronePanel drones={state.drones} zones={state.zones} onAction={(id, action) => runCommand(() => commands.droneAction(id, action))} />
          <ZonePanel
            drones={state.drones}
            zones={state.zones}
            taskLedger={state.taskLedger}
            proposals={state.proposals}
            onAssign={(droneId, zoneId) => runCommand(() => commands.assignZone(droneId, zoneId))}
          />
          <SpatialPanel assets={state.spatialAssets} onOpen={openSpatialAsset} onImport={importSpatialFixture} />
          <AiPanel
            proposals={state.proposals}
            aiStatus={aiStatus}
            onPropose={() => runCommand(commands.propose)}
            onApprove={(id) => setPendingProposalId(id)}
          />
        </section>
      </section>

      {pendingProposal && (
        <CommandReviewModal
          proposal={pendingProposal}
          onCancel={() => setPendingProposalId(null)}
          onApprove={() =>
            runCommand(async () => {
              const next = await commands.approveProposal(pendingProposal.id);
              setPendingProposalId(null);
              return next;
            })
          }
        />
      )}

      {selectedEvidence && (
        <EvidenceModal evidence={selectedEvidence} onClose={() => setSelectedEvidence(null)} />
      )}

      {reportText && <TextArtifactModal title="Mission Report" label="Mission report" markdown={reportText} onClose={() => setReportText(null)} />}

      {incidentLogText && <TextArtifactModal title="Incident Log" label="Incident log" markdown={incidentLogText} onClose={() => setIncidentLogText(null)} />}

      {passivePlan && <PassivePlanModal plan={passivePlan} onClose={() => setPassivePlan(null)} />}

      {artifactStatus && <ArtifactStatusModal status={artifactStatus} onClose={() => setArtifactStatus(null)} />}

      {operatorInputRequest && <OperatorInputModal request={operatorInputRequest} onClose={() => setOperatorInputRequest(null)} />}

      {readinessReport && (
        <ReadinessModal
          report={readinessReport}
          session={sessionManifest}
          replayId={selectedReplayId}
          copiedValue={copiedValue}
          onCopy={copyValue}
          onClose={() => setReadinessReport(null)}
        />
      )}

      {sourceHealth && <SourceHealthModal report={sourceHealth} onClose={() => setSourceHealth(null)} />}

      {selectedSpatial && (
        <Suspense fallback={<SpatialViewerLoading />}>
          <SpatialViewer
            key={`${selectedSpatial.asset.assetId}-${selectedSpatial.viewerKey}`}
            state={state}
            asset={selectedSpatial.asset}
            preview={selectedSpatial.preview}
            mode={viewMode}
            replaySeq={replaySession?.currentSeq ?? state.stateSeq}
            onResetCamera={() => setSelectedSpatial((current) => current ? { ...current, viewerKey: Date.now() } : current)}
            onClose={() => setSelectedSpatial(null)}
          />
        </Suspense>
      )}

      {noFlyDraft && (
        <NoFlyZoneModal
          draft={noFlyDraft}
          mapWidth={state.map.width}
          mapHeight={state.map.height}
          onChange={setNoFlyDraft}
          onCancel={() => setNoFlyDraft(null)}
          onSubmit={() =>
            runCommand(async () => {
              const next = await commands.addNoFlyZone(noFlyDraft, "Operator marked local planning hazard");
              setNoFlyDraft(null);
              return next;
            })
          }
        />
      )}

      <footer className="audit-bar" data-error={Boolean(lastError)} data-source-warning={!lastError && sourceWarningIds.length > 0}>
        <ShieldAlert size={16} />
        <span>{footerMessage}</span>
        <span className="audit-time">{formatTime(footerTime)}</span>
      </footer>
    </main>
  );
}

function CommandReviewModal({
  proposal,
  onCancel,
  onApprove
}: {
  proposal: AiProposal;
  onCancel: () => void;
  onApprove: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Command review">
      <section className="command-modal">
        <div className="panel-title compact">
          <h2>Command Review</h2>
          <span>{proposal.status}</span>
        </div>
        <div className="command-diff">
          <strong>{proposal.title}</strong>
          <p>{proposal.rationale}</p>
          <dl>
            {proposal.diff.length ? proposal.diff.map((diff) => (
              <div key={diff.field}>
                <dt>{diff.field}</dt>
                <dd>{formatDiffValue(diff.currentValue)} {"->"} {formatDiffValue(diff.proposedValue)}</dd>
              </div>
            )) : (
              <>
                <div>
                  <dt>Kind</dt>
                  <dd>{proposal.plan.kind}</dd>
                </div>
                <div>
                  <dt>Drone</dt>
                  <dd>{proposal.plan.droneId ?? "none"}</dd>
                </div>
                <div>
                  <dt>Zone</dt>
                  <dd>{proposal.plan.zoneId ?? "none"}</dd>
                </div>
                <div>
                  <dt>Target</dt>
                  <dd>{proposal.plan.coords ? `${Math.round(proposal.plan.coords.x)}, ${Math.round(proposal.plan.coords.y)}` : "none"}</dd>
                </div>
              </>
            )}
          </dl>
          <div className="validator-box" data-ok={proposal.validator.ok}>
            {proposal.validator.ok ? "Validator passed" : proposal.validator.blockers.join("; ")}
          </div>
        </div>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button disabled={!proposal.validator.ok} onClick={onApprove}>
            <Check size={15} /> Approve
          </button>
        </div>
      </section>
    </div>
  );
}

function SpatialViewerLoading() {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Spatial viewer">
      <section className="spatial-viewer-modal loading-viewer">
        <Radio size={22} />
        <span>Loading spatial viewer</span>
      </section>
    </div>
  );
}

function EvidenceModal({ evidence, onClose }: { evidence: { detection: Detection; asset?: EvidenceAsset }; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Evidence detail">
      <section className="command-modal">
        <div className="panel-title compact">
          <h2>Evidence Detail</h2>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="command-diff">
          <strong>{evidence.detection.kind} / {evidence.detection.review}</strong>
          <p>{evidence.detection.evidence.notes}</p>
          <dl>
            <div>
              <dt>Detection</dt>
              <dd>{evidence.detection.id}</dd>
            </div>
            <div>
              <dt>Frame</dt>
              <dd>{evidence.detection.evidence.frameId}</dd>
            </div>
            <div>
              <dt>URI</dt>
              <dd>{evidence.asset?.uri ?? "none"}</dd>
            </div>
            <div>
              <dt>Hash</dt>
              <dd>{evidence.asset?.hash ?? "none"}</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}

function TextArtifactModal({ title, label, markdown, onClose }: { title: string; label: string; markdown: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={label}>
      <section className="report-modal">
        <div className="panel-title compact">
          <h2>{title}</h2>
          <button onClick={onClose}>Close</button>
        </div>
        <pre>{markdown}</pre>
      </section>
    </div>
  );
}

function ArtifactStatusModal({
  status,
  onClose
}: {
  status: { label: string; state: "loading" | "error"; message?: string };
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${status.label} status`}>
      <section className="artifact-status-modal" data-state={status.state}>
        <div className="panel-title compact">
          <div>
            <h2>{status.label}</h2>
            <span>{status.state === "loading" ? "Loading" : "Error"}</span>
          </div>
          {status.state === "error" && <button onClick={onClose}>Close</button>}
        </div>
        <div className="artifact-status-body">
          {status.state === "loading" ? <Radio size={22} /> : <ShieldAlert size={22} />}
          <strong>{status.state === "loading" ? "Preparing artifact" : "Artifact unavailable"}</strong>
          <p>{status.state === "loading" ? "Waiting for the local API response." : status.message ?? "The local API did not return this artifact."}</p>
        </div>
      </section>
    </div>
  );
}

function PassivePlanModal({ plan, onClose }: { plan: PassivePlan; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Passive plan">
      <section className="passive-modal">
        <div className="panel-title compact">
          <div>
            <h2>Passive Plan</h2>
            <span>{plan.mode} / seq {plan.stateSeq} / {formatTime(plan.generatedAt)}</span>
          </div>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="passive-summary">
          <strong>{plan.summary}</strong>
          <div className="passive-plan-grid">
            <PlanList title="Next Actions" steps={plan.nextActions} />
            <PlanList title="Watch Items" steps={plan.watchItems} />
          </div>
          <section className="passive-notes">
            <h3>Constraints</h3>
            {plan.constraints.map((constraint) => (
              <span key={constraint}>{constraint}</span>
            ))}
          </section>
          <section className="passive-notes">
            <h3>Safety Notes</h3>
            {plan.safetyNotes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </section>
        </div>
      </section>
    </div>
  );
}

function PlanList({ title, steps }: { title: string; steps: PassivePlan["nextActions"] }) {
  return (
    <section className="passive-list">
      <h3>{title}</h3>
      {steps.length ? steps.map((step) => (
        <article key={step.id} className="passive-step" data-priority={step.priority}>
          <div>
            <strong>{step.title}</strong>
            <span>{step.priority} / {step.category} / {step.status}</span>
          </div>
          <p>{step.rationale}</p>
          <code>{step.targetRef ?? "mission"}</code>
        </article>
      )) : <p className="empty-copy">No items</p>}
    </section>
  );
}

function OperatorInputModal({ request, onClose }: { request: OperatorInputRequest; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Operator input request">
      <section className="command-modal">
        <div className="panel-title compact">
          <div>
            <h2>Operator Input</h2>
            <span>{request.mode} / {request.urgency} / seq {request.stateSeq}</span>
          </div>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="command-diff">
          <strong>{request.question}</strong>
          <p>{request.rationale}</p>
          <dl>
            {request.options.map((option) => (
              <div key={option.value}>
                <dt>{option.label}</dt>
                <dd>{option.effect}</dd>
              </div>
            ))}
          </dl>
          <div className="tool-trace">
            {request.refs.map((ref) => (
              <span key={ref}>{ref}</span>
            ))}
          </div>
          <div className="validator-box" data-ok="true">
            {request.safetyNotes[0]}
          </div>
        </div>
      </section>
    </div>
  );
}

function ReadinessModal({
  report,
  session,
  replayId,
  copiedValue,
  onCopy,
  onClose
}: {
  report: ReadinessReport;
  session: SessionManifest | null;
  replayId: string | null;
  copiedValue: string | null;
  onCopy: (label: string, value: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Readiness">
      <section className="readiness-modal">
        <div className="panel-title compact">
          <div>
            <h2>Readiness</h2>
            <span>{report.ok ? "READY" : "BLOCKED"} / seq {report.stateSeq} / {formatTime(report.generatedAt)}</span>
          </div>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="readiness-body">
          <div className="readiness-summary">
            <SummaryItem label="Mission" value={report.missionId} copyValue={report.missionId} copied={copiedValue === "readiness-mission"} onCopy={() => onCopy("readiness-mission", report.missionId)} />
            <SummaryItem label="Build" value={session?.softwareVersion ?? "unknown"} copyValue={session?.softwareVersion ?? "unknown"} copied={copiedValue === "readiness-build"} onCopy={() => onCopy("readiness-build", session?.softwareVersion ?? "unknown")} />
            <SummaryItem label="Final hash" value={report.summary.finalStateHash.slice(0, 16)} title={report.summary.finalStateHash} copyValue={report.summary.finalStateHash} copied={copiedValue === "readiness-hash"} onCopy={() => onCopy("readiness-hash", report.summary.finalStateHash)} />
            <SummaryItem label="Replay" value={replayId ? replayId.slice(0, 18) : "none"} title={replayId ?? undefined} copyValue={replayId ?? undefined} copied={copiedValue === "readiness-replay"} onCopy={() => replayId && onCopy("readiness-replay", replayId)} />
            <SummaryItem label="Events" value={String(report.summary.eventCount)} />
            <SummaryItem label="Replays" value={String(report.summary.replayCount)} />
            <SummaryItem label="AI" value={`${report.summary.ai.provider} / ${report.summary.ai.model}`} title={report.summary.ai.reason} />
            <SummaryItem label="Sources" value={`${report.summary.sourceHealth.sourceCount} / ${report.summary.sourceHealth.warn} warn`} title={report.summary.sourceHealth.staleSourceIds.join(", ")} />
          </div>
          <div className="readiness-counts">
            <span data-status="pass">{report.summary.pass} pass</span>
            <span data-status="warn">{report.summary.warn} warn</span>
            <span data-status="fail">{report.summary.fail} fail</span>
          </div>
          <div className="readiness-checklist">
            {report.checks.map((item) => (
              <article key={item.id} className="readiness-check" data-status={item.status} data-blocking={item.blocking}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.status}{item.blocking ? " / blocking" : ""}</span>
                </div>
                <p>{item.details}</p>
              </article>
            ))}
          </div>
          {report.summary.configWarnings.length > 0 && (
            <div className="readiness-config-warnings">
              {report.summary.configWarnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  title,
  copyValue,
  copied,
  onCopy
}: {
  label: string;
  value: string;
  title?: string;
  copyValue?: string;
  copied?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
      {copyValue && onCopy && (
        <button className="summary-copy" onClick={onCopy} title={`Copy ${label.toLowerCase()}`}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      )}
    </div>
  );
}

function SourceHealthModal({ report, onClose }: { report: SourceHealthReport; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Source health">
      <section className="source-modal">
        <div className="panel-title compact">
          <div>
            <h2>Source Health</h2>
            <span>{report.ok ? "NOMINAL" : "DEGRADED"} / seq {report.stateSeq} / {formatTime(report.generatedAt)}</span>
          </div>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="source-body">
          <div className="source-summary">
            <SummaryItem label="Sources" value={String(report.summary.sourceCount)} />
            <SummaryItem label="Events" value={String(report.summary.eventCount)} />
            <SummaryItem label="Channels" value={report.summary.channels.join(", ") || "none"} />
            <SummaryItem label="Stale" value={String(report.summary.staleSourceIds.length)} />
          </div>
          <div className="source-list">
            {report.sources.length ? report.sources.map((source) => (
              <article key={source.id} className="source-entry" data-status={source.status}>
                <div>
                  <strong>{source.label}</strong>
                  <span>{source.status} / {source.expected ? "expected / " : ""}{source.channels.join(", ")}</span>
                </div>
                <p>{source.details}</p>
              </article>
            )) : <p className="empty-copy">No source events recorded yet</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

function NoFlyZoneModal({
  draft,
  mapWidth,
  mapHeight,
  onChange,
  onCancel,
  onSubmit
}: {
  draft: { x: number; y: number; width: number; height: number };
  mapWidth: number;
  mapHeight: number;
  onChange: (draft: { x: number; y: number; width: number; height: number }) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const invalid =
    draft.x < 0 ||
    draft.y < 0 ||
    draft.width <= 0 ||
    draft.height <= 0 ||
    draft.x + draft.width > mapWidth ||
    draft.y + draft.height > mapHeight;

  function update(field: keyof typeof draft, value: string) {
    onChange({ ...draft, [field]: Number(value) });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="No-fly zone">
      <section className="command-modal">
        <div className="panel-title compact">
          <h2>No-fly Zone</h2>
          <span>{mapWidth} x {mapHeight}</span>
        </div>
        <div className="no-fly-form">
          <NumberField label="X" value={draft.x} onChange={(value) => update("x", value)} />
          <NumberField label="Y" value={draft.y} onChange={(value) => update("y", value)} />
          <NumberField label="W" value={draft.width} onChange={(value) => update("width", value)} />
          <NumberField label="H" value={draft.height} onChange={(value) => update("height", value)} />
          <div className="validator-box" data-ok={!invalid}>
            {invalid ? "Bounds must stay inside the mission map" : "Local planning constraint only"}
          </div>
        </div>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button disabled={invalid} onClick={onSubmit}>
            <ShieldAlert size={15} /> Add
          </button>
        </div>
      </section>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <input type="number" value={value} min={0} step={1} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "ok" | "danger" }) {
  return (
    <div className="metric" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TrustSelector({
  value,
  disabled,
  onChange
}: {
  value: TrustMode;
  disabled: boolean;
  onChange: (mode: TrustMode) => void;
}) {
  const modes: { value: TrustMode; label: string; icon: ReactNode }[] = [
    { value: "advisory", label: "Advisory", icon: <Bot size={16} /> },
    { value: "semi-auto", label: "Semi-auto", icon: <Check size={16} /> },
    { value: "full-auto-training", label: "Training auto", icon: <Siren size={16} /> }
  ];

  return (
    <div className="segmented" aria-label="Trust mode">
      {modes.map((mode) => (
        <button
          key={mode.value}
          disabled={disabled}
          className={value === mode.value ? "active" : ""}
          onClick={() => onChange(mode.value)}
          title={`Set ${mode.label}`}
        >
          {mode.icon}
          {mode.label}
        </button>
      ))}
    </div>
  );
}

function formatTime(value?: number) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function formatReplayLabel(replay: ReplaySummary) {
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(replay.exportedAt);
  return `${time} / ${replay.eventCount} ev / ${replay.finalStateHash.slice(0, 8)}`;
}

function formatDiffValue(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isMissionState(value: unknown): value is MissionState {
  return Boolean(value && typeof value === "object" && "missionId" in value && "stateSeq" in value);
}
