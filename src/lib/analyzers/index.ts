import { ImageAnalyzer } from './types';
import { ManualAnalyzer } from './manual';

export function getAnalyzer(): ImageAnalyzer {
  const type = process.env.IMAGE_ANALYZER || 'manual';
  switch (type) {
    case 'manual': return new ManualAnalyzer();
    // 향후 확장:
    // case 'tesseract': return new TesseractAnalyzer();
    // case 'ollama': return new OllamaAnalyzer();
    default: return new ManualAnalyzer();
  }
}
export type { ImageAnalyzer, AnalysisResult } from './types';
