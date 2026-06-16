import { ImageAnalyzer, AnalysisResult } from './types';

export class ManualAnalyzer implements ImageAnalyzer {
  name = 'manual';
  async analyze(_filepath: string): Promise<AnalysisResult> {
    return { success: true, description: '수동 분석 모드 - 직접 정보를 입력하세요.' };
  }
}
