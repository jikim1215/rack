export interface AnalysisResult {
  success: boolean;
  manufacturer?: string;
  model?: string;
  serial_number?: string;
  asset_tag?: string;
  description?: string;
  raw_text?: string;
  confidence?: number;
}

export interface ImageAnalyzer {
  name: string;
  analyze(filepath: string): Promise<AnalysisResult>;
}
