import { z } from 'zod';

export const EXTRACTION_LIMITS = {
  inputBytes: 52428800,
  outputBytes: 26214400,
  expandedBytes: 104857600,
  pages: 100,
  sheets: 100,
  cells: 1000000,
  cellBytes: 32768,
  embeddedItems: 100,
  embeddedDepth: 5,
  documentSeconds: 600,
} as const;
export const EXTRACTION_FORMATS = {
  'text/plain': 'utf8',
  'text/markdown': 'utf8',
  'text/csv': 'csv',
  'text/tab-separated-values': 'csv',
  'application/pdf': 'pdfium',
  'image/jpeg': 'tesseract',
  'image/png': 'tesseract',
  'image/tiff': 'tesseract',
  'image/bmp': 'tesseract',
  'image/webp': 'tesseract',
  'application/msword': 'tika',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'tika',
  'application/vnd.ms-powerpoint': 'tika',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'tika',
  'application/vnd.oasis.opendocument.text': 'tika',
  'application/vnd.oasis.opendocument.presentation': 'tika',
  'application/rtf': 'tika',
  'application/vnd.ms-excel': 'calamine',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'calamine',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12': 'calamine',
  'application/vnd.oasis.opendocument.spreadsheet': 'calamine',
  'message/rfc822': 'tika',
  'application/vnd.ms-outlook': 'tika',
} as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const extractionRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: z.uuid(),
    versionId: z.uuid(),
    runId: z.uuid(),
    generation: z.number().int().positive().max(2147483647),
    lifecycleGeneration: z.number().int().positive().max(2147483646),
    sourceSha256: hash,
    contentType: z.enum(Object.keys(EXTRACTION_FORMATS) as [string, ...string[]]),
    profile: z.enum(['secure-only', 'searchable', 'structured']),
    stage: z.enum(['native', 'ocr', 'structure']).optional(),
  })
  .strict();
