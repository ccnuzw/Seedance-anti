import type {
  VersionRef,
  ExternalVersionRef,
  SourceEvidence,
  ScriptRevision,
  ScriptScene,
  Shot,
  Asset,
  AssetRevision,
  Appearance,
  PromptRevision,
  ImageMedia,
  VideoMedia,
  AudioMedia,
  MediaObject,
  CandidateSource,
  Candidate,
  AssetBinding,
  ReviewIssue,
  ReviewRecord,
  AdoptionRecord,
  CutClip,
  CutAudio,
  EpisodeCut,
  ProductionManifest
} from './model'
import {
  array,
  body,
  boolean,
  enumeration as oneOf,
  hash,
  id,
  integer,
  nonnegative,
  nullable,
  object,
  order,
  positive,
  scalar,
  tagged,
  text,
  timestamp
} from './validation'
import { isProductionRelativePath } from './paths'

export const relativePathSchema = scalar(
  isProductionRelativePath,
  'Expected canonical project-relative POSIX path'
)
export const versionRefSchema = object<VersionRef>({
  projectId: id,
  kind: oneOf(
    'script',
    'scene',
    'shot',
    'asset',
    'appearance',
    'prompt',
    'cut'
  ),
  objectId: id,
  revisionId: id
})
const external = object<ExternalVersionRef>({
  id,
  version: text,
  contentHash: hash
})
const evidence = object<SourceEvidence>({
  relativePath: relativePathSchema,
  contentHash: hash,
  anchor: text
})
const script = object<ScriptRevision>({
  projectId: id,
  scriptId: id,
  revisionId: id,
  parentRevisionId: nullable(id),
  episodeNumber: integer,
  contentHash: hash,
  markdown: body,
  sources: array(evidence)
})
const scene = object<ScriptScene>({
  projectId: id,
  sceneId: id,
  scriptRevisionId: id,
  title: text,
  order,
  anchor: text,
  plotPointIds: array(id)
})
const shot = object<Shot>({
  projectId: id,
  shotId: id,
  shotRevisionId: id,
  parentRevisionId: nullable(id),
  scriptRevisionId: id,
  sceneId: id,
  order,
  action: body,
  dialogue: body,
  camera: body,
  durationSeconds: positive,
  contentHash: hash
})
const asset = object<Asset>({
  projectId: id,
  assetId: id,
  type: oneOf('character', 'scene', 'prop', 'costume', 'makeup'),
  name: text,
  aliases: array(text),
  sources: array(evidence)
})
const assetRevision = object<AssetRevision>({
  projectId: id,
  assetId: id,
  assetRevisionId: id,
  parentRevisionId: nullable(id),
  description: text,
  contentHash: hash,
  sources: array(evidence)
})
const appearance = object<Appearance>({
  projectId: id,
  appearanceId: id,
  appearanceRevisionId: id,
  parentRevisionId: nullable(id),
  name: text,
  characterRevisionId: id,
  costumeRevisionIds: array(id),
  makeupRevisionIds: array(id),
  state: body,
  contentHash: hash
})
const prompt = object<PromptRevision>({
  projectId: id,
  promptId: id,
  promptRevisionId: id,
  parentRevisionId: nullable(id),
  target: versionRefSchema,
  text,
  contentHash: hash,
  template: external,
  rules: array(external),
  skill: nullable(external),
  model: nullable(external),
  inputs: array(versionRefSchema),
  mediaIds: array(id)
})
const mediaBase = {
  projectId: id,
  mediaId: id,
  contentHash: hash,
  relativePath: relativePathSchema,
  byteLength: integer
}
const image = object<ImageMedia>({
  ...mediaBase,
  kind: oneOf('image'),
  mimeType: oneOf('image/png', 'image/jpeg', 'image/webp'),
  width: integer,
  height: integer
})
const video = object<VideoMedia>({
  ...mediaBase,
  kind: oneOf('video'),
  mimeType: oneOf('video/mp4', 'video/webm', 'video/quicktime'),
  width: integer,
  height: integer,
  durationSeconds: positive,
  hasAudio: boolean
})
const audio = object<AudioMedia>({
  ...mediaBase,
  kind: oneOf('audio'),
  mimeType: oneOf('audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg'),
  durationSeconds: positive,
  channels: integer,
  sampleRate: integer
})
export const mediaSchema = tagged<MediaObject>('kind', { image, video, audio })
const purpose = oneOf(
  'asset-reference',
  'first-frame',
  'last-frame',
  'composition',
  'shot-video',
  'audio-reference'
)
const source = tagged<CandidateSource>('kind', {
  import: object({ kind: oneOf('import'), evidence }),
  generation: object({
    kind: oneOf('generation'),
    promptRevisionId: id,
    operationId: id,
    model: external
  })
})
const candidate = object<Candidate>({
  projectId: id,
  candidateId: id,
  target: versionRefSchema,
  slotId: id,
  purpose,
  mediaId: id,
  source,
  technicalStatus: oneOf('pending', 'passed', 'failed'),
  createdAt: timestamp
})
const binding = object<AssetBinding>({
  projectId: id,
  bindingId: id,
  target: versionRefSchema,
  assetRevisionId: id,
  appearanceRevisionId: nullable(id),
  candidateId: id,
  mediaId: id,
  slotId: id,
  purpose,
  required: boolean
})
const issue = object<ReviewIssue>({
  code: id,
  severity: oneOf('critical', 'major', 'minor', 'info'),
  location: text,
  evidence: text,
  suggestion: body
})
const review = object<ReviewRecord>({
  projectId: id,
  reviewId: id,
  target: versionRefSchema,
  mediaId: nullable(id),
  inputHash: hash,
  rules: external,
  source: oneOf('program', 'model', 'human'),
  result: oneOf('PASS', 'FAIL', 'INVALID'),
  issues: array(issue),
  createdAt: timestamp
})
const adoption = object<AdoptionRecord>({
  projectId: id,
  adoptionId: id,
  target: versionRefSchema,
  slotId: id,
  purpose,
  candidateId: id,
  previousAdoptionId: nullable(id),
  reviewIds: array(id),
  actor: text,
  createdAt: timestamp
})
const clip = object<CutClip>({
  shotRevisionId: id,
  mediaId: id,
  adoptionId: id,
  inSeconds: nonnegative,
  outSeconds: positive
})
const cutAudio = object<CutAudio>({
  mediaId: id,
  startSeconds: nonnegative,
  inSeconds: nonnegative,
  outSeconds: positive
})
const cut = object<EpisodeCut>({
  projectId: id,
  cutId: id,
  cutRevisionId: id,
  parentRevisionId: nullable(id),
  scriptRevisionId: id,
  clips: array(clip),
  audioTracks: array(cutAudio),
  exportSettings: object({
    width: integer,
    height: integer,
    fps: positive,
    container: oneOf('mp4', 'webm')
  }),
  contentHash: hash
})
export const manifestSchema = object<ProductionManifest>({
  schemaVersion: oneOf(1),
  projectId: id,
  scriptRevisions: array(script),
  scenes: array(scene),
  shots: array(shot),
  assets: array(asset),
  assetRevisions: array(assetRevision),
  appearances: array(appearance),
  promptRevisions: array(prompt),
  media: array(mediaSchema),
  candidates: array(candidate),
  bindings: array(binding),
  reviews: array(review),
  adoptions: array(adoption),
  currentAdoptionIds: array(id),
  cuts: array(cut)
})
