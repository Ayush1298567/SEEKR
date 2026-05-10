import type { z } from "zod";
import type {
  AiProposalSchema,
  AiToolCallSchema,
  AlertSchema,
  AlertSeveritySchema,
  ActorSchema,
  AuditEventSchema,
  CommandKindSchema,
  CommandLifecycleSchema,
  CommandLifecycleStatusSchema,
  CommandRequestSchema,
  DetectionReviewSchema,
  DetectionSchema,
  DroneActionSchema,
  DroneSchema,
  DroneStatusSchema,
  EvidenceAssetSchema,
  ExpectedSourceConfigSchema,
  HardwareReadinessCheckSchema,
  HardwareReadinessReportSchema,
  HardwareTargetIdSchema,
  HardwareTargetProfileSchema,
  IncidentLogEntrySchema,
  IncidentLogSchema,
  MapCellSchema,
  MapDeltaSchema,
  MissionEventSchema,
  MissionPhaseSchema,
  OperatorInputRequestSchema,
  MissionPlanSchema,
  MissionStateV1Schema,
  PassivePlanSchema,
  PassivePlanStepSchema,
  ReadinessCheckSchema,
  ReadinessReportSchema,
  ReplayManifestSchema,
  RuntimeConfigSchema,
  ScenarioDefinitionSchema,
  ScenarioFaultSchema,
  SearchZoneSchema,
  SessionManifestSchema,
  SourceHealthChannelSchema,
  SourceHealthEntrySchema,
  SourceHealthReportSchema,
  SpatialCoordinateSystemSchema,
  SpatialRenderAssetFormatSchema,
  SpatialAssetSchema,
  TaskLedgerEntrySchema,
  TelemetrySampleSchema,
  ToolCallRecordSchema,
  ToolDefinitionSchema,
  TrustModeSchema,
  ValidationResultSchema,
  Vec3Schema
} from "./schemas";

export type MissionPhase = z.infer<typeof MissionPhaseSchema>;
export type TrustMode = z.infer<typeof TrustModeSchema>;
export type DroneStatus = z.infer<typeof DroneStatusSchema>;
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;
export type Actor = z.infer<typeof ActorSchema>;
export type DetectionReview = z.infer<typeof DetectionReviewSchema>;
export type DroneAction = z.infer<typeof DroneActionSchema>;
export type Vec3 = z.infer<typeof Vec3Schema>;
export type MapCell = z.infer<typeof MapCellSchema>;
export type SearchZone = z.infer<typeof SearchZoneSchema>;
export type TaskLedgerEntry = z.infer<typeof TaskLedgerEntrySchema>;
export type Drone = z.infer<typeof DroneSchema>;
export type Detection = z.infer<typeof DetectionSchema>;
export type Alert = z.infer<typeof AlertSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type AiProposal = z.infer<typeof AiProposalSchema>;
export type AiToolCall = z.infer<typeof AiToolCallSchema>;
export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;
export type MissionPlan = z.infer<typeof MissionPlanSchema>;
export type PassivePlanStep = z.infer<typeof PassivePlanStepSchema>;
export type PassivePlan = z.infer<typeof PassivePlanSchema>;
export type IncidentLogEntry = z.infer<typeof IncidentLogEntrySchema>;
export type IncidentLog = z.infer<typeof IncidentLogSchema>;
export type OperatorInputRequest = z.infer<typeof OperatorInputRequestSchema>;
export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;
export type ReadinessReport = z.infer<typeof ReadinessReportSchema>;
export type SourceHealthChannel = z.infer<typeof SourceHealthChannelSchema>;
export type SourceHealthEntry = z.infer<typeof SourceHealthEntrySchema>;
export type SourceHealthReport = z.infer<typeof SourceHealthReportSchema>;
export type SessionManifest = z.infer<typeof SessionManifestSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
export type MissionStateV1 = z.infer<typeof MissionStateV1Schema>;
export type MissionState = MissionStateV1;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type CommandKind = z.infer<typeof CommandKindSchema>;
export type CommandRequest = z.infer<typeof CommandRequestSchema>;
export type CommandLifecycleStatus = z.infer<typeof CommandLifecycleStatusSchema>;
export type CommandLifecycle = z.infer<typeof CommandLifecycleSchema>;
export type TelemetrySample = z.infer<typeof TelemetrySampleSchema>;
export type MapDelta = z.infer<typeof MapDeltaSchema>;
export type EvidenceAsset = z.infer<typeof EvidenceAssetSchema>;
export type SpatialAsset = z.infer<typeof SpatialAssetSchema>;
export type SpatialRenderAssetFormat = z.infer<typeof SpatialRenderAssetFormatSchema>;
export type SpatialCoordinateSystem = z.infer<typeof SpatialCoordinateSystemSchema>;
export type ExpectedSourceConfig = z.infer<typeof ExpectedSourceConfigSchema>;
export type HardwareTargetId = z.infer<typeof HardwareTargetIdSchema>;
export type HardwareTargetProfile = z.infer<typeof HardwareTargetProfileSchema>;
export type HardwareReadinessCheck = z.infer<typeof HardwareReadinessCheckSchema>;
export type HardwareReadinessReport = z.infer<typeof HardwareReadinessReportSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export type ScenarioFault = z.infer<typeof ScenarioFaultSchema>;
export type ScenarioDefinition = z.infer<typeof ScenarioDefinitionSchema>;
export type MissionEvent = z.infer<typeof MissionEventSchema>;
export type ReplayManifest = z.infer<typeof ReplayManifestSchema>;
