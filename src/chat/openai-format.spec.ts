import { formatCompletion, formatDeltaChunk, formatFinishChunk, formatRoleChunk } from './openai-format';

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

describe('stream chunks', () => {
  it('formats role, delta, and finish chunks', () => {
    expect(formatRoleChunk('id', 'model', 1000).choices[0]).toEqual({
      index: 0, delta: { role: 'assistant' }, finish_reason: null,
    });
    expect(formatDeltaChunk('id', 'model', 'hi', 1000).choices[0].delta).toEqual({ content: 'hi' });
    expect(formatFinishChunk('id', 'model', 'stop', { promptTokens: 2, completionTokens: 1, totalTokens: 3 }, 1000))
      .toMatchObject({
        object: 'chat.completion.chunk', choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      });
  });
});
