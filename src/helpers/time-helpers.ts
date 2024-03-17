import { Integer } from '@dolomite-exchange/dolomite-margin';
import { DateTime } from 'luxon';

export function isExpired(
  expiresAt: Integer | null,
  latestBlockTimestamp: DateTime,
): boolean {
  const expiresAtPlusDelay = expiresAt?.plus(process.env.EXPIRED_ACCOUNT_DELAY_SECONDS as string);
  return expiresAtPlusDelay?.lt(latestBlockTimestamp.toSeconds()) ?? false;
}
