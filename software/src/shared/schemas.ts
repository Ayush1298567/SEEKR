import { z } from "zod";
import { DEFAULT_SCENARIO_SEED, SEEKR_SCHEMA_VERSION } from "./constants";

export const MissionPhaseSchema = z.enum(["idle", "running", "paused", "complete"]);
export const TrustModeSchema = z.enum(["advisory", "semi-auto", "full-auto-training"]);
export const DroneStatusSchema = z.enum(["idle", "exploring", "investigating", "returning", "holding", "offline", "failed"]);
export const AlertSeveritySchema = z.enum(["P1", "P2", "P3"]);
export const DetectionReviewSchema = z.enum(["new", "confirmed", "false-positive", "needs-follow-up"]);
export const DroneActionSchema = z.enum(["resume", "hold", "return-home", "simulate-link-loss", "simulate-failure"]);
export const ActorSchema = z.enum(["system", "operator", "ai", "simulator", "adapter", "replay"]);

export const Vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number()
});

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive()
});

export const MapCellSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  known: z.boolean(),
  occupied: z.boolean(),
  frontier: z.boolean(),
  confidence: z.number().min(0).max(1),
  occupancy: z.enum(["unknown", "free", "occupied", "conflict"]).default("unknown"),
  sourceDroneId: z.string().optional(),
  sourceAdapter: z.string().optional(),
  frameId: z.string().optional(),
  transformConfidence: z.number().min(0).max(1).optional(),
  lastSeenBy: z.string().optional(),
  lastSeenAt: z.number().optional(),
  stale: z.boolean().default(false),
  conflict: z.boolean().default(false),
  conflictWith: z.array(z.string()).default([])
});

export const SearchZoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  bounds: RectSchema,
  priority: AlertSeveritySchema,
  assignedDroneIds: z.array(z.string()),
  coverage: z.number().min(0).max(100),
  status: z.enum(["unassigned", "active", "complete", "blocked"])
});

export const DroneSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: DroneStatusSchema,
  position: Vec3Schema,
  target: Vec3Schema.optional(),
  home: Vec3Schema,
  batteryPct: z.number().min(0).max(100),
  dynamicReservePct: z.number().min(0).max(100),
  linkQuality: z.number().min(0).max(100),
  estimatorQuality: z.number().min(0).max(100),
  assignedZoneId: z.string().optional(),
  currentTask: z.string(),
  speedMps: z.number().positive(),
  lastHeartbeat: z.number(),
  offlineSince: z.number().optional(),
  sourceAdapter: z.string().default("simulator"),
  mode: z.string().default("standby"),
  payloads: z.object({
    rgb: z.enum(["online", "degraded", "offline"]),
    thermal: z.enum(["online", "degraded", "offline", "not-installed"]),
    lidar: z.enum(["online", "degraded", "offline", "not-installed"])
  })
});

