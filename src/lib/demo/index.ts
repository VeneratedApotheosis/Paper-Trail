/** Demo mode (issue #4): offline seed demo, .eml/.mbox parsing, and upload pipeline. Server-only. */
export {
  SEED_LLM_CACHE_PATH,
  createSeedExtractor,
  loadSeedDemo,
  loadSeedLlmCache,
  seedInbox,
  seedPriceFeed,
} from "./seed";
export type { SeedDemoOptions, SeedDemoResult, SeedExtractorOptions } from "./seed";
export { EmailParseError, htmlToText, parseEml, parseMbox, parseMboxDetailed } from "./eml";
export type { MboxParseResult } from "./eml";
export { MAX_UPLOAD_BYTES, runUploadPipeline } from "./upload";
export type { UploadPipelineOptions } from "./upload";
