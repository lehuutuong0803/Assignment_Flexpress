import { OrderStatus as S } from './order-status.enum';
import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  canTransition,
  InvalidTransitionException,
} from './order-status.machine';

const all = Object.values(S);

describe('order status machine', () => {
  it.each([
    [S.CREATED, S.ASSIGNED],
    [S.ASSIGNED, S.PICKED_UP],
    [S.PICKED_UP, S.IN_TRANSIT],
    [S.IN_TRANSIT, S.DELIVERED],
    [S.IN_TRANSIT, S.FAILED],
  ])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it('allows exactly these five transitions and nothing else', () => {
    const allowed = all.flatMap((from) =>
      all.filter((to) => canTransition(from, to)),
    );
    expect(allowed).toHaveLength(5);
  });

  it.each([
    [S.CREATED, S.PICKED_UP],
    [S.CREATED, S.DELIVERED],
    [S.ASSIGNED, S.IN_TRANSIT],
    [S.PICKED_UP, S.DELIVERED],
  ])('rejects skipping steps: %s → %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(
      InvalidTransitionException,
    );
  });

  it.each([
    [S.ASSIGNED, S.CREATED],
    [S.PICKED_UP, S.ASSIGNED],
    [S.IN_TRANSIT, S.PICKED_UP],
    [S.DELIVERED, S.IN_TRANSIT],
  ])('rejects going backwards: %s → %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(
      InvalidTransitionException,
    );
  });

  it.each([S.DELIVERED, S.FAILED])(
    'allows nothing after the final status %s',
    (final) => {
      expect(ALLOWED_TRANSITIONS[final]).toEqual([]);
      all.forEach((to) => expect(canTransition(final, to)).toBe(false));
    },
  );

  it('only allows FAILED from IN_TRANSIT (not from PICKED_UP or earlier)', () => {
    expect(canTransition(S.IN_TRANSIT, S.FAILED)).toBe(true);
    [S.CREATED, S.ASSIGNED, S.PICKED_UP].forEach((from) =>
      expect(() => assertTransition(from, S.FAILED)).toThrow(
        InvalidTransitionException,
      ),
    );
  });

  it('rejects a no-op transition to the same status', () => {
    all.forEach((s) => expect(canTransition(s, s)).toBe(false));
  });

  it('returns the documented 409 body with the allowed next statuses', () => {
    const error = new InvalidTransitionException(S.PICKED_UP, S.DELIVERED);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      error: 'INVALID_TRANSITION',
      message:
        'Cannot change status from PICKED_UP to DELIVERED. Allowed: IN_TRANSIT',
    });
  });

  it('says when a status is final', () => {
    expect(
      new InvalidTransitionException(S.DELIVERED, S.FAILED).getResponse(),
    ).toEqual({
      error: 'INVALID_TRANSITION',
      message:
        'Cannot change status from DELIVERED to FAILED. Allowed: none (final status)',
    });
  });
});
