import {
  clampConfidence,
  fallbackParserOutput,
  fallbackVisionOutput,
  type MergedState,
  type ParserOutput,
  type VisionOutput,
} from './types';

const EXTREMELY_HIGH_CONFIDENCE = 0.9;

export const mergeState = (
  parserState: ParserOutput | null,
  visionState: VisionOutput | null
): MergedState => {
  const parser = parserState ?? fallbackParserOutput();
  const vision = visionState ?? fallbackVisionOutput();

  const hasUsableVision = vision.image_quality === 'usable';
  const visionWeight = hasUsableVision ? 0.4 : 0.1;
  const parserWeight = 1 - visionWeight;

  let severeBleeding = parser.severe_bleeding;

  if (severeBleeding === null) {
    if (
      hasUsableVision &&
      vision.confidence >= 0.75 &&
      vision.severe_bleeding_likely !== null
    ) {
      severeBleeding = vision.severe_bleeding_likely;
    } else if (
      !hasUsableVision &&
      vision.confidence >= EXTREMELY_HIGH_CONFIDENCE &&
      vision.severe_bleeding_likely !== null
    ) {
      severeBleeding = vision.severe_bleeding_likely;
    }
  }

  const combinedNotes = new Set<string>(parser.notes);

  if (vision.image_quality !== 'usable') {
    combinedNotes.add(`Vision quality is ${vision.image_quality}`);
  }

  if (vision.person_visible === false) {
    combinedNotes.add('No person clearly visible in the frame');
  }

  if (!visionState) {
    combinedNotes.add('Vision skipped');
  }

  const weightedConfidence = clampConfidence(
    parser.confidence * parserWeight + vision.confidence * visionWeight,
    0
  );

  const cappedConfidence =
    vision.image_quality === 'usable'
      ? weightedConfidence
      : Math.min(weightedConfidence, 0.6);

  return {
    responsive: parser.responsive,
    breathing: parser.breathing,
    severe_bleeding: severeBleeding,
    injury_location: parser.injury_location,
    person_visible: vision.person_visible,
    casualty_supine: vision.casualty_supine,
    limb_visible: vision.limb_visible,
    image_quality: vision.image_quality,
    confidence: cappedConfidence,
    notes: Array.from(combinedNotes),
  };
};
