// Portable production facts only. IDs are opaque, project-scoped identifiers, never names or paths.
export type AssetType = 'character' | 'scene' | 'prop' | 'costume' | 'makeup'
export type VersionKind =
  'script' | 'scene' | 'shot' | 'asset' | 'appearance' | 'prompt' | 'cut'
export interface VersionRef {
  projectId: string
  kind: VersionKind
  objectId: string
  revisionId: string
}
// F01/F02 own the referenced descriptors/packages; this module does not interpret them.
export interface ExternalVersionRef {
  id: string
  version: string
  contentHash: string
}
export interface SourceEvidence {
  relativePath: string
  contentHash: string
  anchor: string
}
export interface Owned {
  projectId: string
}
export interface ScriptRevision extends Owned {
  scriptId: string
  revisionId: string
  parentRevisionId: string | null
  episodeNumber: number
  contentHash: string
  markdown: string
  sources: SourceEvidence[]
}
// A scene is a script occurrence, not a reusable scene asset. Its version is the script revision.
export interface ScriptScene extends Owned {
  sceneId: string
  scriptRevisionId: string
  title: string
  order: number
  anchor: string
  plotPointIds: string[]
}
export interface Shot extends Owned {
  shotId: string
  shotRevisionId: string
  parentRevisionId: string | null
  scriptRevisionId: string
  sceneId: string
  order: number
  action: string
  dialogue: string
  camera: string
  durationSeconds: number
  contentHash: string
}
export interface Asset extends Owned {
  assetId: string
  type: AssetType
  name: string
  aliases: string[]
  sources: SourceEvidence[]
}
export interface AssetRevision extends Owned {
  assetId: string
  assetRevisionId: string
  parentRevisionId: string | null
  description: string
  contentHash: string
  sources: SourceEvidence[]
}
export interface Appearance extends Owned {
  appearanceId: string
  appearanceRevisionId: string
  parentRevisionId: string | null
  name: string
  characterRevisionId: string
  costumeRevisionIds: string[]
  makeupRevisionIds: string[]
  state: string
  contentHash: string
}
export interface PromptRevision extends Owned {
  promptId: string
  promptRevisionId: string
  parentRevisionId: string | null
  target: VersionRef
  text: string
  contentHash: string
  template: ExternalVersionRef
  rules: ExternalVersionRef[]
  skill: ExternalVersionRef | null
  model: ExternalVersionRef | null
  inputs: VersionRef[]
  mediaIds: string[]
}
interface MediaBase extends Owned {
  mediaId: string
  contentHash: string // SHA-256, lowercase hex. Byte verification belongs to the storage service.
  relativePath: string // Project relative, portable POSIX path; resolved using the project layout.
  byteLength: number
}
export interface ImageMedia extends MediaBase {
  kind: 'image'
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
}
export interface VideoMedia extends MediaBase {
  kind: 'video'
  mimeType: 'video/mp4' | 'video/webm' | 'video/quicktime'
  width: number
  height: number
  durationSeconds: number
  hasAudio: boolean
}
export interface AudioMedia extends MediaBase {
  kind: 'audio'
  mimeType: 'audio/wav' | 'audio/mpeg' | 'audio/mp4' | 'audio/ogg'
  durationSeconds: number
  channels: number
  sampleRate: number
}
export type MediaObject = ImageMedia | VideoMedia | AudioMedia
export type MediaPurpose =
  | 'asset-reference'
  | 'first-frame'
  | 'last-frame'
  | 'composition'
  | 'shot-video'
  | 'audio-reference'
export type CandidateSource =
  | { kind: 'import'; evidence: SourceEvidence }
  | {
      kind: 'generation'
      promptRevisionId: string
      operationId: string
      model: ExternalVersionRef
    }
export interface Candidate extends Owned {
  candidateId: string
  target: VersionRef
  slotId: string // e.g. front/profile/wide; each slot has its own adoption history.
  purpose: MediaPurpose
  mediaId: string
  source: CandidateSource
  technicalStatus: 'pending' | 'passed' | 'failed'
  createdAt: string
}
export interface AssetBinding extends Owned {
  bindingId: string
  target: VersionRef // Only scene or shot versions.
  assetRevisionId: string
  appearanceRevisionId: string | null
  candidateId: string
  mediaId: string
  slotId: string
  purpose: MediaPurpose
  required: boolean
}
export interface ReviewIssue {
  code: string
  severity: 'critical' | 'major' | 'minor' | 'info'
  location: string
  evidence: string
  suggestion: string
}
export interface ReviewRecord extends Owned {
  reviewId: string
  target: VersionRef
  mediaId: string | null
  inputHash: string
  rules: ExternalVersionRef
  source: 'program' | 'model' | 'human'
  result: 'PASS' | 'FAIL' | 'INVALID'
  issues: ReviewIssue[]
  createdAt: string
}
export interface AdoptionRecord extends Owned {
  adoptionId: string
  target: VersionRef
  slotId: string
  purpose: MediaPurpose
  candidateId: string
  previousAdoptionId: string | null
  reviewIds: string[]
  actor: string
  createdAt: string
}
export interface CutClip {
  shotRevisionId: string
  mediaId: string
  adoptionId: string
  inSeconds: number
  outSeconds: number
}
export interface CutAudio {
  mediaId: string
  startSeconds: number
  inSeconds: number
  outSeconds: number
}
export interface EpisodeCut extends Owned {
  cutId: string
  cutRevisionId: string
  parentRevisionId: string | null
  scriptRevisionId: string
  clips: CutClip[] // Ordered, with exact historical media/adoption references.
  audioTracks: CutAudio[]
  exportSettings: {
    width: number
    height: number
    fps: number
    container: 'mp4' | 'webm'
  }
  contentHash: string
}
export interface ProductionManifest {
  schemaVersion: 1
  projectId: string
  scriptRevisions: ScriptRevision[]
  scenes: ScriptScene[]
  shots: Shot[]
  assets: Asset[]
  assetRevisions: AssetRevision[]
  appearances: Appearance[]
  promptRevisions: PromptRevision[]
  media: MediaObject[]
  candidates: Candidate[]
  bindings: AssetBinding[]
  reviews: ReviewRecord[]
  adoptions: AdoptionRecord[]
  currentAdoptionIds: string[]
  cuts: EpisodeCut[]
}