const ocrWordSchema = z
  .object({
    text: z.string().min(1).max(256),
    confidence: z.number().min(0).max(100),
    box: z
      .object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export const OCR_RUNTIME = {
  engineVersion: '5.5.4',
  dataVersion: '87416418657359cb625c412a48b6e1d6d41c29bd',
  englishSha256: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  orientationSha256: '9cf5d576fcc47564f11265841e5ca839001e7e6f38ff7f7aacf46d15a96b00ff',
} as const;
export const ocrProvenanceSchema = z
  .object({
    engine: z.literal('tesseract'),
    engineVersion: z.literal(OCR_RUNTIME.engineVersion),
    language: z.literal('eng'),
    dataVersion: z.literal(OCR_RUNTIME.dataVersion),
    englishSha256: z.literal(OCR_RUNTIME.englishSha256),
    orientationSha256: z.literal(OCR_RUNTIME.orientationSha256),
    configurationVersion: z.literal('english-ocr-v1'),
  })
  .strict();
export const extractionUnitSchema = z
  .object({
    id: z.string().min(1).max(160),
    kind: z.enum(['line', 'page', 'paragraph', 'slide', 'cell', 'email-body', 'attachment']),
    state: z.enum(['TEXT', 'EMPTY', 'OCR_NEEDED', 'PARTIAL', 'OMITTED']),
    text: z.string().max(32768),
    recognition: z.enum(['NATIVE', 'OCR', 'NATIVE_AND_OCR']).optional(),
    ocr: z
      .object({
        coordinateSystem: z.literal('top-left-oriented-raster-pixels'),
        width: z.number().int().positive().max(25000000),
        height: z.number().int().positive().max(25000000),
        dpi: z.number().int().min(72).max(300),
        rotationClockwise: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
        orientationConfidence: z.number().min(0).max(1000).nullable(),
        words: z.array(ocrWordSchema).max(5000),
      })
      .strict()
      .optional(),
    source: z
      .object({
        index: z.number().int().positive(),
        row: z.number().int().positive().max(1000000).optional(),
        column: z.number().int().positive().max(1000000).optional(),
        sheet: z.string().max(128).optional(),
        exifOrientation: z.number().int().min(1).max(8).optional(),
        fileName: z.string().max(240).optional(),
        contentType: z.string().max(100).optional(),
        size: z.number().int().nonnegative().max(52428800).optional(),
        slide: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
        valueType: z.enum(['string', 'number', 'boolean', 'date', 'time', 'empty']).optional(),
        formula: z.string().max(32768).nullable().optional(),
        cached: z.boolean().optional(),
      })
      .strict(),
    warnings: z
      .array(
        z.enum([
          'MIXED_CONTENT',
          'OCR_REQUIRED',
          'FORMULA_NOT_RECALCULATED',
          'FORMULA_UNAVAILABLE',
          'EMBEDDED_OMITTED',
          'UNSUPPORTED_ELEMENT',
          'HTML_MARKUP_OMITTED',
          'OCR_TIMEOUT',
          'OCR_FAILED',
          'ORIENTATION_UNCERTAIN',
          'OCR_LOW_CONFIDENCE',
          'OCR_NO_TEXT',
          'DOCUMENT_TIMEOUT',
          'OCR_LIMIT_EXCEEDED',
          'STRUCTURE_APPROXIMATE',
          'STRUCTURE_FAILED',
          'STRUCTURE_TIMEOUT',
        ]),
      )
      .max(16),
  })
  .strict();
export const STRUCTURE_RUNTIME = {
  processorVersion: '2.146.0',
  configurationVersion: 'docling-layout-v1',
  layoutRevision: '8f39ad3c0b4c58e9c2d2c84a38465abf757272d8',
  tableRevision: 'fc0f2d45e2218ea24bce5045f58a389aed16dc23',
  modelManifestSha256: '888f5b1c76339f3b680caa13b670c88fafaad97f3b66bdfc4992080977a8b090',
} as const;
export const structureProvenanceSchema = z
  .object({
    processorVersion: z.literal(STRUCTURE_RUNTIME.processorVersion),
    configurationVersion: z.literal(STRUCTURE_RUNTIME.configurationVersion),
    layoutRevision: z.literal(STRUCTURE_RUNTIME.layoutRevision),
    tableRevision: z.literal(STRUCTURE_RUNTIME.tableRevision),
    modelManifestSha256: z.literal(STRUCTURE_RUNTIME.modelManifestSha256),
  })
  .strict();
const normalizedBox = z
  .object({
    left: z.number().min(0).max(1),
    top: z.number().min(0).max(1),
    right: z.number().min(0).max(1),
    bottom: z.number().min(0).max(1),
  })
  .strict();
export const structureArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    coordinateSystem: z.literal('top-left-normalized-page'),
    pages: z
      .array(
        z
          .object({
            index: z.number().int().positive().max(100),
            width: z.number().positive().max(1000000),
            height: z.number().positive().max(1000000),
            elements: z
              .array(
                z
                  .object({
                    id: z.string().max(160),
                    kind: z.string().max(64),
                    text: z.string().max(32768),
                    box: normalizedBox.nullable(),
                    table: z
                      .object({
                        rows: z.number().int().nonnegative().max(10000),
                        columns: z.number().int().nonnegative().max(1000),
                        cells: z
                          .array(
                            z
                              .object({
                                row: z.number().int().nonnegative(),
                                column: z.number().int().nonnegative(),
                                rowSpan: z.number().int().positive(),
                                columnSpan: z.number().int().positive(),
                                text: z.string().max(32768),
                                header: z.boolean(),
                                box: normalizedBox.nullable(),
                              })
                              .strict(),
                          )
                          .max(10000),
                      })
                      .strict()
                      .optional(),
                  })
                  .strict(),
              )
              .max(5000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const extractionManifestSchema = extractionRequestSchema
  .extend({
    processor: z.enum([
      'utf8',
      'csv',
      'pdfium',
      'calamine',
      'tika',
      'none',
      'tesseract',
      'pdfium-tesseract',
      'docling',
    ]),
    processorVersion: z.string().min(1).max(120),
    configurationVersion: z.enum(['native-extraction-v1', 'english-ocr-v1', 'docling-layout-v1']),
    ocr: ocrProvenanceSchema.optional(),
    structure: structureProvenanceSchema.optional(),
    status: z.enum(['SUCCEEDED', 'PARTIAL', 'FAILED', 'UNSUPPORTED', 'OMITTED']),
    code: z.enum([
      'OK',
      'SECURE_ONLY',
      'UNSUPPORTED_FORMAT',
      'INVALID_INPUT',
      'LIMIT_EXCEEDED',
      'SANDBOX_UNAVAILABLE',
      'PROCESSOR_FAILED',
    ]),
    languages: z.array(z.string().max(16)).max(4),
    coverage: z
      .object({
        attempted: z.number().int().nonnegative().max(1000000),
        completed: z.number().int().nonnegative().max(1000000),
        omitted: z.number().int().nonnegative().max(1000000),
        ocrNeeded: z.number().int().nonnegative().max(100),
      })
      .strict(),
    warnings: z
      .array(
        z.enum([
          'MIXED_CONTENT',
          'OCR_REQUIRED',
          'FORMULA_NOT_RECALCULATED',
          'FORMULA_UNAVAILABLE',
          'EMBEDDED_OMITTED',
          'UNSUPPORTED_ELEMENT',
          'HTML_MARKUP_OMITTED',
          'OCR_TIMEOUT',
          'OCR_FAILED',
          'ORIENTATION_UNCERTAIN',
          'OCR_LOW_CONFIDENCE',
          'OCR_NO_TEXT',
          'DOCUMENT_TIMEOUT',
          'OCR_LIMIT_EXCEEDED',
          'STRUCTURE_APPROXIMATE',
          'STRUCTURE_FAILED',
          'STRUCTURE_TIMEOUT',
        ]),
      )
      .max(16),
    completedAt: z.iso.datetime(),
  })
  .strict();
export const extractionArtifactSchema = z
  .object({
    manifest: extractionManifestSchema,
    structure: structureArtifactSchema.optional(),
    units: z.array(extractionUnitSchema).max(1000000),
    metadata: z.record(z.string().max(128), z.array(z.string().max(2048)).max(20)),
  })
  .strict();
export type ExtractionRequest = z.infer<typeof extractionRequestSchema>;
export type ExtractionManifest = z.infer<typeof extractionManifestSchema>;

export const OCR_FORMATS = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/bmp',
  'image/webp',
] as const;
export const extractionTask = (contentType: string) =>
  contentType.startsWith('image/') ? ('document.heavy' as const) : ('document.extract' as const);
