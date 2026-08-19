import { isNonMultimodalModelError } from '../visionErrors';

describe('isNonMultimodalModelError', () => {
  it('matches vLLM-style multimodal rejections', () => {
    expect(isNonMultimodalModelError(new Error('400 Qwen3-8B is not a multimodal model'))).toBe(true);
  });

  it('ignores unrelated failures', () => {
    expect(isNonMultimodalModelError(new Error('connection refused'))).toBe(false);
  });
});
