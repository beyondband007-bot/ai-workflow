export type {
  BatchFile,
  BatchTaskInput,
  CliArgs,
  ExtendConfig,
  Provider,
  Quality,
} from "./types.js";
export {
  createCliArgs,
  detectProvider,
  generateImageTask,
  generatePreparedTask,
  loadEnv,
  loadExtendConfig,
  loadGenerationConfig,
  mergeConfig,
  parseArgs,
  prepareSingleTask,
  runBatchMode,
  runCli,
  runSingleMode,
} from "./main.js";
export type { GenerationInput, PreparedTask, ProviderModule, ProviderRateLimit, TaskResult } from "./main.js";

import type { Provider, Quality } from "./types.js";

export const providers: Provider[] = ["google", "openai", "dashscope", "replicate", "kie"];
export const aspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:4"];
export const qualities: Quality[] = ["normal", "2k"];