export const EvidenceAssetSchema = z.object({
  assetId: z.string(),
  missionId: z.string(),
  detectionId: z.string().optional(),
  kind: z.enum(["thumbnail", "frame", "clip", "log", "map", "report"]),
  uri: z.string(),
  mimeType: z.string(),
  hash: z.string(),
  createdAt: z.number(),
  retentionPolicy: z.enum(["ephemeral", "mission", "evidence", "legal-hold"]),
  redactionState: z.enum(["none", "pending", "redacted"]),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const SpatialRenderAssetFormatSchema = z.enum(["splat", "pcd", "ply", "glb", "gltf", "mp4", "json", "preview-points"]);
export const SpatialCoordinateSystemSchema = z.enum(["mission-local", "map", "enu", "ned", "unknown"]);

export const SpatialAssetSchema = z.object({
  assetId: z.string(),
  missionId: z.string().optional(),
  kind: z.enum(["gaussian-splat", "point-cloud", "mesh", "vps-pose", "4d-reconstruction", "spatial-video"]),
  uri: z.string().optional(),
  previewUri: z.string().optional(),
  assetFormat: SpatialRenderAssetFormatSchema.optional(),
  coordinateSystem: SpatialCoordinateSystemSchema.default("mission-local"),
  bounds: RectSchema.optional(),
  scale: Vec3Schema.optional(),
  sampleCount: z.number().int().nonnegative().optional(),
  renderHints: z.record(z.string(), z.unknown()).default({}),
  sourceAdapter: z.string(),
  frameId: z.string(),
  createdAt: z.number(),
  position: Vec3Schema,
  orientation: z
    .object({
      yawDeg: z.number().optional(),
      pitchDeg: z.number().optional(),
      rollDeg: z.number().optional()
    })
    .default({}),
  confidence: z.number().min(0).max(1),
  transformConfidence: z.number().min(0).max(1),
  droneId: z.string().optional(),
  linkedDetectionIds: z.array(z.string()).default([]),
  evidenceAssetIds: z.array(z.string()).default([]),
  timeRange: z.object({ startMs: z.number(), endMs: z.number() }).optional(),
  status: z.enum(["pending", "aligned", "stale", "rejected"]).default("pending"),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const DetectionSchema = z.object({
  id: z.string(),
  droneId: z.string(),
  kind: z.enum(["person", "thermal-hotspot", "motion-anomaly"]),
  position: Vec3Schema,
  confidence: z.number().min(0).max(100),
  severity: AlertSeveritySchema,
  review: DetectionReviewSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  sourceAdapter: z.string().default("simulator"),
  immutable: z.boolean().default(true),
  evidenceAssetIds: z.array(z.string()).default([]),
  evidence: z.object({
    frameId: z.string(),
    thumbnailTone: z.enum(["amber", "red", "blue", "gray"]),
    notes: z.string()
  })
});

export const PassivePlanStepSchema = z.object({
  id: z.string(),
  priority: AlertSeveritySchema,
  category: z.enum(["monitor", "review", "inspect", "import", "replay", "export", "verify"]),
  title: z.string(),
  rationale: z.string(),
  targetRef: z.string().optional(),
  status: z.enum(["pending", "active", "blocked"]).default("pending")
});

export const PassivePlanSchema = z.object({
  planId: z.string(),
  missionId: z.string(),
  stateSeq: z.number().int().nonnegative(),
  generatedAt: z.number(),
  mode: z.literal("passive-read-only"),
  summary: z.string(),
  objectives: z.array(z.string()),
  constraints: z.array(z.string()),
  watchItems: z.array(PassivePlanStepSchema),
  nextActions: z.array(PassivePlanStepSchema),
  safetyNotes: z.array(z.string())
});

export const IncidentLogEntrySchema = z.object({
  id: z.string(),
  seq: z.number().int().nonnegative(),
  createdAt: z.number(),
  type: z.string(),
  actor: ActorSchema,
  priority: AlertSeveritySchema.optional(),
  title: z.string(),
  summary: z.string(),
  refs: z.array(z.string()).default([])
});

export const IncidentLogSchema = z.object({
  logId: z.string(),
  missionId: z.string(),
  stateSeq: z.number().int().nonnegative(),
  generatedAt: z.number(),
  mode: z.literal("read-only-incident-log"),
  summary: z.string(),
  counts: z.object({
    events: z.number().int().nonnegative(),
    alerts: z.number().int().nonnegative(),
    openAlerts: z.number().int().nonnegative(),
    detections: z.number().int().nonnegative(),
    unreviewedDetections: z.number().int().nonnegative(),
    evidenceAssets: z.number().int().nonnegative(),
    spatialAssets: z.number().int().nonnegative(),
    commands: z.number().int().nonnegative(),
    proposals: z.number().int().nonnegative()
  }),
  timeline: z.array(IncidentLogEntrySchema),
  evidenceIndex: z.array(
    z.object({
      assetId: z.string(),
      kind: z.string(),
      uri: z.string(),
      hash: z.string(),
      detectionId: z.string().optional(),
      retentionPolicy: z.string()
    })
  ),
  commandSummary: z.array(z.object({ commandId: z.string(), kind: z.string(), status: z.string(), requestedBy: ActorSchema })),
  hashChain: z.object({
    ok: z.boolean(),
    eventCount: z.number().int().nonnegative(),
    finalStateHash: z.string(),
    errors: z.array(z.string())
  }),
  safetyNotes: z.array(z.string())
});

export const OperatorInputRequestSchema = z.object({
  requestId: z.string(),
  missionId: z.string(),
  stateSeq: z.number().int().nonnegative(),
  generatedAt: z.number(),
  mode: z.literal("operator-input-request"),
  urgency: AlertSeveritySchema,
  question: z.string(),
  rationale: z.string(),
  refs: z.array(z.string()).default([]),
  options: z.array(z.object({ label: z.string(), value: z.string(), effect: z.string() })).default([]),
  safetyNotes: z.array(z.string())
});

export const ReadinessCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  details: z.string(),
  blocking: z.boolean()
});

export const ReadinessReportSchema = z.object({
  ok: z.boolean(),
  generatedAt: z.number(),
  missionId: z.string(),
  stateSeq: z.number().int().nonnegative(),
  checks: z.array(ReadinessCheckSchema),
  summary: z.object({
    pass: z.number().int().nonnegative(),
    warn: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    blocking: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
    replayCount: z.number().int().nonnegative(),
    finalStateHash: z.string(),
    ai: z.object({
      ok: z.boolean(),
      provider: z.string(),
      model: z.string(),
      reason: z.string().optional()
    }),
    sourceHealth: z.object({
      ok: z.boolean(),
      pass: z.number().int().nonnegative(),
      warn: z.number().int().nonnegative(),
      fail: z.number().int().nonnegative(),
      sourceCount: z.number().int().nonnegative(),
      staleSourceIds: z.array(z.string())
    }),
    configWarnings: z.array(z.string()),
    blockers: z.array(z.string())
  })
});

export const SourceHealthChannelSchema = z.enum([
  "simulator",
  "telemetry",
  "map",
  "detection",
  "spatial",
  "lidar",
  "slam",
  "costmap",
  "perception",
  "import",
  "command",
  "ai",
  "replay"
]);

export const ExpectedSourceConfigSchema = z.object({
  sourceAdapter: z.string(),
  label: z.string().optional(),
  channels: z.array(SourceHealthChannelSchema),
  droneIds: z.array(z.string()).default([])
});

export const SourceHealthEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  sourceAdapter: z.string(),
  expected: z.boolean(),
  status: z.enum(["pass", "warn", "fail"]),
  channels: z.array(SourceHealthChannelSchema),
  eventCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative().default(0),
  lastEventSeq: z.number().int().nonnegative().optional(),
  lastEventAt: z.number().optional(),
  ageMs: z.number().nonnegative().optional(),
  droneIds: z.array(z.string()),
  details: z.string()
});

