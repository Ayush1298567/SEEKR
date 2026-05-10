import { Check, Eye, Flag, X } from "lucide-react";
import type { Detection, DetectionReview, EvidenceAsset } from "../../shared/types";

export function DetectionPanel({
  detections,
  evidenceAssets,
  onEvidence,
  onReview
}: {
  detections: Detection[];
  evidenceAssets: EvidenceAsset[];
  onEvidence: (detection: Detection, asset?: EvidenceAsset) => void;
  onReview: (id: string, review: DetectionReview) => void;
}) {
  return (
    <section className="rail-panel detection-panel">
      <div className="panel-title compact">
        <h2>Detections</h2>
        <span>{detections.filter((detection) => detection.review === "new").length} new</span>
      </div>

      <div className="detection-list">
        {detections.slice(0, 7).map((detection) => {
          const asset = evidenceAssets.find((candidate) => detection.evidenceAssetIds.includes(candidate.assetId));
          return (
            <article key={detection.id} className="detection-card" data-review={detection.review}>
              <button className="thumbnail" data-tone={detection.evidence.thumbnailTone} onClick={() => onEvidence(detection, asset)} title="Open evidence details">
                <Eye size={20} />
              </button>
              <div className="detection-copy">
                <div>
                  <strong>{detection.kind.replace("-", " ")}</strong>
                  <span>{detection.confidence}%</span>
                </div>
                <p>
                  {detection.droneId} at {Math.round(detection.position.x)}, {Math.round(detection.position.y)}
                </p>
                <EvidenceLine detection={detection} evidenceAssets={evidenceAssets} />
                <div className="review-actions">
                  <button onClick={() => onReview(detection.id, "confirmed")} title="Confirm detection">
                    <Check size={14} /> Confirm
                  </button>
                  <button onClick={() => onReview(detection.id, "needs-follow-up")} title="Flag follow-up">
                    <Flag size={14} /> Follow-up
                  </button>
                  <button onClick={() => onReview(detection.id, "false-positive")} title="Mark false positive">
                    <X size={14} /> Clear
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EvidenceLine({ detection, evidenceAssets }: { detection: Detection; evidenceAssets: EvidenceAsset[] }) {
  const asset = evidenceAssets.find((candidate) => detection.evidenceAssetIds.includes(candidate.assetId));
  return (
    <div className="evidence-line">
      <span>{detection.evidence.frameId}</span>
      {asset && <span>{asset.retentionPolicy} / {asset.redactionState}</span>}
    </div>
  );
}
