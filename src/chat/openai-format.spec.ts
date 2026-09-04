import { formatCompletion } from './openai-format';

describe('formatCompletion', () => {
  it('formats a unified result as an OpenAI-compatible completion', () => {
    expect(formatCompletion('lr_req_1', {
      publicModel: 'openai/gpt-5', provider: 'openai', attempts: 1,
      response: { content: 'hello', finishReason: 'stop', usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } },
    }, 1_700_000_000_000)).toEqual({
      id: 'lr_req_1', object: 'chat.completion', created: 1_700_000_000, model: 'openai/gpt-5',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });
  });
});