export const SourceHealthReportSchema = z.object({
  ok: z.boolean(),
  generatedAt: z.number(),
  missionId: z.string(),
  stateSeq: z.number().int().nonnegative(),
  sources: z.array(SourceHealthEntrySchema),
  summary: z.object({
    pass: z.number().int().nonnegative(),
    warn: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    sourceCount: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative().default(0),
    expectedSourceCount: z.number().int().nonnegative(),
    staleThresholdMs: z.number().int().positive(),
    channels: z.array(SourceHealthChannelSchema),
    staleSourceIds: z.array(z.string())
  })
});

export const HardwareTargetIdSchema = z.enum(["jetson-orin-nano", "raspberry-pi-5"]);

export const HardwareTargetProfileSchema = z.object({
  id: HardwareTargetIdSchema,
  label: z.string(),
  role: z.string(),
  recommendedOs: z.string(),
  rosDistro: z.string(),
  isaacSupport: z.enum(["recommended", "bridge-only", "not-targeted"]),
  minimumMemoryGb: z.number().positive(),
  recommendedFreeDiskGb: z.number().positive(),
  notes: z.array(z.string())
});

export const HardwareReadinessCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  details: z.string(),
  blocking: z.boolean(),
  targetAction: z.string().optional()
});

export const HardwareReadinessReportSchema = z.object({
  ok: z.boolean(),
  generatedAt: z.number(),
  target: HardwareTargetProfileSchema,
  host: z.object({
    platform: z.string(),
    arch: z.string(),
    nodeVersion: z.string(),
    cpuCount: z.number().int().nonnegative(),
    totalMemoryGb: z.number().nonnegative(),
    freeDiskGb: z.number().nonnegative().optional()
  }),
  checks: z.array(HardwareReadinessCheckSchema),
  summary: z.object({
    pass: z.number().int().nonnegative(),
    warn: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    blocking: z.number().int().nonnegative(),
    commandUploadEnabled: z.literal(false),
    expectedSourcesConfigured: z.boolean(),
    missingTools: z.array(z.string()),
    recommendedNextCommand: z.string()
  }),
  safetyNotes: z.array(z.string())
});

