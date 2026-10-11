import type { IncomingMessage, ServerResponse } from 'node:http';
import { requestIdFor } from './logging.module';

function call(header?: string) {
  const req = {
    headers: header === undefined ? {} : { 'x-request-id': header },
  };
  const setHeader = jest.fn();
  const id = requestIdFor(
    req as unknown as IncomingMessage,
    { setHeader } as unknown as ServerResponse,
  );
  return { id, setHeader };
}

describe('requestIdFor', () => {
  it('keeps a valid incoming X-Request-Id and echoes it back', () => {
    const { id, setHeader } = call('abc-123.DEF_4');
    expect(id).toBe('abc-123.DEF_4');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'abc-123.DEF_4');
  });

  it('generates a UUID when the header is missing', () => {
    expect(call().id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ['a newline (log injection)', 'abc\n{"level":"error"}'],
    ['spaces', 'abc def'],
    ['an over-long value', 'x'.repeat(129)],
    ['an empty value', ''],
  ])('replaces a header with %s', (_case, header) => {
    const { id, setHeader } = call(header);
    expect(id).not.toBe(header);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', id);
  });
});