export const RuntimeConfigSchema = z.object({
  ok: z.boolean(),
  generatedAt: z.number(),
  schemaVersion: z.number(),
  softwareVersion: z.string(),
  missionId: z.string(),
  stateSeq: z.number().int().nonnegative(),
  server: z.object({
    bindHost: z.string(),
    apiPort: z.string(),
    clientPort: z.string(),
    nodeVersion: z.string(),
    platform: z.string(),
    cwd: z.string(),
    dataDir: z.string()
  }),
  storage: z.object({
    eventLogPath: z.string(),
    replayDir: z.string(),
    latestSnapshotPath: z.string()
  }),
  ai: z.object({
    provider: z.string(),
    ollamaModel: z.string(),
    ollamaUrlConfigured: z.boolean()
  }),
  auth: z.object({
    internalAuthEnabled: z.boolean(),
    tokenConfigured: z.boolean(),
    tokenRedacted: z.boolean()
  }),
  expectedSources: z.array(ExpectedSourceConfigSchema),
  sourceHealth: z.object({
    staleThresholdMs: z.number().int().positive(),
    expectedSourcesConfigured: z.boolean()
  }),
  safety: z.object({
    commandUploadEnabled: z.literal(false),
    realAdaptersReadOnly: z.boolean(),
    blockedCommandClasses: z.array(z.string())
  }),
  warnings: z.array(z.string())
});

export const SessionManifestSchema = z.object({
  ok: z.boolean(),
  generatedAt: z.number(),
  bootedAt: z.number(),
  uptimeMs: z.number().nonnegative(),
  pid: z.number().int().positive(),
  nodeVersion: z.string(),
  platform: z.string(),
  cwd: z.string(),
  dataDir: z.string(),
  schemaVersion: z.number(),
  softwareVersion: z.string(),
  missionId: z.string(),
  stateSeq: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  replayCount: z.number().int().nonnegative(),
  acceptance: z.object({
    ok: z.boolean(),
    status: z.enum(["pass", "missing", "stale", "software-mismatch", "incomplete", "unsafe"]),
    currentBoot: z.boolean(),
    ageMs: z.number().nonnegative().optional(),
    generatedAt: z.number().optional(),
    softwareVersion: z.string().optional(),
    commandCount: z.number().int().nonnegative().optional(),
    strictLocalAi: z.object({
      ok: z.boolean(),
      provider: z.string(),
      model: z.string(),
      caseCount: z.number().int().nonnegative()
    }).optional(),
    releaseChecksum: z.object({
      overallSha256: z.string(),
      fileCount: z.number().int().nonnegative(),
      totalBytes: z.number().int().nonnegative()
    }).optional(),
    commandBoundaryScan: z.object({
      status: z.literal("pass"),
      scannedFileCount: z.number().int().positive(),
      violationCount: z.literal(0),
      allowedFindingCount: z.number().int().nonnegative()
    }).optional(),
    commandUploadEnabled: z.literal(false),
    reason: z.string().optional()
  }),
  config: z.object({
    apiPort: z.string(),
    clientPort: z.string(),
    aiProvider: z.string(),
    ollamaModel: z.string(),
    ollamaUrlConfigured: z.boolean(),
    internalAuthEnabled: z.boolean(),
    expectedSourcesConfigured: z.boolean()
  })
});

export const AlertSchema = z.object({
  id: z.string(),
  severity: AlertSeveritySchema,
  title: z.string(),
  message: z.string(),
  droneId: z.string().optional(),
  detectionId: z.string().optional(),
  acknowledged: z.boolean(),
  createdAt: z.number()
});

export const AuditEventSchema = z.object({
  id: z.string(),
  actor: ActorSchema,
  type: z.string(),
  message: z.string(),
  createdAt: z.number(),
  data: z.record(z.string(), z.unknown()).optional()
});

export const MissionPlanSchema = z.object({
  kind: z.enum(["assign-zone", "focused-search", "return-drone", "hold-drone", "set-no-fly-zone"]),
  droneId: z.string().optional(),
  zoneId: z.string().optional(),
  bounds: RectSchema.optional(),
  coords: Vec3Schema.optional(),
  radiusM: z.number().positive().optional(),
  reason: z.string()
});

export const ValidationResultSchema = z.object({
  ok: z.boolean(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string())
});

export const ToolCallRecordSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.string(),
  createdAt: z.number()
});

export const AiProposalSchema = z.object({
  id: z.string(),
  title: z.string(),
  rationale: z.string(),
  risk: AlertSeveritySchema,
  status: z.enum(["draft", "validated", "rejected", "approved", "executed"]),
  createdAt: z.number(),
  provider: z.string().default("local-rule-engine"),
  model: z.string().default("deterministic-v1"),
  inputRefs: z.array(z.string()).default([]),
  commandIds: z.array(z.string()).default([]),
  toolCalls: z.array(ToolCallRecordSchema),
  plan: MissionPlanSchema,
  validator: ValidationResultSchema,
  diff: z
    .array(
      z.object({
        field: z.string(),
        affectedDroneId: z.string().optional(),
        affectedZoneId: z.string().optional(),
        currentValue: z.unknown(),
        proposedValue: z.unknown(),
        blockers: z.array(z.string()).default([]),
        warnings: z.array(z.string()).default([])
      })
    )
    .default([]),
  staleAfterSeq: z.number().int().nonnegative().optional(),
  expiresAt: z.number().optional()
});

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  risk: z.enum(["read", "propose", "command"]),
  requiresApproval: z.boolean(),
  schema: z.record(z.string(), z.unknown())
});

export const CommandKindSchema = z.enum([
  "mission.start",
  "mission.pause",
  "mission.reset",
  "trust.set",
  "zone.assign",
  "drone.action",
  "detection.review",
  "alert.ack",
  "no_fly_zone.add",
  "scenario.load",
  "ai.proposal.approve",
  "replay.start",
  "replay.seek",
  "ingest.telemetry",
  "ingest.map-delta",
  "ingest.detection"
]);

export const CommandRequestSchema = z.object({
  commandId: z.string().min(1),
  kind: CommandKindSchema,
  target: z.record(z.string(), z.unknown()).default({}),
  params: z.record(z.string(), z.unknown()).default({}),
  requestedBy: ActorSchema.default("operator"),
  idempotencyKey: z.string().min(1),
  requestedAt: z.number().optional()
});

export const CommandLifecycleStatusSchema = z.enum([
  "requested",
  "validated",
  "rejected",
  "approved",
  "dispatched",
  "accepted",
  "failed",
  "timed_out",
  "cancelled"
]);

export const CommandLifecycleSchema = z.object({
  commandId: z.string(),
  kind: CommandKindSchema,
  status: CommandLifecycleStatusSchema,
  requestedBy: ActorSchema,
  requestedAt: z.number(),
  updatedAt: z.number(),
  validation: ValidationResultSchema.optional(),
  approvedBy: ActorSchema.optional(),
  failureReason: z.string().optional(),
  dispatchedAt: z.number().optional(),
  acceptedAt: z.number().optional()
});

export const TelemetrySampleSchema = z.object({
  sampleId: z.string(),
  droneId: z.string(),
  receivedAt: z.number(),
  heartbeat: z.boolean().default(true),
  batteryPct: z.number().min(0).max(100).optional(),
  position: Vec3Schema.optional(),
  velocity: Vec3Schema.optional(),
  mode: z.string().optional(),
  status: DroneStatusSchema.optional(),
  estimatorQuality: z.number().min(0).max(100).optional(),
  linkQuality: z.number().min(0).max(100).optional(),
  sourceAdapter: z.string()
});

export const MapDeltaCellSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  occupancy: z.enum(["unknown", "free", "occupied"]),
  probability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1)
});

export const MapDeltaSchema = z.object({
  deltaId: z.string(),
  missionId: z.string().optional(),
  sourceDroneId: z.string(),
  sourceAdapter: z.string(),
  frameId: z.string(),
  transformConfidence: z.number().min(0).max(1),
  createdAt: z.number(),
  cells: z.array(MapDeltaCellSchema),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const ScenarioFaultSchema = z.object({
  id: z.string(),
  atElapsedSec: z.number().nonnegative(),
  kind: z.enum([
    "link-loss",
    "estimator-degradation",
    "low-battery",
    "drone-dropout",
    "false-positive-detection",
    "duplicate-detection",
    "stale-map-source"
  ]),
  droneId: z.string().optional(),
  params: z.record(z.string(), z.unknown()).default({})
});

export const ScenarioDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  seed: z.number().int().default(DEFAULT_SCENARIO_SEED),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  initialKnown: z.array(RectSchema),
  obstacles: z.array(RectSchema),
  zones: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
      priority: AlertSeveritySchema
    })
  ),
  drones: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      x: z.number(),
      y: z.number(),
      batteryPct: z.number().min(0).max(100).optional()
    })
  ),
  detectionSeeds: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      kind: z.enum(["person", "thermal-hotspot", "motion-anomaly"]),
      confidence: z.number().min(0).max(100)
    })
  ),
  scriptedFaults: z.array(ScenarioFaultSchema).default([]),
  expectedOutcomes: z.array(z.string()).default([])
});

export const TaskLedgerEntrySchema = z.object({
  taskId: z.string(),
  zoneId: z.string(),
  droneId: z.string(),
  status: z.enum(["assigned", "in_progress", "incomplete", "complete", "failed", "reassigned"]),
  reason: z.string(),
  proposedDroneId: z.string().optional(),
  reassignedFromTaskId: z.string().optional(),
  proposalId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number()
});

export const MissionStateV1Schema = z.object({
  schemaVersion: z.literal(SEEKR_SCHEMA_VERSION),
  stateSeq: z.number().int().nonnegative(),
  updatedAt: z.number(),
  source: z.enum(["simulator", "adapter", "replay", "operator"]).default("simulator"),
  missionId: z.string(),
  scenarioId: z.string(),
  scenarioName: z.string(),
  phase: MissionPhaseSchema,
  trustMode: TrustModeSchema,
  startedAt: z.number().optional(),
  elapsedSec: z.number().nonnegative(),
  simulator: z.object({
    seed: z.number().int(),
    tick: z.number().int().nonnegative(),
    appliedFaultIds: z.array(z.string())
  }),
  map: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    cells: z.array(MapCellSchema)
  }),
  drones: z.array(DroneSchema),
  zones: z.array(SearchZoneSchema),
  noFlyZones: z.array(RectSchema).default([]),
  detections: z.array(DetectionSchema),
  evidenceAssets: z.array(EvidenceAssetSchema).default([]),
  spatialAssets: z.array(SpatialAssetSchema).default([]),
  alerts: z.array(AlertSchema),
  proposals: z.array(AiProposalSchema),
  commandLifecycles: z.array(CommandLifecycleSchema).default([]),
  taskLedger: z.array(TaskLedgerEntrySchema).default([]),
  auditTail: z.array(AuditEventSchema),
  metrics: z.object({
    coveragePct: z.number(),
    activeDrones: z.number(),
    p1Open: z.number(),
    averageBatteryPct: z.number(),
    mapLatencyMs: z.number(),
    staleSources: z.number().default(0),
    conflictCells: z.number().default(0)
  })
});

export const MissionEventSchema = z.object({
  eventId: z.string(),
  missionId: z.string(),
  seq: z.number().int().positive(),
  type: z.string(),
  actor: ActorSchema,
  createdAt: z.number(),
  payload: z.record(z.string(), z.unknown()),
  prevHash: z.string(),
  hash: z.string()
});

export const ReplayManifestSchema = z.object({
  replayId: z.string(),
  missionId: z.string(),
  scenarioId: z.string(),
  exportedAt: z.number(),
  schemaVersion: z.number(),
  softwareVersion: z.string(),
  eventCount: z.number().int().nonnegative(),
  eventLog: z.array(MissionEventSchema),
  snapshots: z.array(MissionStateV1Schema),
  evidenceIndex: z.array(EvidenceAssetSchema),
  adapterMetadata: z.record(z.string(), z.unknown()),
  runMetadata: z
    .object({
      session: SessionManifestSchema,
      config: RuntimeConfigSchema
    })
    .optional(),
  finalStateHash: z.string()
});

export const AiToolCallSchema = z.object({
  callId: z.string(),
  proposalId: z.string().optional(),
  provider: z.string(),
  model: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.unknown(),
  validator: ValidationResultSchema.optional(),
  createdAt: z.number()
});
